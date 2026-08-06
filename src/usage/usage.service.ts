import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { buildCatalog, creditRates, listCostUsd } from '../ai/providers/model-catalog';
import { CreditEventType, CreditGrantReason } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { CreditEvent, CreditGrant } from '../database/entities';

export interface UsageSummary {
  totalCreditsUsed: number;
  totalTokensUsed: number;
  eventCount: number;
}

/** A workspace's credit position: what it received, spent, and has left. */
export interface CreditBalance {
  granted: number;
  used: number;
  balance: number;
}

/**
 * One credit = one US cent, so a dollar amount maps 1:100 to credits and the
 * grants ledger doubles as a revenue record.
 */
export const CREDITS_PER_DOLLAR = 100;

/** The one-time free credits every new workspace starts with ($100). */
export const ONBOARDING_CREDITS = 100 * CREDITS_PER_DOLLAR;

/**
 * Rate applied when a usage event names a model the catalog does not know —
 * one that has since been retired, or a gateway model dropped from config.
 * Deliberately Opus-priced so an unknown model is never billed too cheaply.
 */
const UNKNOWN_MODEL_RATES = { input: 2.5, output: 12.5 };

/** A single unit of metered consumption to persist. */
export interface RecordUsageInput {
  workspaceId: string;
  userId?: string | null;
  /** The scheduled task that spent the credits, when the run came from one. */
  taskId?: string | null;
  model: string;
  /** Input and output are billed at different rates, so they are kept apart. */
  inputTokens: number;
  outputTokens: number;
  /**
   * The cached slices of `inputTokens`, when the provider reports them. They do
   * not change what the workspace is charged — the caching saving is ours, not
   * theirs — only what the run is recorded as having cost us.
   */
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  /** Human label for what spent the credits, e.g. an app or feature name. */
  sourceName: string;
  type?: CreditEventType;
  /**
   * What the provider says the run cost us in USD. Omit when it reports nothing
   * and the cost will be derived from the model's list price instead.
   */
  providerCostUsd?: number;
  /** The backend that actually served a routed model id, when it reported one. */
  resolvedModel?: string | null;
}

/** A credit addition to persist on the grants ledger. */
export interface GrantCreditsInput {
  workspaceId: string;
  userId?: string | null;
  reason: CreditGrantReason;
  credits: number;
  amountCents?: number | null;
  currency?: string | null;
  stripeSessionId?: string | null;
  note?: string | null;
}

/**
 * Credit accounting: meters consumption into the immutable credit_events
 * ledger and additions into credit_grants; a workspace's balance is the
 * difference between the two.
 */
@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(CreditEvent)
    private readonly creditEventRepository: Repository<CreditEvent>,
    @InjectRepository(CreditGrant)
    private readonly creditGrantRepository: Repository<CreditGrant>,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  private definitionFor(model: string) {
    return buildCatalog(this.configService.get('ai', { infer: true }).gatewayModels).find(
      (candidate) => candidate.id === model,
    );
  }

  /** Credits charged for a run's tokens, minimum 1 per metered event. */
  private creditsFor(model: string, inputTokens: number, outputTokens: number): number {
    const definition = this.definitionFor(model);
    const rates = definition ? creditRates(definition) : UNKNOWN_MODEL_RATES;
    const credits = (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
    return Math.max(1, Math.ceil(credits));
  }

  /**
   * What the run cost us, in USD. A provider-reported figure wins: for a routed
   * model id the catalog price is only a guess at which backend ran, while the
   * gateway knows. Falls back to list price, and to 0 for an unknown model —
   * recording nothing is better than inventing a number.
   */
  private costUsdFor(input: RecordUsageInput): number {
    if (input.providerCostUsd !== undefined && Number.isFinite(input.providerCostUsd)) {
      return input.providerCostUsd;
    }
    const definition = this.definitionFor(input.model);
    return definition
      ? listCostUsd(definition, input.inputTokens, input.outputTokens, {
          cacheWriteTokens: input.cacheWriteTokens,
          cacheReadTokens: input.cacheReadTokens,
        })
      : 0;
  }

  /** Persist an immutable usage event, pricing tokens by the model's own rates. */
  recordEvent(input: RecordUsageInput): Promise<CreditEvent> {
    const event = this.creditEventRepository.create({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      taskId: input.taskId ?? null,
      type: input.type ?? CreditEventType.THREAD,
      sourceName: input.sourceName,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheWriteTokens: input.cacheWriteTokens ?? 0,
      cacheReadTokens: input.cacheReadTokens ?? 0,
      // Kept as the sum so the analytics queries below stay a single column read.
      tokensUsed: input.inputTokens + input.outputTokens,
      creditsUsed: this.creditsFor(input.model, input.inputTokens, input.outputTokens),
      model: input.model,
      resolvedModel: input.resolvedModel ?? null,
      // numeric columns round-trip as strings in pg; fix the scale here so the
      // stored value matches the column rather than relying on the driver.
      providerCostUsd: this.costUsdFor(input).toFixed(6),
    });
    return this.creditEventRepository.save(event);
  }

  /** Persist an immutable credit addition. */
  grantCredits(input: GrantCreditsInput): Promise<CreditGrant> {
    const grant = this.creditGrantRepository.create({
      workspaceId: input.workspaceId,
      userId: input.userId ?? null,
      reason: input.reason,
      credits: input.credits,
      amountCents: input.amountCents ?? null,
      currency: input.currency ?? null,
      stripeSessionId: input.stripeSessionId ?? null,
      note: input.note ?? null,
    });
    return this.creditGrantRepository.save(grant);
  }

  /**
   * Give a workspace its one-time onboarding credits. Safe to call on every
   * workspace upsert: a workspace that already has an onboarding grant (or was
   * backfilled by migration) is left alone.
   */
  async grantOnboardingCredits(workspaceId: string): Promise<CreditGrant | null> {
    const existing = await this.creditGrantRepository.findOne({
      where: { workspaceId, reason: CreditGrantReason.ONBOARDING },
    });
    if (existing) return null;
    return this.grantCredits({
      workspaceId,
      reason: CreditGrantReason.ONBOARDING,
      credits: ONBOARDING_CREDITS,
      note: 'Free onboarding credits ($100)',
    });
  }

  /** Whether a Stripe Checkout session was already recorded (webhook retry). */
  async hasGrantForStripeSession(stripeSessionId: string): Promise<boolean> {
    const existing = await this.creditGrantRepository.findOne({ where: { stripeSessionId } });
    return Boolean(existing);
  }

  async getBalance(workspaceId: string): Promise<CreditBalance> {
    const [granted, summary] = await Promise.all([
      this.creditGrantRepository
        .createQueryBuilder('grant')
        .select('COALESCE(SUM(grant.credits), 0)', 'credits')
        .where('grant.workspaceId = :workspaceId', { workspaceId })
        .getRawOne<{ credits: string }>()
        .then((raw) => Number(raw?.credits ?? 0)),
      this.summarizeForWorkspace(workspaceId),
    ]);
    return { granted, used: summary.totalCreditsUsed, balance: granted - summary.totalCreditsUsed };
  }

  findGrantsForWorkspace(workspaceId: string, limit = 50): Promise<CreditGrant[]> {
    return this.creditGrantRepository.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  findRecentForWorkspace(workspaceId: string, limit = 50): Promise<CreditEvent[]> {
    return this.creditEventRepository.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Credits/tokens per day over the trailing window — the analytics chart. */
  async dailyUsage(
    workspaceId: string,
    days = 30,
  ): Promise<Array<{ day: string; credits: number; tokens: number; events: number }>> {
    const rows = await this.creditEventRepository
      .createQueryBuilder('event')
      .select(`to_char(event.createdAt, 'YYYY-MM-DD')`, 'day')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .addSelect('SUM(event.tokensUsed)', 'tokens')
      .addSelect('COUNT(event.id)', 'events')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .andWhere(`event.createdAt >= now() - make_interval(days => :days)`, { days })
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; credits: string; tokens: string; events: string }>();
    return rows.map((row) => ({
      day: row.day,
      credits: Number(row.credits),
      tokens: Number(row.tokens),
      events: Number(row.events),
    }));
  }

  /** The workspace's heaviest credit spenders over the trailing window. */
  async topSpenders(
    workspaceId: string,
    days = 30,
    limit = 10,
  ): Promise<Array<{ userId: string | null; credits: number; events: number }>> {
    const rows = await this.creditEventRepository
      .createQueryBuilder('event')
      .select('event.userId', 'userId')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .addSelect('COUNT(event.id)', 'events')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .andWhere(`event.createdAt >= now() - make_interval(days => :days)`, { days })
      .groupBy('event.userId')
      .orderBy('credits', 'DESC')
      .limit(limit)
      .getRawMany<{ userId: string | null; credits: string; events: string }>();
    return rows.map((row) => ({
      userId: row.userId,
      credits: Number(row.credits),
      events: Number(row.events),
    }));
  }

  /** Grants aggregated by reason — the revenue overview's headline numbers. */
  async grantTotalsByReason(
    workspaceId: string,
  ): Promise<Array<{ reason: string; credits: number; amountCents: number; count: number }>> {
    const rows = await this.creditGrantRepository
      .createQueryBuilder('grant')
      .select('grant.reason', 'reason')
      .addSelect('SUM(grant.credits)', 'credits')
      .addSelect('COALESCE(SUM(grant.amountCents), 0)', 'amount')
      .addSelect('COUNT(grant.id)', 'count')
      .where('grant.workspaceId = :workspaceId', { workspaceId })
      .groupBy('grant.reason')
      .getRawMany<{ reason: string; credits: string; amount: string; count: string }>();
    return rows.map((row) => ({
      reason: row.reason,
      credits: Number(row.credits),
      amountCents: Number(row.amount),
      count: Number(row.count),
    }));
  }

  /**
   * What the workspace's runs cost us against what it was charged for them —
   * the margin view. Credits are cents, so both sides are reported in USD to be
   * directly comparable. Scoped to a trailing window because the useful question
   * is "what is this costing now", not since the beginning of time.
   */
  async costSummary(
    workspaceId: string,
    days = 30,
  ): Promise<{
    costUsd: number;
    chargedUsd: number;
    marginUsd: number;
    tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
    events: number;
  }> {
    const row = await this.creditEventRepository
      .createQueryBuilder('event')
      .select('COALESCE(SUM(event.providerCostUsd), 0)', 'cost')
      .addSelect('COALESCE(SUM(event.creditsUsed), 0)', 'credits')
      .addSelect('COALESCE(SUM(event.inputTokens), 0)', 'input')
      .addSelect('COALESCE(SUM(event.outputTokens), 0)', 'output')
      .addSelect('COALESCE(SUM(event.cacheWriteTokens), 0)', 'cacheWrite')
      .addSelect('COALESCE(SUM(event.cacheReadTokens), 0)', 'cacheRead')
      .addSelect('COUNT(event.id)', 'events')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .andWhere(`event.createdAt >= now() - make_interval(days => :days)`, { days })
      .getRawOne<Record<string, string>>();

    const costUsd = Number(row?.cost ?? 0);
    const chargedUsd = Number(row?.credits ?? 0) / CREDITS_PER_DOLLAR;
    return {
      costUsd,
      chargedUsd,
      marginUsd: chargedUsd - costUsd,
      tokens: {
        input: Number(row?.input ?? 0),
        output: Number(row?.output ?? 0),
        cacheWrite: Number(row?.cacheWrite ?? 0),
        cacheRead: Number(row?.cacheRead ?? 0),
      },
      events: Number(row?.events ?? 0),
    };
  }

  async summarizeForWorkspace(workspaceId: string): Promise<UsageSummary> {
    const { credits, tokens, count } = await this.creditEventRepository
      .createQueryBuilder('event')
      .select('COALESCE(SUM(event.creditsUsed), 0)', 'credits')
      .addSelect('COALESCE(SUM(event.tokensUsed), 0)', 'tokens')
      .addSelect('COUNT(event.id)', 'count')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .getRawOne<{ credits: string; tokens: string; count: string }>()
      .then((raw) => raw ?? { credits: '0', tokens: '0', count: '0' });

    return {
      totalCreditsUsed: Number(credits),
      totalTokensUsed: Number(tokens),
      eventCount: Number(count),
    };
  }
}
