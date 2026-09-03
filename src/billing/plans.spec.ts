import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CREDITS_PER_DOLLAR, CREDIT_MARGIN, creditRates } from '../ai/providers/model-catalog';
import { CREDIT_PACKS, SUBSCRIPTION_PLANS, findPack, findPlan } from './plans';

test('every plan sits at the published rate once its declared bonus is removed', () => {
  for (const plan of SUBSCRIPTION_PLANS) {
    assert.equal(
      plan.monthlyCredits - (plan.bonusCredits ?? 0),
      (plan.priceCents / 100) * CREDITS_PER_DOLLAR,
      `plan ${plan.id} is off the rate`,
    );
  }
});

test('top-ups are priced at the same rate as plans', () => {
  // A cheaper top-up would make the subscription the worse deal and unwind the
  // recurring revenue the plans exist to create.
  for (const pack of CREDIT_PACKS) {
    assert.equal(
      pack.credits,
      (pack.amountCents / 100) * CREDITS_PER_DOLLAR,
      `pack ${pack.id} is off the rate`,
    );
  }
});

test('the plan ladder carries no undeclared volume discount', () => {
  // Generosity is allowed, but only where a plan says so. An unannounced better
  // rate on a large tier is how a ladder silently stops covering its costs.
  const rates = SUBSCRIPTION_PLANS.map(
    (plan) => (plan.monthlyCredits - (plan.bonusCredits ?? 0)) / (plan.priceCents / 100),
  );
  assert.equal(new Set(rates).size, 1, 'plans should all be the same credits per dollar');
});

test('lookup helpers reject an unknown id rather than guessing', () => {
  assert.equal(findPlan('starter')?.priceCents, 5_000);
  assert.equal(findPlan('does-not-exist'), undefined);
  assert.equal(findPack('growth')?.credits, 20_000);
  assert.equal(findPack('does-not-exist'), undefined);
});

test('model rates carry no markup over list price', () => {
  // The pricing page claims a credit maps to what the provider charges. At
  // CREDIT_MARGIN 1 that is literally true, and this test is what keeps the
  // claim honest if someone edits the constant.
  assert.equal(CREDIT_MARGIN, 1);

  // $5 per million input tokens, at 400 credits to the dollar, is 2 credits per
  // 1K — half a cent, which is what the million-token price divides down to.
  const opus = { inputPricePerMillion: 5, outputPricePerMillion: 25 } as Parameters<
    typeof creditRates
  >[0];
  assert.deepEqual(creditRates(opus), { input: 2, output: 10 });
});
