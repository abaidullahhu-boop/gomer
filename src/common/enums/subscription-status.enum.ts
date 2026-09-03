/**
 * Mirrors the Stripe subscription statuses we act on. Stripe has more, but the
 * ones it omits here (`incomplete_expired`, `paused`, `unpaid`) all reduce to
 * "not entitled", which {@link ENTITLED_STATUSES} decides.
 */
export enum SubscriptionStatus {
  TRIALING = 'trialing',
  ACTIVE = 'active',
  /** Payment failed; Stripe is retrying. Access continues during the grace. */
  PAST_DUE = 'past_due',
  CANCELED = 'canceled',
  /** First payment never completed — no allowance was ever granted. */
  INCOMPLETE = 'incomplete',
}

/**
 * Statuses that still carry a monthly allowance. `past_due` is included
 * deliberately: Stripe retries a failed card for days, and cutting a paying
 * customer off on the first retry costs more goodwill than the credits are
 * worth. The allowance stops when Stripe gives up and moves to `canceled`.
 */
export const ENTITLED_STATUSES: readonly SubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];
