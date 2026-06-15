import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config/configuration';
import { IntegrationsService } from '../integrations/integrations.service';
import { PipedreamService } from '../integrations/pipedream.service';
import { UsageService } from '../usage/usage.service';

/** Beta flag enabling the remote MCP connector on the Messages API. */
const MCP_BETA = 'mcp-client-2025-11-20';

const SYSTEM_PROMPT = `You are Viktor, an AI assistant for a workspace. You can take actions across the user's connected apps using the available tools. Prefer acting over describing: when a request maps to a tool, use it. When you lack a connected app needed for a request, say so plainly and name the app to connect. Keep replies concise.`;

/** A tool the model invoked during a run, for surfacing what Viktor did. */
export interface AiAction {
  app: string;
  tool: string;
  isError: boolean;
}

export interface AiRunResult {
  answer: string;
  /** App slugs whose tools were made available for this run. */
  connectedApps: string[];
  actions: AiAction[];
}

/**
 * Orchestrates Viktor's model calls. Connected integrations are exposed to
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
   * and return Viktor's answer plus the actions it took.
   */
  async run(workspaceId: string, userId: string | null, prompt: string): Promise<AiRunResult> {
    const ai = this.configService.get('ai', { infer: true });
    const client = this.getClient();

    // Distinct connected app slugs become MCP servers for this run.
    const connected = await this.integrationsService.findAllForWorkspace(workspaceId);
    const appSlugs = [...new Set(connected.filter((c) => c.isActive).map((c) => c.appSlug))];

    const servers = appSlugs.length ? this.pipedream.buildMcpServers(workspaceId, appSlugs) : [];
    const accessToken = servers.length ? await this.pipedream.getAccessToken() : null;

    const mcpServers = servers.map((server) => ({
      type: 'url' as const,
      url: server.url,
      name: server.name,
      authorization_token: accessToken ?? undefined,
    }));
    const tools = servers.map((server) => ({
      type: 'mcp_toolset' as const,
      mcp_server_name: server.name,
    }));

    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
    const actions: AiAction[] = [];
    let answer = '';
    let tokensUsed = 0;

    // The MCP connector runs a server-side tool loop; if it hits the per-turn
    // iteration cap it returns `pause_turn`, which we resume by re-sending.
    for (let i = 0; i < 6; i += 1) {
      const response = await this.create(client, ai.model, messages, mcpServers, tools);
      tokensUsed += response.usage.input_tokens + response.usage.output_tokens;

      for (const block of response.content) {
        if (block.type === 'text') {
          answer += block.text;
        } else if (block.type === 'mcp_tool_use') {
          actions.push({ app: block.server_name, tool: block.name, isError: false });
        } else if (block.type === 'mcp_tool_result') {
          const last = actions[actions.length - 1];
          if (last) last.isError = block.is_error ?? false;
        }
      }

      if (response.stop_reason !== 'pause_turn') break;
      messages.push({ role: 'assistant', content: response.content });
    }

    await this.recordUsage(workspaceId, userId, ai.model, tokensUsed);

    return { answer: answer.trim(), connectedApps: appSlugs, actions };
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
    tools: Array<{ type: 'mcp_toolset'; mcp_server_name: string }>,
  ): Promise<Anthropic.Beta.BetaMessage> {
    try {
      return await client.beta.messages.create({
        model,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        messages,
        ...(mcpServers.length ? { mcp_servers: mcpServers, tools } : {}),
        betas: [MCP_BETA],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Anthropic request failed: ${message}`);
      throw new ServiceUnavailableException(`AI request failed: ${message}`);
    }
  }
}
