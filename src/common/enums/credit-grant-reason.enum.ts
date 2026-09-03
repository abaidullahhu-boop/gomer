export enum CreditGrantReason {
  /** The one-time free credits every new workspace starts with. */
  ONBOARDING = 'onboarding',
  /** Credits purchased through the Stripe top-up flow. */
  TOPUP = 'topup',
  /** Credits granted by hand (support, promotions, refunds-in-kind). */
  MANUAL = 'manual',
  /** A subscription period's allowance, granted when an invoice is paid. */
  SUBSCRIPTION = 'subscription',
  /** Last period's unspent allowance, carried into this one. */
  ROLLOVER = 'rollover',
  /** Earned by referring another workspace. */
  REFERRAL = 'referral',
  /** The per-seat bonus paid on teams above the free-seat threshold. */
  SEAT_BONUS = 'seat_bonus',
}
