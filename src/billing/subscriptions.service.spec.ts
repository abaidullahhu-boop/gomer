import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEAT_BONUS_CAP, SEAT_BONUS_CREDITS, FREE_SEATS } from '../usage/usage.service';
import { StripeSubscriptionShape, SubscriptionsService } from './subscriptions.service';

/**
 * The seat bonus is pure arithmetic on the service, so it can be exercised
 * without the repositories the constructor otherwise needs.
 */
function service(): SubscriptionsService {
  return new SubscriptionsService(null as never, null as never, null as never, null as never);
}

test('pays no bonus at or below the free seat threshold', () => {
  const subscriptions = service();
  assert.equal(subscriptions.seatBonusFor(1), 0);
  assert.equal(subscriptions.seatBonusFor(FREE_SEATS), 0);
});

test('pays per seat above the threshold', () => {
  const subscriptions = service();
  assert.equal(subscriptions.seatBonusFor(FREE_SEATS + 1), SEAT_BONUS_CREDITS);
  assert.equal(subscriptions.seatBonusFor(FREE_SEATS + 3), SEAT_BONUS_CREDITS * 3);
});

test('caps the bonus so a large team cannot invert the plan economics', () => {
  const subscriptions = service();
  assert.equal(subscriptions.seatBonusFor(10_000), SEAT_BONUS_CAP);
});

test('treats a nonsensical seat count as no bonus rather than a negative one', () => {
  const subscriptions = service();
  assert.equal(subscriptions.seatBonusFor(0), 0);
  assert.equal(subscriptions.seatBonusFor(-5), 0);
});

/**
 * A service whose repository keeps rows in memory, enough to drive
 * `syncFromStripe` end to end without a database.
 */
function syncingService(existing: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  const repository = {
    findOne: () => Promise.resolve(existing),
    create: (row: Record<string, unknown>) => row,
    save: (row: Record<string, unknown>) => {
      saved.push(row);
      return Promise.resolve(row);
    },
  };
  const subscriptions = new SubscriptionsService(
    repository as never,
    null as never,
    null as never,
    null as never,
  );
  return { subscriptions, saved };
}

const START = 1_790_000_000;
const END = START + 30 * 24 * 60 * 60;

function stripeSubscription(fields: Partial<StripeSubscriptionShape>): StripeSubscriptionShape {
  return { id: 'sub_1', customer: 'cus_1', status: 'active', ...fields };
}

test('reads the period off the subscription item, where current API versions put it', async () => {
  const { subscriptions, saved } = syncingService();
  await subscriptions.syncFromStripe(
    'ws_1',
    'starter',
    stripeSubscription({
      items: { data: [{ current_period_start: START, current_period_end: END }] },
    }),
  );
  assert.equal((saved[0].currentPeriodStart as Date).getTime(), START * 1000);
  assert.equal((saved[0].currentPeriodEnd as Date).getTime(), END * 1000);
});

test('still reads the period off the subscription on older API versions', async () => {
  const { subscriptions, saved } = syncingService();
  await subscriptions.syncFromStripe(
    'ws_1',
    'starter',
    stripeSubscription({ current_period_start: START, current_period_end: END }),
  );
  assert.equal((saved[0].currentPeriodEnd as Date).getTime(), END * 1000);
});

test('refuses to insert a subscription with no period rather than writing an Invalid Date', async () => {
  const { subscriptions, saved } = syncingService();
  await assert.rejects(subscriptions.syncFromStripe('ws_1', 'starter', stripeSubscription({})));
  assert.equal(saved.length, 0);
});

test('keeps the stored period when an update for a known subscription carries none', async () => {
  const stored = { currentPeriodStart: new Date(0), currentPeriodEnd: new Date(1000) };
  const { subscriptions, saved } = syncingService(stored);
  await subscriptions.syncFromStripe(
    'ws_1',
    'starter',
    stripeSubscription({ status: 'canceled', cancel_at_period_end: true }),
  );
  assert.equal(saved[0].currentPeriodEnd, stored.currentPeriodEnd);
  assert.equal(saved[0].cancelAtPeriodEnd, true);
});
