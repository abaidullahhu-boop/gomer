import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../../config/configuration';
import {
  LlmProvider,
  McpConnectionError,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  RemoteToolActivity,
  ToolCall,
} from './provider.interface';

/** Beta flag enabling the remote MCP connector on the Messages API. */
const MCP_BETA = 'mcp-client-2025-11-20';

const MAX_TOKENS = 8000;

/**
 * Anthropic adapter. Connected apps are handed over as server-side MCP servers,
 * so Anthropic runs those tools itself and we only execute our own local tools —
 * the arrangement Gomer has always used, kept intact.
 */
@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private client: Anthropic | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get('ai', { infer: true }).anthropicApiKey);
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

  async create(request: ProviderRequest): Promise<ProviderResponse> {
    const client = this.getClient();
    const tools: Anthropic.Beta.BetaToolUnion[] = [
      ...request.mcpServers.map((server) => ({
        type: 'mcp_toolset' as const,
        mcp_server_name: server.name,
      })),
      ...request.tools.map((tool) => ({
        type: 'custom' as const,
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Beta.BetaTool['input_schema'],
      })),
    ];
    const mcpServers = request.mcpServers.map((server) => ({
      type: 'url' as const,
      url: server.url,
      name: server.name,
      authorization_token: server.authorizationToken,
    }));

    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await client.beta.messages.create({
        model: request.model,
        max_tokens: MAX_TOKENS,
        // Pre-4.6 models reject the parameter outright, so it is opt-in per model.
        ...(request.capabilities.adaptiveThinking
          ? { thinking: { type: 'adaptive' as const } }
          : {}),
        system: request.system,
        messages: this.toAnthropicMessages(request.messages),
        ...(tools.length ? { tools } : {}),
        ...(mcpServers.length ? { mcp_servers: mcpServers } : {}),
        betas: [MCP_BETA],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Anthropic request failed: ${message}`);
      // A single unreachable MCP server makes Anthropic 400 the whole request;
      // surfaced as its own type so the caller can retry without connectors.
      if (message.includes('MCP server')) throw new McpConnectionError(message);
      throw new ServiceUnavailableException(`AI request failed: ${message}`);
    }

    return this.fromAnthropicMessage(response);
  }

  /**
   * Replays assistant turns from their original blocks when we have them —
   * Anthropic rejects edited thinking blocks, and its MCP blocks have no neutral
   * equivalent to rebuild from. Turns that came from another provider (or from
   * stored chat history) fall back to plain text.
   */
  private toAnthropicMessages(messages: ProviderMessage[]): Anthropic.Beta.BetaMessageParam[] {
    return messages.map((message) => {
      if (message.role === 'user') {
        return { role: 'user' as const, content: message.content };
      }
      if (message.role === 'assistant') {
        if (message.raw) {
          return {
            role: 'assistant' as const,
            content: message.raw as Anthropic.Beta.BetaContentBlockParam[],
          };
        }
        return { role: 'assistant' as const, content: message.content };
      }
      return {
        role: 'user' as const,
        content: message.results.map((result) => ({
          type: 'tool_result' as const,
          tool_use_id: result.id,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        })),
      };
    });
  }

  private fromAnthropicMessage(response: Anthropic.Beta.BetaMessage): ProviderResponse {
    let text = '';
    const toolCalls: ToolCall[] = [];
    const remoteActivity: RemoteToolActivity[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'mcp_tool_use') {
        remoteActivity.push({ app: block.server_name, tool: block.name, isError: false });
      } else if (block.type === 'mcp_tool_result') {
        // Results arrive immediately after their call, so the open activity is
        // always the last one pushed.
        const last = remoteActivity[remoteActivity.length - 1];
        if (last) last.isError = block.is_error ?? false;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    let stopReason: ProviderStopReason = 'end';
    if (response.stop_reason === 'tool_use' && toolCalls.length) stopReason = 'tool_use';
    else if (response.stop_reason === 'pause_turn') stopReason = 'pause';

    return {
      text,
      toolCalls,
      remoteActivity,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason,
      raw: response.content,
    };
  }
}
