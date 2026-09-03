import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CreditBucket } from '../common/enums';
import {
  SpendableGrant,
  TRIAL_CREDITS_FLOOR,
  TRIAL_CREDITS_PER_SEAT,
  formatCredits,
  planAllocations,
} from './usage.service';

/** Shorthand for a grant with credits left on it. */
function grant(id: string, bucket: CreditBucket, remaining: number): SpendableGrant {
  return { id, bucket, remaining };
}

test('drains buckets in expiry order regardless of the order supplied', () => {
  // Deliberately shuffled: the planner must impose the order, not inherit it.
  const grants = [
    grant('reward', CreditBucket.REWARD, 1000),
    grant('topup', CreditBucket.TOPUP, 1000),
    grant('plan', CreditBucket.PLAN, 1000),
    grant('rollover', CreditBucket.ROLLOVER, 1000),
  ];

  const allocations = planAllocations(grants, 3500);

  assert.deepEqual(
    allocations.map((allocation) => allocation.grantId),
    ['rollover', 'plan', 'topup', 'reward'],
  );
  assert.deepEqual(
    allocations.map((allocation) => allocation.credits),
    [1000, 1000, 1000, 500],
  );
});

test('never touches never-expiring credits while expiring ones remain', () => {
  // The commercial point of the whole design: a workspace inside its plan
  // leaves its top-ups and rewards untouched, so given credits are rarely
  // redeemed and bought credits keep their value.
  const allocations = planAllocations(
    [
      grant('plan', CreditBucket.PLAN, 20_000),
      grant('topup', CreditBucket.TOPUP, 40_000),
      grant('reward', CreditBucket.REWARD, 10_000),
    ],
    15_000,
  );

  assert.equal(allocations.length, 1);
  assert.equal(allocations[0]?.bucket, CreditBucket.PLAN);
  assert.equal(allocations[0]?.credits, 15_000);
});

test('spends rollover before this period even though both expire', () => {
  const allocations = planAllocations(
    [grant('plan', CreditBucket.PLAN, 20_000), grant('rollover', CreditBucket.ROLLOVER, 5_000)],
    6_000,
  );

  assert.deepEqual(allocations, [
    { grantId: 'rollover', bucket: CreditBucket.ROLLOVER, credits: 5_000 },
    { grantId: 'plan', bucket: CreditBucket.PLAN, credits: 1_000 },
  ]);
});

test('splits one run across several grants in the same bucket', () => {
  // Two plan grants can coexist mid-renewal; both must be drawn on.
  const allocations = planAllocations(
    [grant('plan-a', CreditBucket.PLAN, 300), grant('plan-b', CreditBucket.PLAN, 900)],
    1_000,
  );

  assert.equal(
    allocations.reduce((total, allocation) => total + allocation.credits, 0),
    1_000,
  );
  assert.equal(allocations.length, 2);
});

test('drains to zero and leaves the shortfall unallocated when overdrawn', () => {
  const allocations = planAllocations([grant('plan', CreditBucket.PLAN, 400)], 1_000);

  assert.equal(allocations.length, 1);
  assert.equal(allocations[0]?.credits, 400);
});

test('allocates nothing when the workspace holds nothing', () => {
  assert.deepEqual(planAllocations([], 500), []);
});

test('skips exhausted grants rather than emitting zero-credit rows', () => {
  const allocations = planAllocations(
    [grant('spent', CreditBucket.ROLLOVER, 0), grant('plan', CreditBucket.PLAN, 100)],
    50,
  );

  assert.deepEqual(allocations, [{ grantId: 'plan', bucket: CreditBucket.PLAN, credits: 50 }]);
});

test('renders credits as the dollars they represent', () => {
  assert.equal(formatCredits(10_000), '$25');
  assert.equal(formatCredits(20_000), '$50');
  assert.equal(formatCredits(150), '$0.38');
});

test('the trial is worth $100 to a solo workspace, as the pricing page promises', () => {
  // Regression guard. These were once written as raw credit counts, and the
  // literals survived the move from 100 to 400 credits per dollar untouched —
  // silently cutting a solo signup's trial from $100 to $25 while the public
  // page still advertised $100. Deriving both from the rate is the fix; this
  // test is what stops the next denomination change reintroducing it.
  assert.equal(formatCredits(TRIAL_CREDITS_FLOOR), '$100');
  assert.equal(formatCredits(TRIAL_CREDITS_PER_SEAT), '$25');
});

test('the trial scales for real teams but never drops below the floor', () => {
  const trialFor = (seats: number) => Math.max(TRIAL_CREDITS_FLOOR, seats * TRIAL_CREDITS_PER_SEAT);

  assert.equal(formatCredits(trialFor(1)), '$100');
  assert.equal(formatCredits(trialFor(4)), '$100');
  assert.equal(formatCredits(trialFor(10)), '$250');
});
