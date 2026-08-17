import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CronExpressionParser } from 'cron-parser';
import { MoreThan, Repository } from 'typeorm';
import {
  AdRule,
  AdRuleAction,
  RuleActionType,
  RuleComparator,
  RuleMetric,
  RuleScope,
} from '../database/entities';
import { IntegrationsService } from '../integrations/integrations.service';
import { MetaAdsService } from '../integrations/meta-ads.service';
import { pickPurchaseValue } from '../integrations/meta-metrics';
import { RoasService } from '../integrations/roas.service';

/** Fields requested from Meta insights (extra ones are ignored per level). */
const INSIGHT_FIELDS = [
  'spend',
  'ctr',
  'cpc',
  'actions',
  'cost_per_action_type',
  'purchase_roas',
  'account_currency',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
];

/** What a member supplies to create a rule (post-validation shape). */
export interface CreateRuleInput {
  name: string;
  adAccountId: string;
  scope: RuleScope;
  metric: RuleMetric;
  comparator: RuleComparator;
  threshold: number;
  windowDays?: number;
  action: RuleActionType;
  scalePct?: number | null;
  cronExpression: string;
  timezone?: string | null;
  slackChannelId?: string | null;
  autoExecute?: boolean;
  maxScalePct?: number;
  maxActionsPerRun?: number;
  dailyActionCap?: number;
}

/** The outcome of evaluating one rule, for the scheduler to deliver to Slack. */
export interface RuleRunReport {
  ruleId: string;
  ruleName: string;
  workspaceId: string;
  slackChannelId: string | null;
  /** Slack mrkdwn to post, or null when the run had nothing worth surfacing. */
  message: string | null;
}

/** A Meta insights row, with the fields the evaluator reads. */
interface InsightRow {
  spend?: string;
  ctr?: string;
  cpc?: string;
  account_currency?: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  actions?: Array<{ action_type: string; value: string }>;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
}

/** A single breaching entity resolved from an insights row. */
interface Breach {
  entityId: string | null;
  entityName: string | null;
  value: number;
}

/**
 * The automated rule engine. Evaluates each due {@link AdRule} against Meta Ads
 * metrics, then — within its guardrails — alerts, pauses, or scales the
 * breaching campaigns/ad sets, recording every action as an {@link AdRuleAction}
 * for audit and the rolling daily cap. Autonomous mutation reuses the raw
 * {@link MetaAdsService} calls (which carry no human-confirmation gate; that
 * gate lives in AiService for interactive use).
 *
 * Slack notification is intentionally NOT done here: {@link runDueRules} returns
 * per-rule reports and the leaf scheduler posts them, keeping this service free
 * of a SlackModule import (which would cycle back through AiModule).
 */
@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    @InjectRepository(AdRule)
    private readonly ruleRepository: Repository<AdRule>,
    @InjectRepository(AdRuleAction)
    private readonly actionRepository: Repository<AdRuleAction>,
    private readonly integrationsService: IntegrationsService,
    private readonly metaAds: MetaAdsService,
    private readonly roasService: RoasService,
  ) {}

  // ── CRUD (driven by the chat tools) ────────────────────────────────────────

  async create(
    workspaceId: string,
    userId: string | null,
    input: CreateRuleInput,
  ): Promise<AdRule> {
    this.validate(input);
    const timezone = input.timezone ?? null;
    const rule = this.ruleRepository.create({
      workspaceId,
      name: input.name,
      adAccountId: input.adAccountId,
      scope: input.scope,
      metric: input.metric,
      comparator: input.comparator,
      threshold: String(input.threshold),
      windowDays: input.windowDays ?? 3,
      action: input.action,
      scalePct: input.action === 'scale' ? (input.scalePct ?? null) : null,
      autoExecute: input.autoExecute ?? true,
      maxScalePct: input.maxScalePct ?? 25,
      maxActionsPerRun: input.maxActionsPerRun ?? 10,
      dailyActionCap: input.dailyActionCap ?? 25,
      cronExpression: input.cronExpression,
      timezone,
      slackChannelId: input.slackChannelId ?? null,
      isActive: true,
      createdByUserId: userId,
      nextRun: this.nextRunFrom(input.cronExpression, timezone),
    });
    return this.ruleRepository.save(rule);
  }

  list(workspaceId: string): Promise<AdRule[]> {
    return this.ruleRepository.find({ where: { workspaceId }, order: { createdAt: 'DESC' } });
  }

  async setActive(workspaceId: string, id: string, isActive: boolean): Promise<AdRule> {
    const rule = await this.findOwned(workspaceId, id);
    rule.isActive = isActive;
    if (isActive) rule.nextRun = this.nextRunFrom(rule.cronExpression, rule.timezone);
    return this.ruleRepository.save(rule);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const rule = await this.findOwned(workspaceId, id);
    await this.ruleRepository.remove(rule);
  }

  /** Recent actions a rule has taken, for "what has this rule done?" queries. */
  recentActions(ruleId: string, limit = 20): Promise<AdRuleAction[]> {
    return this.actionRepository.find({
      where: { ruleId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * The workspace's rule activity, newest first with the owning rule joined —
   * the dashboard's "what have my rules been doing" feed. Distinct from
   * {@link actionsForWorkspace}, which is ordered and windowed for appending to
   * a spreadsheet rather than for reading on a screen.
   */
  recentActionsForWorkspace(workspaceId: string, limit = 50): Promise<AdRuleAction[]> {
    return this.actionRepository.find({
      where: { workspaceId },
      relations: { rule: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Every rule action across the workspace, oldest first and with the owning
   * rule joined — the shape a Sheets export appends. `since` (exclusive) lets a
   * repeat export pick up only what has happened since its last run.
   */
  actionsForWorkspace(workspaceId: string, since: Date, limit = 500): Promise<AdRuleAction[]> {
    return this.actionRepository.find({
      where: { workspaceId, createdAt: MoreThan(since) },
      relations: { rule: true },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  // ── Evaluation (driven by the scheduler) ───────────────────────────────────

  /**
   * Evaluate every active rule that is due and return a report per rule for the
   * scheduler to deliver. One rule's failure never blocks the others.
   */
  async runDueRules(now: Date = new Date()): Promise<RuleRunReport[]> {
    const due = await this.ruleRepository
      .createQueryBuilder('rule')
      .where('rule.isActive = :active', { active: true })
      .andWhere('rule.nextRun IS NOT NULL')
      .andWhere('rule.nextRun <= :now', { now })
      .getMany();

    const reports: RuleRunReport[] = [];
    for (const rule of due) {
      try {
        reports.push(await this.evaluateRule(rule));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Rule ${rule.id} (${rule.name}) failed: ${message}`);
        reports.push({
          ruleId: rule.id,
          ruleName: rule.name,
          workspaceId: rule.workspaceId,
          slackChannelId: rule.slackChannelId,
          message: `⚠️ Rule *${rule.name}* could not run: ${message}`,
        });
      } finally {
        rule.lastRun = new Date();
        rule.nextRun = this.nextRunFrom(rule.cronExpression, rule.timezone);
        await this.ruleRepository.save(rule);
      }
    }
    return reports;
  }

  /** Evaluate one rule: measure, find breaches, act within guardrails, report. */
  private async evaluateRule(rule: AdRule): Promise<RuleRunReport> {
    const token = await this.integrationsService.getMetaAccessToken(
      rule.workspaceId,
      rule.createdByUserId,
    );
    if (!token) {
      return this.report(rule, `⚠️ Rule *${rule.name}* skipped: no active Meta Ads connection.`);
    }

    const { since, until } = this.window(rule.windowDays);

    // verified_roas is account-level and can only alert (you can't pause an
    // account), so it takes a dedicated path through the Phase 2 verifier.
    if (rule.metric === 'verified_roas') {
      return this.evaluateVerifiedRoas(rule, since, until);
    }

    const insights = (await this.metaAds.getInsights(token, {
      adAccountId: rule.adAccountId,
      level: rule.scope,
      since,
      until,
      fields: INSIGHT_FIELDS,
    })) as { data: InsightRow[] };
    const rows = insights.data ?? [];

    const breaches: Breach[] = [];
    for (const row of rows) {
      const value = this.extractMetric(row, rule.metric);
      if (value == null || !this.breaches(value, rule)) continue;
      breaches.push({
        entityId: rule.scope === 'adset' ? (row.adset_id ?? null) : (row.campaign_id ?? null),
        entityName: rule.scope === 'adset' ? (row.adset_name ?? null) : (row.campaign_name ?? null),
        value,
      });
    }

    if (!breaches.length) {
      return this.report(rule, null); // Quiet on no breach — no notification spam.
    }

    // Alert-only rules (or account scope, or autoExecute off) never mutate.
    const actOnly = rule.action !== 'alert' && rule.autoExecute && rule.scope !== 'account';
    if (!actOnly) {
      for (const breach of breaches.slice(0, rule.maxActionsPerRun)) {
        await this.recordAction(rule, breach, 'alert', this.alertDetail(rule, breach), true, null);
      }
      return this.report(rule, this.alertMessage(rule, breaches));
    }

    return this.executeMutations(rule, token, breaches);
  }

  /** Pause or scale the breaching entities, honouring the guardrail caps. */
  private async executeMutations(
    rule: AdRule,
    token: string,
    breaches: Breach[],
  ): Promise<RuleRunReport> {
    // Rolling daily cap: how many mutating actions this rule has already taken.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const usedToday = await this.actionRepository.count({
      where: { ruleId: rule.id, success: true, action: rule.action, createdAt: MoreThan(since) },
    });
    const remainingDaily = Math.max(rule.dailyActionCap - usedToday, 0);
    const cap = Math.min(rule.maxActionsPerRun, remainingDaily);

    if (cap <= 0) {
      return this.report(
        rule,
        `⏸️ Rule *${rule.name}*: ${breaches.length} breach(es) found but the daily action cap ` +
          `(${rule.dailyActionCap}) is reached — no changes made.`,
      );
    }

    // Budgets are only needed for scaling; fetch the account's current budgets once.
    const budgets = rule.action === 'scale' ? await this.loadBudgets(rule, token) : new Map();

    const done: string[] = [];
    const failed: string[] = [];
    for (const breach of breaches.slice(0, cap)) {
      if (!breach.entityId) continue;
      try {
        const detail = await this.applyAction(rule, token, breach, budgets);
        await this.recordAction(rule, breach, rule.action, detail, true, null);
        done.push(detail);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.recordAction(rule, breach, rule.action, null, false, message);
        failed.push(`${breach.entityName ?? breach.entityId}: ${message}`);
      }
    }

    const skipped = breaches.length - Math.min(breaches.length, cap);
    return this.report(rule, this.actionMessage(rule, done, failed, skipped));
  }

  /** Perform one entity's action, returning a human detail line. */
  private async applyAction(
    rule: AdRule,
    token: string,
    breach: Breach,
    budgets: Map<string, number>,
  ): Promise<string> {
    const label = breach.entityName ?? breach.entityId!;
    if (rule.action === 'pause') {
      if (rule.scope === 'adset') {
        await this.metaAds.updateAdSet(token, { adSetId: breach.entityId!, status: 'PAUSED' });
      } else {
        await this.metaAds.updateCampaign(token, {
          campaignId: breach.entityId!,
          status: 'PAUSED',
        });
      }
      return `Paused *${label}* (${this.metricLabel(rule.metric)} ${this.round(breach.value)})`;
    }

    // scale: clamp the percent to the guardrail, resolve the current budget,
    // and apply the delta. A missing budget (e.g. the budget lives at another
    // level) is a hard skip rather than a silent no-op.
    const current = budgets.get(breach.entityId!);
    if (current == null) {
      throw new Error('no daily budget at this level to scale');
    }
    const pct = this.clampPct(rule.scalePct ?? 0, rule.maxScalePct);
    const next = Math.max(Math.round(current * (1 + pct / 100)), 1);
    if (rule.scope === 'adset') {
      await this.metaAds.updateAdSet(token, { adSetId: breach.entityId!, dailyBudget: next });
    } else {
      await this.metaAds.updateCampaign(token, { campaignId: breach.entityId!, dailyBudget: next });
    }
    return `Scaled *${label}* ${pct > 0 ? '+' : ''}${pct}% (${this.money(current)} → ${this.money(next)})`;
  }

  /** Account-scope verified ROAS: compute via Phase 2 and alert on breach. */
  private async evaluateVerifiedRoas(
    rule: AdRule,
    since: string,
    until: string,
  ): Promise<RuleRunReport> {
    const result = await this.roasService.verify(rule.workspaceId, rule.createdByUserId, {
      adAccountId: rule.adAccountId,
      since,
      until,
    });
    if (result.verifiedRoas == null) {
      return this.report(
        rule,
        `⚠️ Rule *${rule.name}*: verified ROAS could not be computed (${result.caveats[0] ?? 'no data'}).`,
      );
    }
    if (!this.breaches(result.verifiedRoas, rule)) return this.report(rule, null);

    const breach: Breach = {
      entityId: rule.adAccountId,
      entityName: rule.adAccountId,
      value: result.verifiedRoas,
    };
    await this.recordAction(rule, breach, 'alert', this.alertDetail(rule, breach), true, null);
    return this.report(
      rule,
      `🔔 Rule *${rule.name}*: verified ROAS ${this.round(result.verifiedRoas)} on ` +
        `${rule.adAccountId} ${this.comparatorWord(rule.comparator)} target ${this.round(Number(rule.threshold))}.`,
    );
  }

  // ── Metric extraction & comparison ─────────────────────────────────────────

  private extractMetric(row: InsightRow, metric: RuleMetric): number | null {
    const spend = Number(row.spend);
    switch (metric) {
      case 'spend':
        return Number.isFinite(spend) ? spend : null;
      case 'ctr':
        return row.ctr != null ? Number(row.ctr) : null;
      case 'cpc':
        return row.cpc != null ? Number(row.cpc) : null;
      case 'roas': {
        const roas = pickPurchaseValue(row.purchase_roas);
        return roas ?? 0;
      }
      case 'cpa': {
        const cpa = pickPurchaseValue(row.cost_per_action_type);
        if (cpa != null) return cpa;
        // No purchases recorded: spend with zero sales is an infinite CPA (a
        // "CPA > X" rule should catch it); no spend means there's nothing to say.
        return spend > 0 ? Number.POSITIVE_INFINITY : null;
      }
      default:
        return null;
    }
  }

  private breaches(value: number, rule: AdRule): boolean {
    const threshold = Number(rule.threshold);
    switch (rule.comparator) {
      case 'gt':
        return value > threshold;
      case 'gte':
        return value >= threshold;
      case 'lt':
        return value < threshold;
      case 'lte':
        return value <= threshold;
      default:
        return false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Current daily budgets (minor units) keyed by entity id, for scaling. */
  private async loadBudgets(rule: AdRule, token: string): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const rows =
      rule.scope === 'adset'
        ? (await this.metaAds.listAdSetsForAccount(token, rule.adAccountId)).data
        : (await this.metaAds.listCampaigns(token, { adAccountId: rule.adAccountId })).data;
    for (const raw of rows as Array<{ id?: string; daily_budget?: string }>) {
      if (raw.id && raw.daily_budget != null) map.set(raw.id, Number(raw.daily_budget));
    }
    return map;
  }

  private clampPct(pct: number, max: number): number {
    const bound = Math.abs(max);
    return Math.max(Math.min(pct, bound), -bound);
  }

  private window(days: number): { since: string; until: string } {
    const until = new Date();
    const since = new Date(until.getTime() - days * 24 * 60 * 60 * 1000);
    return { since: this.date(since), until: this.date(until) };
  }

  private date(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  private round(n: number): string {
    if (!Number.isFinite(n)) return '∞';
    return (Math.round(n * 100) / 100).toString();
  }

  /** Minor-unit budget rendered as a rough major-unit figure for a Slack note. */
  private money(minor: number): string {
    return (Math.round(minor) / 100).toString();
  }

  private metricLabel(metric: RuleMetric): string {
    return metric === 'verified_roas' ? 'verified ROAS' : metric.toUpperCase();
  }

  private comparatorWord(comparator: RuleComparator): string {
    return comparator === 'gt' || comparator === 'gte' ? 'above' : 'below';
  }

  private alertDetail(rule: AdRule, breach: Breach): string {
    return `${this.metricLabel(rule.metric)} ${this.round(breach.value)} ${this.comparatorWord(
      rule.comparator,
    )} ${this.round(Number(rule.threshold))}`;
  }

  private alertMessage(rule: AdRule, breaches: Breach[]): string {
    const lines = breaches
      .slice(0, rule.maxActionsPerRun)
      .map(
        (breach) => `• ${breach.entityName ?? breach.entityId}: ${this.alertDetail(rule, breach)}`,
      );
    return `🔔 Rule *${rule.name}* — ${breaches.length} ${rule.scope}(s) breached:\n${lines.join('\n')}`;
  }

  private actionMessage(
    rule: AdRule,
    done: string[],
    failed: string[],
    skipped: number,
  ): string | null {
    if (!done.length && !failed.length) return null;
    const verb = rule.action === 'pause' ? 'Paused' : 'Scaled';
    const parts = [`🤖 Rule *${rule.name}* — ${verb} ${done.length} ${rule.scope}(s):`];
    for (const line of done) parts.push(`• ${line}`);
    if (failed.length) {
      parts.push(`\n⚠️ ${failed.length} failed:`);
      for (const line of failed) parts.push(`• ${line}`);
    }
    if (skipped > 0)
      parts.push(`\n_${skipped} more breached but were held back by the action cap._`);
    return parts.join('\n');
  }

  private report(rule: AdRule, message: string | null): RuleRunReport {
    return {
      ruleId: rule.id,
      ruleName: rule.name,
      workspaceId: rule.workspaceId,
      slackChannelId: rule.slackChannelId,
      message,
    };
  }

  private recordAction(
    rule: AdRule,
    breach: Breach,
    action: string,
    detail: string | null,
    success: boolean,
    error: string | null,
  ): Promise<AdRuleAction> {
    return this.actionRepository.save(
      this.actionRepository.create({
        ruleId: rule.id,
        workspaceId: rule.workspaceId,
        entityType: rule.scope,
        entityId: breach.entityId,
        entityName: breach.entityName,
        metricValue: Number.isFinite(breach.value) ? breach.value.toFixed(4) : null,
        action,
        detail,
        success,
        error,
      }),
    );
  }

  private async findOwned(workspaceId: string, id: string): Promise<AdRule> {
    const rule = await this.ruleRepository.findOne({ where: { id, workspaceId } });
    if (!rule) throw new NotFoundException('Rule not found');
    return rule;
  }

  private validate(input: CreateRuleInput): void {
    if (input.metric === 'verified_roas' && input.scope !== 'account') {
      throw new BadRequestException('verified_roas rules must use account scope');
    }
    if (input.scope === 'account' && input.action !== 'alert') {
      throw new BadRequestException('account-scope rules can only alert (nothing to pause/scale)');
    }
    if (input.action === 'scale') {
      if (input.scope === 'account') {
        throw new BadRequestException('scaling requires campaign or adset scope');
      }
      if (!input.scalePct || input.scalePct === 0) {
        throw new BadRequestException('a scale rule needs a non-zero scalePct');
      }
    }
    this.nextRunFrom(input.cronExpression, input.timezone ?? null); // validates cron
  }

  private nextRunFrom(cronExpression: string, timezone: string | null): Date {
    try {
      return CronExpressionParser.parse(cronExpression, { tz: timezone ?? undefined })
        .next()
        .toDate();
    } catch {
      throw new BadRequestException(`Invalid cron expression: "${cronExpression}"`);
    }
  }
}
