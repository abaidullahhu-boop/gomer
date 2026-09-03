import { CREDITS_PER_DOLLAR } from '../ai/providers/model-catalog';

/** A recurring plan: a monthly price and the allowance it buys. */
export interface SubscriptionPlan {
  id: string;
  label: string;
  /** Billed monthly, in cents. */
  priceCents: number;
  /** Credits granted at the start of every paid period. */
  monthlyCredits: number;
  /**
   * Credits granted above the flat rate, declared rather than baked into
   * `monthlyCredits`.
   *
   * A tier can be made deliberately more generous — but it has to say so here,
   * because the boot check below then still catches the case nobody intended: a
   * mistyped credit figure, which is invisible in review and quietly sells
   * credits at the wrong price.
   */
  bonusCredits?: number;
}

/** A one-off credit purchase, on top of a plan or without one. */
export interface CreditPack {
  id: string;
  label: string;
  amountCents: number;
  credits: number;
}

/**
 * The recurring plans, priced at a flat 400 credits per dollar.
 *
 * The ladder is deliberately linear — no volume discount — because the
 * allowance already expires monthly. A discount on top of breakage prices the
 * large plans below what they cost to serve for any customer who actually uses
 * them, and the customers who buy the largest plans are exactly the ones who do.
 *
 * Enterprise is absent on purpose: above this range the terms are negotiated,
 * and a published price only anchors that negotiation downwards.
 */
export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  { id: 'starter', label: 'Starter', priceCents: 5_000, monthlyCredits: 20_000 },
  { id: 'small', label: 'Small', priceCents: 7_500, monthlyCredits: 30_000 },
  { id: 'team', label: 'Team', priceCents: 10_000, monthlyCredits: 40_000 },
  { id: 'business', label: 'Business', priceCents: 20_000, monthlyCredits: 80_000 },
  // The one tier that breaks the flat rate: 5,000 credits ($12.50) more than
  // $300 buys elsewhere on the ladder, as a nudge over the step up in price.
  // Declared as a bonus so it reads as a decision rather than a typo.
  {
    id: 'scale',
    label: 'Scale',
    priceCents: 30_000,
    monthlyCredits: 125_000,
    bonusCredits: 5_000,
  },
];

/**
 * One-off top-ups, at the same 400 credits per dollar as the plans.
 *
 * Priced identically to a plan on purpose. A top-up buys credits that never
 * expire, so pricing it *below* the plan rate would make the subscription the
 * worse deal and turn every customer into an occasional top-up buyer — which is
 * the revenue model this whole design exists to move away from.
 */
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'starter', label: 'Starter — $25', amountCents: 2_500, credits: 10_000 },
  { id: 'growth', label: 'Growth — $50', amountCents: 5_000, credits: 20_000 },
  { id: 'scale', label: 'Scale — $100', amountCents: 10_000, credits: 40_000 },
  { id: 'pro', label: 'Pro — $250', amountCents: 25_000, credits: 100_000 },
];

export function findPlan(planId: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((plan) => plan.id === planId);
}

export function findPack(packId: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === packId);
}

/**
 * Sanity check run at module load: every plan and pack must sit at exactly
 * {@link CREDITS_PER_DOLLAR}. The two lists are edited by hand and a typo in a
 * credit figure is invisible in review but silently sells credits at the wrong
 * rate, so it fails the boot instead.
 */
for (const plan of SUBSCRIPTION_PLANS) {
  const expected = (plan.priceCents / 100) * CREDITS_PER_DOLLAR + (plan.bonusCredits ?? 0);
  if (plan.monthlyCredits !== expected) {
    throw new Error(
      `Plan "${plan.id}" grants ${plan.monthlyCredits} credits for $${plan.priceCents / 100}; ` +
        `expected ${expected} at ${CREDITS_PER_DOLLAR} credits per dollar` +
        `${plan.bonusCredits ? ` plus a ${plan.bonusCredits} bonus` : ''}.`,
    );
  }
}

for (const pack of CREDIT_PACKS) {
  const expected = (pack.amountCents / 100) * CREDITS_PER_DOLLAR;
  if (pack.credits !== expected) {
    throw new Error(
      `Pack "${pack.id}" grants ${pack.credits} credits for $${pack.amountCents / 100}; ` +
        `expected ${expected} at ${CREDITS_PER_DOLLAR} credits per dollar.`,
    );
  }
}
