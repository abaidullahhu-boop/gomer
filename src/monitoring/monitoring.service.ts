import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AnomalyAlert } from '../database/entities';
import { IntegrationsService } from '../integrations/integrations.service';
import { MetaAdsService } from '../integrations/meta-ads.service';
import { WorkspaceMemoryService } from '../memory/workspace-memory.service';

/** Memory-fact keys a workspace can save to choose its alerts channel. */
const ALERTS_CHANNEL_FACT_KEYS = ['alerts_channel', 'alerts_channel_id', 'slack_alerts_channel'];

/** Deviation from baseline that counts as an anomaly (30%). */
const DEVIATION_THRESHOLD = 0.3;

/** Spend multiple over the daily baseline that counts as a spend spike. */
const SPEND_SPIKE_MULTIPLE = 2;

/** Ignore accounts that spent less than this today — too little data to judge. */
const MIN_SPEND_TODAY = 10;

/** Most ad accounts examined per workspace per sweep. */
const MAX_ACCOUNTS = 5;

/** Meta `action_type`s that count as a purchase, for CPA/ROAS extraction. */
const PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
]);

const INSIGHT_FIELDS = ['spend', 'cost_per_action_type', 'purchase_roas', 'account_currency'];

/** The insight fields this monitor reads off an account-level row. */
interface InsightRow {
  spend?: string;
  cost_per_action_type?: Array<{ action_type: string; value: string }>;
  purchase_roas?: Array<{ action_type: string; value: string }>;
  account_currency?: string;
}

/** An anomaly to deliver, with everything the scheduler needs to post it. */
export interface AnomalyReport {
  workspaceId: string;
  slackChannel: string;
  message: string;
}

/**
 * Proactive ad-account monitoring: an hourly sweep compares each Meta ad
 * account's numbers today against its trailing 7-day baseline and reports CPA
 * spikes, ROAS drops, and runaway spend to the workspace's alerts channel —
 * no user-created rule required. Each anomaly notifies at most once per day
 * (enforced by a unique index, so concurrent instances can't double-post).
 *
 * The alerts channel is the workspace-memory fact `alerts_channel`, so users
 * set it conversationally ("remember our alerts channel is #ads-alerts").
 * Workspaces without the fact are skipped.
 */
@Injectable()
export class MonitoringService {
  private readonly logger = new Logger(MonitoringService.name);

  constructor(
    @InjectRepository(AnomalyAlert)
    private readonly alertRepository: Repository<AnomalyAlert>,
    private readonly integrationsService: IntegrationsService,
    private readonly metaAds: MetaAdsService,
    private readonly workspaceMemory: WorkspaceMemoryService,
  ) {}

  /** Sweep every Meta-connected workspace; returns the alerts to deliver. */
  async runSweep(): Promise<AnomalyReport[]> {
    const reports: AnomalyReport[] = [];
    const workspaceIds = await this.integrationsService.listActiveMetaWorkspaceIds();
    for (const workspaceId of workspaceIds) {
      try {
        reports.push(...(await this.sweepWorkspace(workspaceId)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Anomaly sweep failed for workspace ${workspaceId}: ${message}`);
      }
    }
    return reports;
  }

  private async sweepWorkspace(workspaceId: string): Promise<AnomalyReport[]> {
    const slackChannel = await this.resolveAlertsChannel(workspaceId);
    if (!slackChannel) return [];

    const token = await this.integrationsService.getMetaAccessToken(workspaceId, '');
    if (!token) return [];

    const accounts = (await this.metaAds.listAdAccounts(token)).data.slice(0, MAX_ACCOUNTS);
    const reports: AnomalyReport[] = [];
    for (const account of accounts) {
      const accountId = account.id ?? (account.account_id ? `act_${account.account_id}` : null);
      if (!accountId) continue;
      const findings = await this.checkAccount(token, accountId, account.name ?? accountId);
      for (const finding of findings) {
        // The unique (workspace, account, metric, day) index is the dedup: an
        // anomaly that already alerted today fails the insert and stays quiet.
        if (await this.recordOnce(workspaceId, accountId, finding.metric, finding.message)) {
          reports.push({ workspaceId, slackChannel, message: finding.message });
        }
      }
    }
    return reports;
  }

  /** Compare an account's today against its trailing-7-day baseline. */
  private async checkAccount(
    token: string,
    accountId: string,
    accountName: string,
  ): Promise<Array<{ metric: string; message: string }>> {
    const today = this.isoDaysAgo(0);
    const [todayRows, baselineRows] = await Promise.all([
      this.metaAds.getInsights(token, {
        adAccountId: accountId,
        since: today,
        until: today,
        fields: INSIGHT_FIELDS,
      }),
      this.metaAds.getInsights(token, {
        adAccountId: accountId,
        since: this.isoDaysAgo(7),
        until: this.isoDaysAgo(1),
        fields: INSIGHT_FIELDS,
      }),
    ]);
    const now = this.parseRow(todayRows.data[0] as InsightRow | undefined);
    const base = this.parseRow(baselineRows.data[0] as InsightRow | undefined);
    if (!now || now.spend < MIN_SPEND_TODAY || !base || base.spend <= 0) return [];

    const findings: Array<{ metric: string; message: string }> = [];
    const currency = now.currency ?? '';
    const label = `*${accountName}*`;

    // CPA spike: today's cost per purchase is >30% over the 7-day baseline —
    // including the "spending but zero purchases" case (infinite CPA).
    if (base.cpa != null && base.cpa > 0) {
      if (now.cpa == null) {
        findings.push({
          metric: 'cpa_spike',
          message:
            `🚨 ${label} has spent ${this.money(now.spend, currency)} today with *no purchases* ` +
            `(7-day average CPA: ${this.money(base.cpa, currency)}). Worth a look.`,
        });
      } else if (now.cpa > base.cpa * (1 + DEVIATION_THRESHOLD)) {
        findings.push({
          metric: 'cpa_spike',
          message:
            `🚨 CPA spike on ${label}: ${this.money(now.cpa, currency)} today vs ` +
            `${this.money(base.cpa, currency)} 7-day average ` +
            `(${this.pct(now.cpa / base.cpa - 1)} higher).`,
        });
      }
    }

    // ROAS drop: today's return is >30% under the baseline.
    if (base.roas != null && base.roas > 0 && now.roas != null) {
      if (now.roas < base.roas * (1 - DEVIATION_THRESHOLD)) {
        findings.push({
          metric: 'roas_drop',
          message:
            `📉 ROAS drop on ${label}: ${now.roas.toFixed(2)} today vs ` +
            `${base.roas.toFixed(2)} 7-day average ` +
            `(${this.pct(1 - now.roas / base.roas)} lower).`,
        });
      }
    }

    // Spend spike: today is already over twice the average full day.
    const dailyBaseline = base.spend / 7;
    if (dailyBaseline > 0 && now.spend > dailyBaseline * SPEND_SPIKE_MULTIPLE) {
      findings.push({
        metric: 'spend_spike',
        message:
          `⚠️ Spend spike on ${label}: ${this.money(now.spend, currency)} today vs a ` +
          `${this.money(dailyBaseline, currency)} daily average over the last 7 days.`,
      });
    }
    return findings;
  }

  /** Parse the metrics this monitor compares out of an insights row. */
  private parseRow(
    row: InsightRow | undefined,
  ): { spend: number; cpa: number | null; roas: number | null; currency?: string } | null {
    if (!row) return null;
    const spend = Number(row.spend);
    if (!Number.isFinite(spend)) return null;
    return {
      spend,
      cpa: this.pickPurchase(row.cost_per_action_type),
      roas: this.pickPurchase(row.purchase_roas),
      currency: row.account_currency,
    };
  }

  /** The value of the purchase entry in a Meta typed-value array, if present. */
  private pickPurchase(entries?: Array<{ action_type: string; value: string }>): number | null {
    if (!entries?.length) return null;
    const hit =
      entries.find((entry) => PURCHASE_ACTION_TYPES.has(entry.action_type)) ??
      entries.find((entry) => entry.action_type.includes('purchase'));
    return hit ? Number(hit.value) : null;
  }

  /** Insert today's dedup row; false when this anomaly already alerted today. */
  private async recordOnce(
    workspaceId: string,
    adAccountId: string,
    metric: string,
    message: string,
  ): Promise<boolean> {
    try {
      await this.alertRepository.insert({
        workspaceId,
        adAccountId,
        metric,
        day: this.isoDaysAgo(0),
        message,
      });
      return true;
    } catch {
      return false; // unique-index hit: already alerted today
    }
  }

  /**
   * The workspace's alerts destination: the first `alerts_channel`-style
   * memory fact, reduced to a Slack channel/user id when one is embedded
   * (users often save "#ads-alerts (C0123ABC)").
   */
  private async resolveAlertsChannel(workspaceId: string): Promise<string | null> {
    const facts = await this.workspaceMemory.list(workspaceId);
    const fact = facts.find((f) => ALERTS_CHANNEL_FACT_KEYS.includes(f.key));
    if (!fact?.value.trim()) return null;
    const value = fact.value.trim();
    return value.match(/\b[CGDUW][A-Z0-9]{7,}\b/)?.[0] ?? value;
  }

  private isoDaysAgo(days: number): string {
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return date.toISOString().slice(0, 10);
  }

  private money(amount: number, currency: string): string {
    return `${amount.toFixed(2)}${currency ? ` ${currency}` : ''}`;
  }

  private pct(fraction: number): string {
    return `${Math.round(fraction * 100)}%`;
  }
}
