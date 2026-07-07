export enum CreditGrantReason {
  /** The one-time free credits every new workspace starts with. */
  ONBOARDING = 'onboarding',
  /** Credits purchased through the Stripe top-up flow. */
  TOPUP = 'topup',
  /** Credits granted by hand (support, promotions, refunds-in-kind). */
  MANUAL = 'manual',
}
