import assert from 'node:assert/strict';
import test from 'node:test';
import { AdRuleAction, RoasSnapshot } from '../database/entities';
import {
  campaignInsightTable,
  roasSnapshotTable,
  ruleActionTable,
  type CampaignInsightRow,
} from './export-tables';

const AT = new Date('2026-08-10T09:30:00.000Z');

function snapshot(overrides: Partial<RoasSnapshot> = {}): RoasSnapshot {
  return {
    adAccountId: 'act_123',
    sinceDate: '2026-08-01',
    untilDate: '2026-08-07',
    metaSpend: '1500.00',
    spendCurrency: 'PKR',
    stripeRevenue: '4200.50',
    revenueCurrency: 'PKR',
    roas: '2.8003',
    purchases: 12,
    cpa: '125.00',
    caveats: ['Revenue is blended.'],
    createdAt: AT,
    ...overrides,
  } as RoasSnapshot;
}

function action(overrides: Partial<AdRuleAction> = {}): AdRuleAction {
  return {
    ruleId: 'rule-1',
    entityType: 'campaign',
    entityId: '120253117340500195',
    entityName: 'Winter Sale',
    metricValue: '62.5000',
    action: 'pause',
    detail: 'Paused Winter Sale (CPA 62.5)',
    success: true,
    error: null,
    createdAt: AT,
    ...overrides,
  } as AdRuleAction;
}

/** Column counts must match the headers, or the sheet silently misaligns. */
function assertRectangular(table: { headers: string[]; rows: unknown[][] }): void {
  for (const row of table.rows) {
    assert.equal(row.length, table.headers.length);
  }
}

test('ROAS snapshots export as numbers, not numeric strings', () => {
  const table = roasSnapshotTable([snapshot()]);
  assertRectangular(table);

  const [row] = table.rows;
  assert.equal(row[0], AT.toISOString());
  assert.equal(row[4], 1500); // Meta spend
  assert.equal(row[6], 4200.5); // Stripe revenue
  assert.equal(row[8], 2.8003); // verified ROAS
  assert.equal(row[9], 12); // purchases
});

test('a ROAS snapshot with no computable ROAS leaves the cell blank, not "null"', () => {
  const table = roasSnapshotTable([snapshot({ roas: null, cpa: null, caveats: null })]);
  const [row] = table.rows;
  assert.equal(row[8], null);
  assert.equal(row[10], null);
  assert.equal(row[11], null);
});

test('rule actions name their rule and report success as a word', () => {
  const table = ruleActionTable([
    action({ rule: { name: 'Overnight CPA pause' } as AdRuleAction['rule'] }),
    action({ success: false, error: 'budget too low', detail: null }),
  ]);
  assertRectangular(table);

  assert.equal(table.rows[0][1], 'Overnight CPA pause');
  assert.equal(table.rows[0][5], 62.5);
  assert.equal(table.rows[0][8], 'success');
  // An action whose rule wasn't joined still identifies itself by id.
  assert.equal(table.rows[1][1], 'rule-1');
  assert.equal(table.rows[1][8], 'failed');
  assert.equal(table.rows[1][9], 'budget too low');
});

test('campaign insights pull purchases and CPA out of Meta typed-value arrays', () => {
  const rows: CampaignInsightRow[] = [
    {
      campaign_id: '120',
      campaign_name: 'Winter Sale',
      spend: '900.00',
      impressions: '15000',
      clicks: '320',
      ctr: '2.13',
      cpc: '2.81',
      account_currency: 'PKR',
      actions: [
        { action_type: 'link_click', value: '320' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '9' },
      ],
      cost_per_action_type: [
        { action_type: 'link_click', value: '2.81' },
        { action_type: 'offsite_conversion.fb_pixel_purchase', value: '100.00' },
      ],
      purchase_roas: [{ action_type: 'omni_purchase', value: '3.4' }],
    },
  ];
  const table = campaignInsightTable(rows, {
    since: '2026-08-01',
    until: '2026-08-07',
    exportedAt: AT,
  });
  assertRectangular(table);

  const [row] = table.rows;
  assert.equal(row[0], AT.toISOString()); // stamped so repeat runs stay readable
  assert.equal(row[5], 900); // spend
  assert.equal(row[11], 9); // purchases, not the link_click count
  assert.equal(row[12], 100); // CPA from Meta's own cost breakdown
  assert.equal(row[13], 3.4); // Meta ROAS
});

test('campaign CPA falls back to spend ÷ purchases when Meta omits the breakdown', () => {
  const table = campaignInsightTable(
    [
      {
        campaign_id: '121',
        spend: '450.00',
        actions: [{ action_type: 'purchase', value: '4' }],
      },
    ],
    { since: '2026-08-01', until: '2026-08-07', exportedAt: AT },
  );
  assert.equal(table.rows[0][12], 112.5);
});

test('a campaign with no conversions reports blanks rather than a bogus zero', () => {
  const table = campaignInsightTable([{ campaign_id: '122', spend: '80.00' }], {
    since: '2026-08-01',
    until: '2026-08-07',
    exportedAt: AT,
  });
  const [row] = table.rows;
  assert.equal(row[11], null); // purchases
  assert.equal(row[12], null); // CPA
  assert.equal(row[13], null); // ROAS
});

test('an empty dataset still carries its header contract', () => {
  const table = roasSnapshotTable([]);
  assert.equal(table.rows.length, 0);
  assert.ok(table.headers.includes('Verified ROAS'));
});
