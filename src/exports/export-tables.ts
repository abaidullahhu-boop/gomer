import { AdRuleAction, RoasSnapshot } from '../database/entities';
import type { ExportTable } from '../integrations/sheets.service';
import { pickPurchaseValue, type MetaTypedValue } from '../integrations/meta-metrics';

/**
 * Row shaping for the export datasets: entity/API rows in, a header row plus
 * cells out. Kept pure and free of any service so the column contract — the
 * part a client actually reads in the spreadsheet — is unit-testable without a
 * database or a Meta token.
 *
 * Numbers are emitted as numbers, not preformatted strings, so the cells stay
 * sortable and chartable in Sheets. Timestamps are ISO-8601 for the same reason.
 */

/** A Meta campaign-level insights row, with the fields the exporter reads. */
export interface CampaignInsightRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  account_currency?: string;
  actions?: MetaTypedValue[];
  cost_per_action_type?: MetaTypedValue[];
  purchase_roas?: MetaTypedValue[];
}

/** Insight fields the campaign export requests from Meta. */
export const CAMPAIGN_INSIGHT_FIELDS = [
  'campaign_id',
  'campaign_name',
  'spend',
  'impressions',
  'clicks',
  'ctr',
  'cpc',
  'actions',
  'cost_per_action_type',
  'purchase_roas',
  'account_currency',
];

const ROAS_HEADERS = [
  'Verified At',
  'Ad Account',
  'Window Start',
  'Window End',
  'Meta Spend',
  'Spend Currency',
  'Stripe Revenue',
  'Revenue Currency',
  'Verified ROAS',
  'Purchases',
  'Verified CPA',
  'Caveats',
];

const RULE_ACTION_HEADERS = [
  'Time',
  'Rule',
  'Entity Type',
  'Entity',
  'Entity ID',
  'Metric Value',
  'Action',
  'Detail',
  'Result',
  'Error',
];

const CAMPAIGN_HEADERS = [
  'Exported At',
  'Window Start',
  'Window End',
  'Campaign ID',
  'Campaign',
  'Spend',
  'Currency',
  'Impressions',
  'Clicks',
  'CTR %',
  'CPC',
  'Purchases',
  'CPA',
  'Meta ROAS',
];

/** Verified-ROAS snapshots: one row per verification run. */
export function roasSnapshotTable(snapshots: RoasSnapshot[]): ExportTable {
  return {
    headers: ROAS_HEADERS,
    rows: snapshots.map((snapshot) => [
      snapshot.createdAt.toISOString(),
      snapshot.adAccountId,
      snapshot.sinceDate,
      snapshot.untilDate,
      num(snapshot.metaSpend),
      snapshot.spendCurrency,
      num(snapshot.stripeRevenue),
      snapshot.revenueCurrency,
      num(snapshot.roas),
      snapshot.purchases,
      num(snapshot.cpa),
      snapshot.caveats?.join(' | ') ?? null,
    ]),
  };
}

/** Rule-engine audit rows: one per action the engine alerted on or executed. */
export function ruleActionTable(actions: AdRuleAction[]): ExportTable {
  return {
    headers: RULE_ACTION_HEADERS,
    rows: actions.map((action) => [
      action.createdAt.toISOString(),
      action.rule?.name ?? action.ruleId,
      action.entityType,
      action.entityName,
      action.entityId,
      num(action.metricValue),
      action.action,
      action.detail,
      action.success ? 'success' : 'failed',
      action.error,
    ]),
  };
}

/**
 * Meta campaign performance over a window. Every row carries the run time and
 * the window it covers, so repeated runs build a dated performance log rather
 * than an ambiguous pile of numbers.
 */
export function campaignInsightTable(
  rows: CampaignInsightRow[],
  window: { since: string; until: string; exportedAt: Date },
): ExportTable {
  const exportedAt = window.exportedAt.toISOString();
  return {
    headers: CAMPAIGN_HEADERS,
    rows: rows.map((row) => {
      const spend = num(row.spend);
      const purchases = pickPurchaseValue(row.actions);
      // Prefer Meta's own cost-per-purchase; fall back to spend ÷ purchases so a
      // row with conversions but no cost breakdown still reports a CPA.
      const cpa =
        pickPurchaseValue(row.cost_per_action_type) ??
        (spend != null && purchases ? round(spend / purchases, 2) : null);
      return [
        exportedAt,
        window.since,
        window.until,
        row.campaign_id ?? null,
        row.campaign_name ?? null,
        spend,
        row.account_currency ?? null,
        num(row.impressions),
        num(row.clicks),
        num(row.ctr),
        num(row.cpc),
        purchases,
        cpa,
        pickPurchaseValue(row.purchase_roas),
      ];
    }),
  };
}

/** Numeric strings (TypeORM `numeric` columns, Meta's API) as real numbers. */
function num(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
