/**
 * Shared reading of Meta's typed-value insight arrays. Meta reports conversions
 * as `[{action_type, value}]` rather than plain fields, and which `action_type`
 * counts as "a purchase" depends on how the pixel fires — so the rule engine and
 * the Sheets exporter must agree on it, or a CPA rule and a CPA report on the
 * same account would quietly disagree.
 */

/** Meta `action_type`s that count as a purchase, for CPA/ROAS extraction. */
export const PURCHASE_ACTION_TYPES = new Set([
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
]);

/** One entry of a Meta typed-value array (actions, cost_per_action_type, …). */
export interface MetaTypedValue {
  action_type: string;
  value: string;
}

/**
 * The value of the purchase entry in a Meta typed-value array, if present.
 * Falls back to any action type containing "purchase" so an account using a
 * custom conversion still reports something rather than nothing.
 */
export function pickPurchaseValue(entries?: MetaTypedValue[]): number | null {
  if (!entries?.length) return null;
  const hit =
    entries.find((entry) => PURCHASE_ACTION_TYPES.has(entry.action_type)) ??
    entries.find((entry) => entry.action_type.includes('purchase'));
  return hit ? Number(hit.value) : null;
}
