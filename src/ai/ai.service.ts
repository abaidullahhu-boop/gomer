import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config/configuration';
import { CreditEventType } from '../common/enums';
import { IntegrationsService } from '../integrations/integrations.service';
import { PipedreamService } from '../integrations/pipedream.service';
import { SpacesService } from '../spaces/spaces.service';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';
import { SPACE_TOOLS } from './space-tools';
import { GET_WORKSPACE_STATS, WORKSPACE_TOOLS } from './workspace-tools';

/** Beta flag enabling the remote MCP connector on the Messages API. */
const MCP_BETA = 'mcp-client-2025-11-20';

/**
 * Local (custom) tools AiService executes itself: building/updating Spaces and
 * reading workspace facts. Sent on every run alongside any connected-app MCP
 * toolsets, and kept as the sole tools when the MCP connector is dropped.
 */
const LOCAL_TOOLS: Anthropic.Beta.BetaToolUnion[] = [...SPACE_TOOLS, ...WORKSPACE_TOOLS];

const SYSTEM_PROMPT = `You are Gomer, an AI assistant for a workspace. You can take actions across the user's connected apps using the available tools. Prefer acting over describing: when a request maps to a tool, use it. When you lack a connected app needed for a request, say so plainly and name the app to connect.

You can also build "Spaces" — full web apps with their own database, passwordless (magic-link) login, and hosting — using the create_space tool. Spaces suit CRUD/form/dashboard internal tools (e.g. a time logger, lead tracker, or content calendar). Describe the app as entities (data types with typed fields) and views (forms, tables, dashboards). Never invent or share end-user passwords; logins are always magic links. After building a Space, give the user its link.

You can also answer questions about this workspace itself — how many members it has and which apps members have connected — with the get_workspace_stats tool. Use it instead of guessing or saying you have no way to know.

Your replies are delivered in Slack, so format for Slack's mrkdwn — not Markdown: use *single asterisks* for bold (never **double**, which Slack shows literally), _underscores_ for italics, and a leading "• " for bullets. Don't use # headings or [text](url) links; write links as <https://example.com|label>.

Be brief and lead with the answer. Put the direct response in the first sentence, then add only the detail the request actually needs. Prefer a few short sentences; use a short bulleted list only when giving steps or options. Don't restate the question, stack on caveats, or list the tools you have unless asked.`;

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
    private readonly usersService: UsersService,
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
   *
   * `options.model` overrides the workspace default (used by scheduled tasks
   * that pin a model); `options.taskId`/`options.sourceName` attribute the
   * metered usage to the originating scheduled task.
   */
  async run(
    workspaceId: string,
    userId: string | null,
    prompt: string,
    options: {
      model?: string | null;
      taskId?: string | null;
      sourceName?: string;
      /** Lazily resolves the workspace's total member count (e.g. Slack roster),
       * used by the workspace-stats tool. Optional — omitted off-Slack. */
      fetchMemberCount?: () => Promise<number | null>;
    } = {},
  ): Promise<AiRunResult> {
    const ai = this.configService.get('ai', { infer: true });
    const model = options.model ?? ai.model;
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

    // Connected apps become server-side MCP toolsets; Spaces tools are local
    // (custom) tools we execute ourselves and feed results back. Both are `let`
    // because a dead MCP server makes Anthropic reject the whole request, so we
    // drop the connector and retry with only the local tools (see the loop).
    let mcpServers = servers.map((server) => ({
      type: 'url' as const,
      url: server.url,
      name: server.name,
      authorization_token: accessToken ?? undefined,
    }));
    let tools: Anthropic.Beta.BetaToolUnion[] = [
      ...servers.map((server) => ({
        type: 'mcp_toolset' as const,
        mcp_server_name: server.name,
      })),
      ...LOCAL_TOOLS,
    ];
    // Whether connected apps were actually available for this run; cleared if we
    // fall back after an MCP connection failure so callers don't over-promise.
    let appsAvailable = servers.length > 0;

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    const actions: AiAction[] = [];
    const spaces: AiSpace[] = [];
    let answer = '';
    let tokensUsed = 0;

    // Two reasons to loop: the MCP connector returns `pause_turn` when it hits
    // its per-turn iteration cap, and a local Spaces tool call returns
    // `tool_use` — in both cases we re-send the accumulated conversation.
    for (let i = 0; i < 6; i += 1) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await this.create(client, model, messages, mcpServers, tools);
      } catch (error) {
        // A single unreachable Pipedream MCP server makes Anthropic 400 the whole
        // request, which would otherwise fail even prompts that need no app. Drop
        // the connector once and retry so the model can still answer locally.
        if (!mcpServers.length || !this.isMcpConnectionError(error)) throw error;
        this.logger.warn(
          'A connected-app MCP server was unreachable; retrying without connected apps',
        );
        mcpServers = [];
        tools = [...LOCAL_TOOLS];
        appsAvailable = false;
        response = await this.create(client, model, messages, mcpServers, tools);
      }
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
          results.push(
            await this.runLocalTool(workspaceId, userId, toolUse, spaces, options.fetchMemberCount),
          );
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

    await this.recordUsage(workspaceId, userId, model, tokensUsed, {
      taskId: options.taskId ?? null,
      sourceName: options.sourceName,
    });

    return { answer: answer.trim(), connectedApps: appsAvailable ? appSlugs : [], actions, spaces };
  }

  /**
   * Route a local (custom) tool call to its executor. These run on our side —
   * unlike the connected-app MCP tools, which Anthropic executes server-side —
   * and their results are fed back into the conversation.
   */
  private runLocalTool(
    workspaceId: string,
    userId: string | null,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    spaces: AiSpace[],
    fetchMemberCount?: () => Promise<number | null>,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    if (toolUse.name === GET_WORKSPACE_STATS) {
      return this.runWorkspaceStatsTool(workspaceId, toolUse, fetchMemberCount);
    }
    return this.runSpaceTool(workspaceId, userId, toolUse, spaces);
  }

  /**
   * Produce a full workspace report — total members, sign-up adoption, and every
   * connected account with who connected it — from our own data (plus the Slack
   * roster when available). Read-only and best-effort: a query failure becomes an
   * error result the model can relay, never a failed request.
   */
  private async runWorkspaceStatsTool(
    workspaceId: string,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    fetchMemberCount?: () => Promise<number | null>,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    try {
      const [signedUpMembers, integrations, totalMembers] = await Promise.all([
        this.usersService.countByWorkspace(workspaceId),
        this.integrationsService.getWorkspaceIntegrations(workspaceId),
        fetchMemberCount ? fetchMemberCount() : Promise.resolve(null),
      ]);

      const connectedPeople = new Set(
        integrations.map((row) => row.userName).filter((name): name is string => Boolean(name)),
      ).size;

      const payload = {
        members: {
          // Total members of the workspace (e.g. the full Slack roster); null if
          // we couldn't read it.
          total: totalMembers,
          // People who have a Gomer account (have interacted with / installed it).
          signedUp: signedUpMembers,
          notSignedUp: totalMembers != null ? Math.max(totalMembers - signedUpMembers, 0) : null,
        },
        connections: {
          accountCount: integrations.length,
          peopleConnected: connectedPeople,
          accounts: integrations.map((row) => ({
            person: row.userName,
            app: row.appName,
            label: row.label,
            scope: row.accessLevel,
            active: row.isActive,
          })),
        },
      };
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(payload),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Workspace stats tool failed: ${message}`);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Failed to read workspace stats: ${message}`,
        is_error: true,
      };
    }
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
    options: { taskId?: string | null; sourceName?: string } = {},
  ): Promise<void> {
    if (tokensUsed <= 0) return;
    try {
      await this.usageService.recordEvent({
        workspaceId,
        userId,
        taskId: options.taskId ?? null,
        type: options.taskId ? CreditEventType.SCHEDULED_TASK : CreditEventType.THREAD,
        model,
        tokensUsed,
        sourceName: options.sourceName ?? 'ai.run',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to record AI usage: ${message}`);
    }
  }

  /**
   * Whether a failed model call was Anthropic rejecting the request because it
   * couldn't reach a remote MCP server (the Pipedream connector being down or
   * unresponsive), as opposed to a genuine bad request. Such failures are worth
   * retrying without the connector; others are not.
   */
  private isMcpConnectionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('MCP server');
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
