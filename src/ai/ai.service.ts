import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config/configuration';
import { IntegrationsService } from '../integrations/integrations.service';
import { PipedreamService } from '../integrations/pipedream.service';
import { SpacesService } from '../spaces/spaces.service';
import { UsageService } from '../usage/usage.service';
import { SPACE_TOOLS } from './space-tools';

/** Beta flag enabling the remote MCP connector on the Messages API. */
const MCP_BETA = 'mcp-client-2025-11-20';

const SYSTEM_PROMPT = `You are Gomer, an AI assistant for a workspace. You can take actions across the user's connected apps using the available tools. Prefer acting over describing: when a request maps to a tool, use it. When you lack a connected app needed for a request, say so plainly and name the app to connect.

You can also build "Spaces" — full web apps with their own database, passwordless (magic-link) login, and hosting — using the create_space tool. Spaces suit CRUD/form/dashboard internal tools (e.g. a time logger, lead tracker, or content calendar). Describe the app as entities (data types with typed fields) and views (forms, tables, dashboards). Never invent or share end-user passwords; logins are always magic links. After building a Space, give the user its link.

Keep replies concise.`;

/** A tool the model invoked during a run, for surfacing what Gomer did. */
export interface AiAction {
  app: string;
  tool: string;
  isError: boolean;
}

/** A Space created during a run, surfaced so the chat can link to it. */
export interface AiSpace {
  slug: string;
  name: string;
  url: string;
}

export interface AiRunResult {
  answer: string;
  /** App slugs whose tools were made available for this run. */
  connectedApps: string[];
  actions: AiAction[];
  /** Spaces Gomer built during this run. */
  spaces: AiSpace[];
}

/**
 * Orchestrates Gomer's model calls. Connected integrations are exposed to
 * Claude as Pipedream remote-MCP servers (one per app), so the model can act on
 * a workspace's apps directly. The client is built lazily so the app boots
 * without an Anthropic key.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly integrationsService: IntegrationsService,
    private readonly pipedream: PipedreamService,
    private readonly spacesService: SpacesService,
    private readonly usageService: UsageService,
  ) {}

  getStatus(): { module: string; ready: boolean; provider: string } {
    const ai = this.configService.get('ai', { infer: true });
    return { module: 'ai', ready: Boolean(ai.anthropicApiKey), provider: 'anthropic' };
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const ai = this.configService.get('ai', { infer: true });
      if (!ai.anthropicApiKey) {
        throw new ServiceUnavailableException('AI is not configured (set ANTHROPIC_API_KEY)');
      }
      this.client = new Anthropic({ apiKey: ai.anthropicApiKey });
    }
    return this.client;
  }

  /**
   * Run a single prompt for a workspace, exposing its connected apps as tools,
   * and return Gomer's answer plus the actions it took.
   */
  async run(workspaceId: string, userId: string | null, prompt: string): Promise<AiRunResult> {
    const ai = this.configService.get('ai', { infer: true });
    const client = this.getClient();

    // Only the accounts this member may use become tools: every team account
    // plus their own private ones. Each scope lives under a different Pipedream
    // external user, so we build MCP servers per scope — a private account is
    // unreachable from another member's run.
    const connected = (
      await this.integrationsService.findVisibleForUser(workspaceId, userId ?? '')
    ).filter((c) => c.isActive);
    const teamSlugs = [
      ...new Set(connected.filter((c) => c.accessLevel === 'team').map((c) => c.appSlug)),
    ];
    const privateSlugs = userId
      ? [...new Set(connected.filter((c) => c.accessLevel === 'private').map((c) => c.appSlug))]
      : [];

    const servers = [
      ...(teamSlugs.length ? this.pipedream.buildMcpServers(workspaceId, teamSlugs) : []),
      ...(privateSlugs.length && userId
        ? this.pipedream.buildMcpServers(
            PipedreamService.privateExternalUserId(userId),
            privateSlugs,
          )
        : []),
    ];
    const appSlugs = [...new Set(servers.map((server) => server.appSlug))];
    const accessToken = servers.length ? await this.pipedream.getAccessToken() : null;

    const mcpServers = servers.map((server) => ({
      type: 'url' as const,
      url: server.url,
      name: server.name,
      authorization_token: accessToken ?? undefined,
    }));
    // Connected apps become server-side MCP toolsets; Spaces tools are local
    // (custom) tools we execute ourselves and feed results back.
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      ...servers.map((server) => ({
        type: 'mcp_toolset' as const,
        mcp_server_name: server.name,
      })),
      ...SPACE_TOOLS,
    ];

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    const actions: AiAction[] = [];
    const spaces: AiSpace[] = [];
    let answer = '';
    let tokensUsed = 0;

    // Two reasons to loop: the MCP connector returns `pause_turn` when it hits
    // its per-turn iteration cap, and a local Spaces tool call returns
    // `tool_use` — in both cases we re-send the accumulated conversation.
    for (let i = 0; i < 6; i += 1) {
      const response = await this.create(client, ai.model, messages, mcpServers, tools);
      tokensUsed += response.usage.input_tokens + response.usage.output_tokens;

      const toolUses: Anthropic.Beta.BetaToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'text') {
          answer += block.text;
        } else if (block.type === 'mcp_tool_use') {
          actions.push({ app: block.server_name, tool: block.name, isError: false });
        } else if (block.type === 'mcp_tool_result') {
          const last = actions[actions.length - 1];
          if (last) last.isError = block.is_error ?? false;
        } else if (block.type === 'tool_use') {
          toolUses.push(block);
        }
      }

      if (response.stop_reason === 'tool_use' && toolUses.length) {
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          results.push(await this.runSpaceTool(workspaceId, userId, toolUse, spaces));
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      break;
    }

    await this.recordUsage(workspaceId, userId, ai.model, tokensUsed);

    return { answer: answer.trim(), connectedApps: appSlugs, actions, spaces };
  }

  /**
   * Execute a local Spaces tool call and return its tool_result. Creating a
   * Space validates the AI's spec before persisting; a bad spec becomes an error
   * result the model can read and correct, never a failed request.
   */
  private async runSpaceTool(
    workspaceId: string,
    userId: string | null,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    spaces: AiSpace[],
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    const input = (toolUse.input ?? {}) as Record<string, unknown>;
    try {
      let slug: string;
      let name: string;
      if (toolUse.name === 'update_space') {
        const { slug: target, ...spec } = input;
        const space = await this.spacesService.updateSpec(workspaceId, String(target), spec);
        slug = space.slug;
        name = space.name;
      } else {
        const space = await this.spacesService.createFromSpec(workspaceId, userId, input);
        slug = space.slug;
        name = space.name;
      }
      const url = this.spacesService.spaceUrl(slug);
      spaces.push({ slug, name, url });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Space "${name}" is live at ${url}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Space tool ${toolUse.name} failed: ${message}`);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Failed to build the Space: ${message}`,
        is_error: true,
      };
    }
  }

  /**
   * Meter a completed run. Token spend is best-effort accounting — a failure to
   * persist it must never fail the user's request, so we swallow and log.
   */
  private async recordUsage(
    workspaceId: string,
    userId: string | null,
    model: string,
    tokensUsed: number,
  ): Promise<void> {
    if (tokensUsed <= 0) return;
    try {
      await this.usageService.recordEvent({
        workspaceId,
        userId,
        model,
        tokensUsed,
        sourceName: 'ai.run',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to record AI usage: ${message}`);
    }
  }

  private async create(
    client: Anthropic,
    model: string,
    messages: Anthropic.Beta.BetaMessageParam[],
    mcpServers: Array<{ type: 'url'; url: string; name: string; authorization_token?: string }>,
    tools: Anthropic.Beta.BetaToolUnion[],
  ): Promise<Anthropic.Beta.BetaMessage> {
    try {
      return await client.beta.messages.create({
        model,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages,
        ...(tools.length ? { tools } : {}),
        ...(mcpServers.length ? { mcp_servers: mcpServers } : {}),
        betas: [MCP_BETA],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Anthropic request failed: ${message}`);
      throw new ServiceUnavailableException(`AI request failed: ${message}`);
    }
  }
}
