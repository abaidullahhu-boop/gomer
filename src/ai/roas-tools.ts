import type { ToolSpec } from './providers/provider.interface';

/**
 * Local (client-side) tools for verified ROAS, executed by AiService against
 * {@link RoasService} — the same dispatch mechanism as the Meta Ads tools. Only
 * offered when the workspace has BOTH a Meta Ads and a Stripe connection, since
 * verification needs both sides.
 */

/** Tool names, shared between the definitions and AiService's dispatcher. */
export const VERIFY_ROAS = 'verify_roas';
export const LIST_ROAS_SNAPSHOTS = 'list_roas_snapshots';

const VERIFY_ROAS_TOOL: ToolSpec = {
  name: VERIFY_ROAS,
  description:
    'Compute VERIFIED ROAS/CPA for a window: Meta-reported ad spend paired with ACTUAL Stripe ' +
    "revenue (succeeded charges net of refunds) — the honest check on Meta's self-attributed " +
    'conversion numbers, which typically overstate revenue. Use for "what\'s our real ROAS?", ' +
    '"verify Meta\'s numbers", or any profitability question when Stripe is connected. The ' +
    'result is also saved as a snapshot for trend queries. Always relay the caveats to the ' +
    'user, especially that revenue is blended (all Stripe revenue in the window, not only ' +
    "ad-attributed). Compare the verified ROAS against the workspace's remembered target when " +
    'one exists. Returns JSON.',
  parameters: {
    type: 'object',
    properties: {
      ad_account_id: {
        type: 'string',
        description: 'The Meta ad account id from meta_ads_list_ad_accounts, e.g. "act_123".',
      },
      since: { type: 'string', description: 'Window start, YYYY-MM-DD (inclusive).' },
      until: { type: 'string', description: 'Window end, YYYY-MM-DD (inclusive).' },
      currency: {
        type: 'string',
        description:
          'Optional ISO currency (e.g. "usd") to count Stripe revenue in. Defaults to the ad ' +
          "account's currency, else the only currency present.",
      },
    },
    required: ['ad_account_id', 'since', 'until'],
  },
};

const LIST_ROAS_SNAPSHOTS_TOOL: ToolSpec = {
  name: LIST_ROAS_SNAPSHOTS,
  description:
    'List previously computed verified-ROAS snapshots for this workspace (newest first): the ' +
    'window, Meta spend, Stripe net revenue, verified ROAS/CPA, and purchases of each past ' +
    'verify_roas run. Use for trend questions ("is our real ROAS improving?") or to export a ' +
    'history (e.g. to Google Sheets) without recomputing. Returns JSON.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max snapshots to return (default 20).',
      },
    },
  },
};

/** The ROAS tool set, added only when Meta Ads AND Stripe are both connected. */
export const ROAS_TOOLS: ToolSpec[] = [VERIFY_ROAS_TOOL, LIST_ROAS_SNAPSHOTS_TOOL];

/** Every ROAS tool name, for the AiService dispatcher. */
export const ROAS_TOOL_NAMES = new Set<string>([VERIFY_ROAS, LIST_ROAS_SNAPSHOTS]);
