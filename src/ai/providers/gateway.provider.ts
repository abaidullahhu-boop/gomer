import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { AppConfig } from '../../config/configuration';
import {
  LlmProvider,
  ProviderMessage,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ToolCall,
} from './provider.interface';

const MAX_TOKENS = 8000;

/**
 * Adapter for any OpenAI-compatible endpoint — OpenRouter, a self-hosted
 * OmniRoute, OpenAI itself. Which one is a base-URL setting, so adding a vendor
 * is configuration rather than code.
 *
 * These endpoints have no equivalent of Anthropic's server-side MCP connector,
 * so connected apps reach the model as ordinary function tools that
 * {@link McpBridgeService} has already resolved. That means this adapter never
 * reports remote activity: every tool call comes back for us to execute.
 */
@Injectable()
export class GatewayProvider implements LlmProvider {
  readonly id = 'gateway';
  private readonly logger = new Logger(GatewayProvider.name);
  private client: OpenAI | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  isConfigured(): boolean {
    const ai = this.configService.get('ai', { infer: true });
    return Boolean(ai.gatewayBaseUrl && ai.gatewayApiKey);
  }

  private getClient(): OpenAI {
    if (!this.client) {
      const ai = this.configService.get('ai', { infer: true });
      if (!ai.gatewayBaseUrl || !ai.gatewayApiKey) {
        throw new ServiceUnavailableException(
          'This model needs an AI gateway (set AI_GATEWAY_BASE_URL and AI_GATEWAY_API_KEY)',
        );
      }
      this.client = new OpenAI({ baseURL: ai.gatewayBaseUrl, apiKey: ai.gatewayApiKey });
    }
    return this.client;
  }

  async create(request: ProviderRequest): Promise<ProviderResponse> {
    const client = this.getClient();
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    let completion: OpenAI.Chat.Completions.ChatCompletion;
    let headers: Headers | undefined;
    try {
      // `withResponse` keeps the HTTP response around: gateways report what a
      // call really cost, and which backend served it, only in headers.
      const raw = await client.chat.completions
        .create({
          model: request.model,
          max_tokens: MAX_TOKENS,
          messages: [
            { role: 'system', content: request.system },
            ...this.toOpenAiMessages(request.messages),
          ],
          ...(tools.length ? { tools } : {}),
        })
        .withResponse();
      completion = raw.data;
      headers = raw.response.headers;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Gateway request failed: ${message}`);
      throw new ServiceUnavailableException(`AI request failed: ${message}`);
    }

    const choice = completion.choices[0];
    const toolCalls: ToolCall[] = [];
    for (const call of choice?.message?.tool_calls ?? []) {
      if (call.type !== 'function') continue;
      toolCalls.push({
        id: call.id,
        name: call.function.name,
        input: this.parseArguments(call.function.arguments, call.function.name),
      });
    }

    // Some gateways report `stop` even when tool calls are present, so the calls
    // themselves decide whether the run continues rather than the finish reason.
    const stopReason: ProviderStopReason = toolCalls.length ? 'tool_use' : 'end';

    return {
      text: choice?.message?.content ?? '',
      toolCalls,
      remoteActivity: [],
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
        ...this.costFromHeaders(headers, completion.model),
      },
      stopReason,
      raw: choice?.message ?? null,
    };
  }

  /**
   * What the call really cost and which backend served it. A router id like
   * `auto/best-coding` resolves to a different model per request, so without
   * this a bill cannot be explained after the fact.
   *
   * Both are best-effort: gateways that report neither simply leave the fields
   * unset, and the caller falls back to catalog list pricing.
   */
  private costFromHeaders(
    headers: Headers | undefined,
    completionModel: string | undefined,
  ): { costUsd?: number; resolvedModel?: string } {
    const result: { costUsd?: number; resolvedModel?: string } = {};

    const rawCost = headers?.get('x-omniroute-response-cost');
    if (rawCost !== null && rawCost !== undefined) {
      const cost = Number(rawCost);
      // A free route legitimately reports 0, so only a non-finite value is bad.
      if (Number.isFinite(cost) && cost >= 0) result.costUsd = cost;
    }

    const resolved = headers?.get('x-omniroute-model') ?? completionModel;
    if (resolved) result.resolvedModel = resolved;

    return result;
  }

  /**
   * Tool arguments arrive as a JSON string and weaker models sometimes emit
   * malformed JSON. An empty input lets the tool fail with a message the model
   * can read and correct, which beats aborting the whole run.
   */
  private parseArguments(raw: string, toolName: string): Record<string, unknown> {
    if (!raw?.trim()) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      this.logger.warn(`Model sent unparseable arguments for ${toolName}; treating them as empty`);
      return {};
    }
  }

  private toOpenAiMessages(
    messages: ProviderMessage[],
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const rendered: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'user') {
        rendered.push({ role: 'user', content: message.content });
      } else if (message.role === 'assistant') {
        rendered.push({
          role: 'assistant',
          content: message.content || null,
          ...(message.toolCalls.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function' as const,
                  function: { name: call.name, arguments: JSON.stringify(call.input) },
                })),
              }
            : {}),
        });
      } else {
        // Unlike Anthropic, which batches results into one user turn, OpenAI
        // expects one `tool` message per call.
        for (const result of message.results) {
          rendered.push({
            role: 'tool',
            tool_call_id: result.id,
            content: result.content,
          });
        }
      }
    }
    return rendered;
  }
}
