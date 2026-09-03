/**
 * Which pot a grant's credits live in. Buckets exist because credits differ in
 * one respect only — when they expire — and spending must therefore consume
 * them in a deliberate order rather than as one undifferentiated balance.
 *
 * The declaration order here is the spend order: soonest-expiring first. See
 * {@link SPEND_ORDER} in `usage.service.ts`, which depends on it.
 */
export enum CreditBucket {
  /** Last period's unspent plan credits, carried forward. Dies at period end. */
  ROLLOVER = 'rollover',
  /** This period's subscription allowance. Rolls over once, then dies. */
  PLAN = 'plan',
  /** Bought outright, on top of a plan. Never expires. */
  TOPUP = 'topup',
  /** Given away — trials, referrals, seat bonuses, goodwill. Never expires. */
  REWARD = 'reward',
}

/** Buckets whose credits are destroyed at `expiresAt` rather than kept. */
export const EXPIRING_BUCKETS: readonly CreditBucket[] = [CreditBucket.ROLLOVER, CreditBucket.PLAN];
