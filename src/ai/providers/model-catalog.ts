import { Logger } from '@nestjs/common';

/**
 * The models Gomer can run on, and what they cost.
 *
 * This is the single source of truth for the settings picker, provider routing,
 * and credit pricing — the SPA renders whatever this serves, so a model can
 * never be offered that the runtime cannot actually reach.
 */

export type ProviderId = 'anthropic' | 'gateway';

export interface ModelBadge {
  type: 'recommended' | 'discount' | 'premium' | 'beta' | 'deprecated';
  value?: string;
}

export interface ModelDefinition {
  id: string;
  name: string;
  description: string;
  provider: ProviderId;
  /** List price per million input tokens, in US dollars. */
  inputPricePerMillion: number;
  /** List price per million output tokens, in US dollars. */
  outputPricePerMillion: number;
  /**
   * What the provider actually bills us per million tokens, when that differs
   * from list — an introductory rate, or a negotiated one. List price sets what
   * a workspace is charged and must not move when a promotion starts and ends;
   * these set what we record as our own cost. Default to the list prices.
   */
  costInputPricePerMillion?: number;
  costOutputPricePerMillion?: number;
  /**
   * Whether the model can call tools. Gomer is entirely tool-driven, so a model
   * without this cannot run it and is never offered in settings.
   */
  supportsTools: boolean;
  /**
   * Whether the provider connects to remote MCP servers itself. False means
   * connected apps reach the model through our own MCP bridge instead.
   */
  supportsRemoteMcp: boolean;
  /**
   * Anthropic only: whether `thinking: {type:'adaptive'}` is accepted. The
   * pre-4.6 models reject it with a 400 and must be sent no thinking config.
   */
  supportsAdaptiveThinking?: boolean;
  badges?: ModelBadge[];
}

/**
 * Multiple of list price charged to a workspace, covering infrastructure and
 * margin. Set so Opus lands at ~5 credits per 1K blended tokens, matching the
 * rate this platform charged when Opus was the only model.
 */
export const CREDIT_MARGIN = 5;

/**
 * Anthropic models, priced from Anthropic's published rates. Every one supports
 * tool use, the server-side MCP connector, and prompt caching.
 *
 * Deliberately just two: Sonnet 5 for everyday work and Opus 4.8 for when a
 * workspace wants the stronger model. Offering the whole Anthropic line-up made
 * the picker a quiz with no right answer, and the older Opus and Sonnet
 * generations cost the same as their current ones while performing worse.
 */
const ANTHROPIC_MODELS: ModelDefinition[] = [
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    description:
      'Near-Opus quality on everyday agent work at 40% less. The default, and the right choice for most workspaces.',
    provider: 'anthropic',
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
    // Anthropic's introductory rate, in effect through 2026-08-31. Delete these
    // two lines once it lapses and cost recording falls back to list price —
    // leaving them set would under-record what Sonnet 5 costs us.
    costInputPricePerMillion: 2,
    costOutputPricePerMillion: 10,
    supportsTools: true,
    supportsRemoteMcp: true,
    supportsAdaptiveThinking: true,
    badges: [{ type: 'recommended' }, { type: 'discount', value: '−40%' }],
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    description:
      'The stronger model, for complex or high-stakes campaign work. Costs about two-thirds more than Sonnet 5.',
    provider: 'anthropic',
    inputPricePerMillion: 5,
    outputPricePerMillion: 25,
    supportsTools: true,
    supportsRemoteMcp: true,
    supportsAdaptiveThinking: true,
    badges: [{ type: 'premium', value: '+67%' }],
  },
];

/** One entry of the `AI_GATEWAY_MODELS` JSON array. */
interface GatewayModelConfig {
  id: string;
  name: string;
  description?: string;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
  supportsTools?: boolean;
  badges?: ModelBadge[];
}

const logger = new Logger('ModelCatalog');

/**
 * Gateway models are declared in config rather than hardcoded: which ids exist
 * and what they cost depends on the gateway the deployment points at, so
 * baking in one vendor's naming would break the moment it is swapped.
 */
function parseGatewayModels(raw: string): ModelDefinition[] {
  if (!raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`AI_GATEWAY_MODELS is not valid JSON, ignoring it: ${message}`);
    return [];
  }
  if (!Array.isArray(parsed)) {
    logger.error('AI_GATEWAY_MODELS must be a JSON array, ignoring it');
    return [];
  }
  const models: ModelDefinition[] = [];
  for (const entry of parsed as GatewayModelConfig[]) {
    if (!entry?.id || !entry?.name) {
      logger.warn('Skipping an AI_GATEWAY_MODELS entry without an id and name');
      continue;
    }
    models.push({
      id: entry.id,
      name: entry.name,
      description: entry.description ?? '',
      provider: 'gateway',
      inputPricePerMillion: Number(entry.inputPricePerMillion) || 0,
      outputPricePerMillion: Number(entry.outputPricePerMillion) || 0,
      // Gomer is tool-driven end to end, so a model is only usable if it does
      // function calling. Opt in explicitly — many cheap models advertise it
      // and then ignore the tools.
      supportsTools: entry.supportsTools ?? false,
      supportsRemoteMcp: false,
      badges: entry.badges,
    });
  }
  return models;
}

/** Every known model, Anthropic's fixed set plus whatever the gateway declares. */
export function buildCatalog(gatewayModelsJson: string): ModelDefinition[] {
  return [...ANTHROPIC_MODELS, ...parseGatewayModels(gatewayModelsJson)];
}

/**
 * Credits charged per 1K input and output tokens.
 *
 * A dollar is 100 credits and a price is quoted per million tokens, so credits
 * per 1K token = dollars-per-million ÷ 10, then marked up. Opus lands at 2.5
 * input / 12.5 output, i.e. ~5 blended — the platform's historical rate.
 */
export function creditRates(model: ModelDefinition): { input: number; output: number } {
  return {
    input: (model.inputPricePerMillion / 10) * CREDIT_MARGIN,
    output: (model.outputPricePerMillion / 10) * CREDIT_MARGIN,
  };
}

/**
 * Anthropic bills a cache write above the base input rate and a cache read far
 * below it (5-minute ephemeral cache — the TTL AnthropicProvider requests). A
 * run whose prompt is mostly a cache hit therefore costs a small fraction of
 * what the same token count would cost uncached, which is the whole point of
 * caching and the reason cost cannot be derived from a prompt size alone.
 */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

/** The cached slices of a run's prompt, as reported by the provider. */
export interface CacheTokens {
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
}

/**
 * What a run costs us, in USD — the input side of margin, as opposed to
 * {@link creditRates} which is what we charge for it.
 *
 * Used for providers that do not report a real per-response cost. A gateway
 * that does report one should be trusted over this, since a router's list price
 * is a guess about which backend it picked.
 *
 * `inputTokens` is the whole prompt including its cached slices, so those are
 * subtracted back out and re-priced at their own rates. A provider that reports
 * no cache split prices as if nothing were cached, which is the correct answer
 * for a provider that does no caching.
 */
export function listCostUsd(
  model: ModelDefinition,
  inputTokens: number,
  outputTokens: number,
  cache: CacheTokens = {},
): number {
  const inputPrice = model.costInputPricePerMillion ?? model.inputPricePerMillion;
  const outputPrice = model.costOutputPricePerMillion ?? model.outputPricePerMillion;

  const cacheWrites = Math.max(0, cache.cacheWriteTokens ?? 0);
  const cacheReads = Math.max(0, cache.cacheReadTokens ?? 0);
  // Guard against a provider reporting cached slices larger than the prompt
  // itself; a negative uncached remainder would credit us for the run.
  const uncached = Math.max(0, inputTokens - cacheWrites - cacheReads);

  return (
    (uncached / 1_000_000) * inputPrice +
    (cacheWrites / 1_000_000) * inputPrice * CACHE_WRITE_MULTIPLIER +
    (cacheReads / 1_000_000) * inputPrice * CACHE_READ_MULTIPLIER +
    (outputTokens / 1_000_000) * outputPrice
  );
}
