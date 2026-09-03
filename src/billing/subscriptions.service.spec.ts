import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEAT_BONUS_CAP, SEAT_BONUS_CREDITS, FREE_SEATS } from '../usage/usage.service';
import { SubscriptionsService } from './subscriptions.service';

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
