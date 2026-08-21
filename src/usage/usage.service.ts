import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, SelectQueryBuilder } from 'typeorm';
import { buildCatalog, creditRates, listCostUsd } from '../ai/providers/model-catalog';
import { CreditEventType, CreditGrantReason } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { UsersService } from '../users/users.service';
import { CreditEvent, CreditGrant, ScheduledTask } from '../database/entities';

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
 * An explicit, inclusive window to report over.
 *
 * Replaces the trailing day-count the endpoints used to take. A count can only
 * ever express "the last N days from now", which is exactly wrong for the two
 * calendar options the period dropdown offers: "Last month" became a 30-day
 * window overlapping the current one. The caller computes the boundaries and
 * sends them, because it is the only side that knows the viewer's timezone —
 * the Workspace entity has no timezone column, so the server picking "today"
 * would be guessing.
 */
export interface DateRange {
  from: Date;
  to: Date;
}

/** One row of the activity feed, with its user and task already resolved. */
export interface ActivityEntry {
  id: string;
  createdAt: Date;
  type: CreditEventType;
  sourceName: string;
  model: string;
  credits: number;
  tokens: number;
  user: { id: string; name: string; avatarUrl: string | null } | null;
  task: { id: string; name: string } | null;
}

/** A day in the usage series. Days with no events still appear, at zero. */
export interface DailyCreditPoint {
  day: string;
  thread: number;
  scheduledTask: number;
  credits: number;
}

/**
 * Pad a sparse series out to every day in the window.
 *
 * The group-by only returns days that saw events, so a quiet Sunday simply had
 * no row — and the chart then drew the following Monday in its place, silently
 * shifting every bar left and mislabelling the axis. Filling the gaps keeps one
 * bar per calendar day.
 */
function zeroFilledDays(rows: DailyCreditPoint[], range: DateRange): DailyCreditPoint[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out: DailyCreditPoint[] = [];
  // Buckets are UTC days, matching the date_trunc the group-by applies. A
  // range whose ends came from another timezone still lands on whole UTC days
  // here, so the series has one bar per bucket the query could have produced.
  const cursor = new Date(range.from);
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(range.to);
  last.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= last.getTime()) {
    const key = cursor.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, thread: 0, scheduledTask: 0, credits: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** How spend with no user attached — rules, scheduled tasks — is labelled. */
export const SYSTEM_SPENDER_NAME = 'System (rules & tasks)';

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
    @InjectRepository(ScheduledTask)
    private readonly scheduledTaskRepository: Repository<ScheduledTask>,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
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

  /**
   * Recent spend with the person and the task behind each row resolved.
   *
   * {@link findRecentForWorkspace} returns bare entities whose userId and
   * taskId are ids the page has no way to render, so the activity table would
   * have had to fetch every name and avatar itself, one request per row. The
   * relations are joined here instead.
   *
   * `taskId` narrows to a single task, which is what the Scheduled Tasks table
   * links into — the row and the filtered view then agree by construction,
   * because both are the same query.
   */
  async recentActivity(
    workspaceId: string,
    options: { taskId?: string; limit?: number } = {},
  ): Promise<ActivityEntry[]> {
    const events = await this.creditEventRepository.find({
      where: { workspaceId, ...(options.taskId ? { taskId: options.taskId } : {}) },
      relations: { user: true, task: true },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    });

    return events.map((event) => ({
      id: event.id,
      createdAt: event.createdAt,
      type: event.type,
      sourceName: event.sourceName,
      model: event.resolvedModel ?? event.model,
      credits: event.creditsUsed,
      tokens: event.tokensUsed,
      // Spend with no user attached is the schedulers acting for the
      // workspace, and is labelled the same way the leaderboard labels it.
      user: event.user
        ? {
            id: event.user.id,
            name: event.user.name || event.user.email || event.user.id,
            avatarUrl: event.user.avatarUrl,
          }
        : null,
      task: event.task ? { id: event.task.id, name: event.task.name } : null,
    }));
  }

  /**
   * A CreditEvent query already scoped to one workspace and one window.
   *
   * Every aggregate the Usage page renders needs exactly that pair, and each
   * one used to spell it out itself. Holding it in one place is what stops a
   * newly added aggregate from quietly reporting over a different window than
   * the rest of the response it ships in.
   */
  private scopedEvents(workspaceId: string, range: DateRange): SelectQueryBuilder<CreditEvent> {
    return this.creditEventRepository
      .createQueryBuilder('event')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .andWhere('event.createdAt >= :from', { from: range.from })
      .andWhere('event.createdAt <= :to', { to: range.to });
  }

  /** Credits/tokens per day over the window — the analytics chart. */
  async dailyUsage(
    workspaceId: string,
    range: DateRange,
  ): Promise<Array<{ day: string; credits: number; tokens: number; events: number }>> {
    const rows = await this.scopedEvents(workspaceId, range)
      .select(`to_char(event.createdAt, 'YYYY-MM-DD')`, 'day')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .addSelect('SUM(event.tokensUsed)', 'tokens')
      .addSelect('COUNT(event.id)', 'events')
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
    range: DateRange,
    limit = 10,
  ): Promise<Array<{ userId: string | null; credits: number; events: number }>> {
    const rows = await this.scopedEvents(workspaceId, range)
      .select('event.userId', 'userId')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .addSelect('COUNT(event.id)', 'events')
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

  /**
   * Credits spent per scheduled task, richest first, with the task's own
   * details attached.
   *
   * The ScheduledTask entity is registered on this module directly rather than
   * importing TasksModule: that module pulls in AiModule, which imports this
   * one, so going through the service would close a dependency cycle.
   *
   * A task deleted since its runs were metered keeps its spend — the credits
   * were really spent — and is named as removed rather than dropped, so the
   * per-task figures still add up to the total.
   */
  async topTasks(workspaceId: string, range: DateRange, limit = 10) {
    const rows = await this.scopedEvents(workspaceId, range)
      .select('event.taskId', 'taskId')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .addSelect('COUNT(event.id)', 'runs')
      .addSelect('MAX(event.createdAt)', 'lastRun')
      .where('event.workspaceId = :workspaceId', { workspaceId })
      .andWhere('event.taskId IS NOT NULL')
      .groupBy('event.taskId')
      .orderBy('credits', 'DESC')
      .limit(limit)
      .getRawMany<{ taskId: string; credits: string; runs: string; lastRun: Date }>();
    if (!rows.length) return [];

    const tasks = await this.scheduledTaskRepository.find({
      where: { id: In(rows.map((row) => row.taskId)) },
    });
    const byId = new Map(tasks.map((task) => [task.id, task]));

    return rows.map((row) => {
      const task = byId.get(row.taskId);
      return {
        taskId: row.taskId,
        name: task?.name ?? 'Deleted task',
        createdByUserId: task?.createdByUserId ?? null,
        cronExpression: task?.cronExpression ?? null,
        isActive: task?.isActive ?? false,
        credits: Number(row.credits),
        runs: Number(row.runs),
        lastRun: row.lastRun ?? null,
      };
    });
  }

  /**
   * Daily credits split by what spent them, for the stacked usage chart.
   *
   * Separate from {@link dailyUsage} rather than replacing it: that one feeds
   * the admin tab and changing its shape would ripple there for no gain.
   */
  async dailyUsageSplit(
    workspaceId: string,
    range: DateRange,
  ): Promise<Array<{ day: string; thread: number; scheduledTask: number; credits: number }>> {
    const rows = await this.scopedEvents(workspaceId, range)
      .select(`to_char(date_trunc('day', event.createdAt), 'YYYY-MM-DD')`, 'day')
      .addSelect('event.type', 'type')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .groupBy('day')
      .addGroupBy('event.type')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; type: string; credits: string }>();

    const byDay = new Map<
      string,
      { day: string; thread: number; scheduledTask: number; credits: number }
    >();
    for (const row of rows) {
      const entry = byDay.get(row.day) ?? { day: row.day, thread: 0, scheduledTask: 0, credits: 0 };
      const credits = Number(row.credits);
      if (row.type === CreditEventType.SCHEDULED_TASK) entry.scheduledTask += credits;
      else entry.thread += credits;
      entry.credits += credits;
      byDay.set(row.day, entry);
    }
    return [...byDay.values()];
  }

  /**
   * Credits split by what spent them: interactive threads vs unattended runs.
   * Returned as raw totals; the caller decides how to present the proportion.
   */
  async creditsByType(
    workspaceId: string,
    range: DateRange,
  ): Promise<{ thread: number; scheduledTask: number }> {
    const rows = await this.scopedEvents(workspaceId, range)
      .select('event.type', 'type')
      .addSelect('SUM(event.creditsUsed)', 'credits')
      .groupBy('event.type')
      .getRawMany<{ type: string; credits: string }>();
    const creditsFor = (type: CreditEventType): number =>
      Number(rows.find((row) => row.type === type)?.credits ?? 0);
    return {
      thread: creditsFor(CreditEventType.THREAD),
      scheduledTask: creditsFor(CreditEventType.SCHEDULED_TASK),
    };
  }

  /**
   * The daily series plus the spender leaderboard, with user ids resolved to
   * names — everything the Usage page renders.
   *
   * Unattributed spend (a null userId) is work the schedulers did on the
   * workspace's behalf, not a person, and is labelled as such. Without that the
   * heaviest "user" on most workspaces is a blank row.
   *
   * AdminService.analytics builds the same shape for the admin tab; the two
   * should be folded together, but admin's is left alone here so this addition
   * cannot change a page that already works.
   */
  async analyticsForWorkspace(workspaceId: string, range: DateRange) {
    const [daily, spenders, members, byType, topTasks] = await Promise.all([
      this.dailyUsageSplit(workspaceId, range),
      this.topSpenders(workspaceId, range),
      this.usersService.listAllByWorkspace(workspaceId),
      this.creditsByType(workspaceId, range),
      this.topTasks(workspaceId, range),
    ]);
    const totalCredits = daily.reduce((sum, row) => sum + row.credits, 0);
    const series = zeroFilledDays(daily, range);
    const nameById = new Map(
      members.map((member) => [member.id, member.name ?? member.email ?? member.id]),
    );
    const avatarById = new Map(members.map((member) => [member.id, member.avatarUrl]));
    return {
      // Echoed back so the caller can label the chart with the window it
      // actually got, rather than the one it believes it asked for.
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      days: series.length,
      daily: series,
      totalCredits,
      // Burn is over the whole window, not just the days that saw traffic — a
      // quiet weekend is part of the rate, and averaging only active days would
      // overstate it. Series length is the day count, so an empty range cannot
      // divide by zero here.
      burnPerDay: series.length > 0 ? Math.round(totalCredits / series.length) : 0,
      byType,
      topTasks: topTasks.map((task) => ({
        ...task,
        createdByName: task.createdByUserId ? (nameById.get(task.createdByUserId) ?? null) : null,
      })),
      topSpenders: spenders.map((row) => ({
        ...row,
        name: row.userId ? (nameById.get(row.userId) ?? row.userId) : SYSTEM_SPENDER_NAME,
        avatarUrl: row.userId ? (avatarById.get(row.userId) ?? null) : null,
      })),
    };
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
    range: DateRange,
  ): Promise<{
    costUsd: number;
    chargedUsd: number;
    marginUsd: number;
    tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
    events: number;
  }> {
    const row = await this.scopedEvents(workspaceId, range)
      .select('COALESCE(SUM(event.providerCostUsd), 0)', 'cost')
      .addSelect('COALESCE(SUM(event.creditsUsed), 0)', 'credits')
      .addSelect('COALESCE(SUM(event.inputTokens), 0)', 'input')
      .addSelect('COALESCE(SUM(event.outputTokens), 0)', 'output')
      .addSelect('COALESCE(SUM(event.cacheWriteTokens), 0)', 'cacheWrite')
      .addSelect('COALESCE(SUM(event.cacheReadTokens), 0)', 'cacheRead')
      .addSelect('COUNT(event.id)', 'events')
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
