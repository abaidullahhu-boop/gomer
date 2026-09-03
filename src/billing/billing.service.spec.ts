import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppConfig } from '../config/configuration';
import { UsageService } from '../usage/usage.service';
import { BillingService, subscriptionIdFromInvoice } from './billing.service';
import { SubscriptionsService } from './subscriptions.service';

const WEBHOOK_SECRET = 'whsec_test';

const configStub = {
  get: (key: string) =>
    key === 'billing'
      ? { stripeSecretKey: 'sk_test', stripeWebhookSecret: WEBHOOK_SECRET }
      : { frontendUrl: 'https://example.test' },
} as unknown as ConfigService<AppConfig, true>;

/** A paid checkout.session.completed body, signed the way Stripe signs it. */
function signedEvent(sessionId: string): { raw: Buffer; header: string } {
  const raw = Buffer.from(
    JSON.stringify({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          payment_status: 'paid',
          amount_total: 5000,
          currency: 'usd',
          metadata: { workspaceId: 'ws-1', credits: '5000', packId: 'growth' },
        },
      },
    }),
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(raw)
    .digest('hex');
  return { raw, header: `t=${timestamp},v1=${signature}` };
}

/** A UsageService stub recording grants, with a unique index on session id. */
function usageStub(options: { alreadyGranted?: boolean; raceOnInsert?: boolean } = {}) {
  const granted: Array<{ credits: number }> = [];
  return {
    granted,
    service: {
      hasGrantForStripeSession: () => Promise.resolve(Boolean(options.alreadyGranted)),
      grantCredits: (input: { credits: number }) => {
        if (options.raceOnInsert) {
          // What Postgres raises when the concurrent delivery inserted first.
          return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
        }
        granted.push(input);
        return Promise.resolve({} as never);
      },
    } as unknown as UsageService,
  };
}

/** A SubscriptionsService stub — the top-up paths never reach it. */
function subscriptionsStub() {
  return {
    findByStripeId: () => Promise.resolve(null),
    syncFromStripe: () => Promise.resolve({} as never),
    markStatus: () => Promise.resolve(),
    applyRenewal: () => Promise.resolve({ applied: false }),
  } as unknown as SubscriptionsService;
}

test('credits a workspace on a correctly signed paid session', async () => {
  const usage = usageStub();
  const service = new BillingService(configStub, usage.service, subscriptionsStub());
  const { raw, header } = signedEvent('cs_test_1');

  assert.deepEqual(await service.handleWebhook(raw, header), { received: true });
  assert.equal(usage.granted.length, 1);
  assert.equal(usage.granted[0]?.credits, 5000);
});

test('rejects a forged signature', async () => {
  const usage = usageStub();
  const service = new BillingService(configStub, usage.service, subscriptionsStub());
  const { raw } = signedEvent('cs_test_2');
  const timestamp = Math.floor(Date.now() / 1000);

  await assert.rejects(
    () => service.handleWebhook(raw, `t=${timestamp},v1=${'0'.repeat(64)}`),
    UnauthorizedException,
  );
  assert.equal(usage.granted.length, 0);
});

test('rejects a replayed signature outside the freshness window', async () => {
  const usage = usageStub();
  const service = new BillingService(configStub, usage.service, subscriptionsStub());
  const raw = Buffer.from('{}');
  const stale = Math.floor(Date.now() / 1000) - 60 * 60;
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${stale}.`)
    .update(raw)
    .digest('hex');

  await assert.rejects(
    () => service.handleWebhook(raw, `t=${stale},v1=${signature}`),
    UnauthorizedException,
  );
});

test('acks a retry of an already-credited session without double-granting', async () => {
  const usage = usageStub({ alreadyGranted: true });
  const service = new BillingService(configStub, usage.service, subscriptionsStub());
  const { raw, header } = signedEvent('cs_test_3');

  assert.deepEqual(await service.handleWebhook(raw, header), { received: true });
  assert.equal(usage.granted.length, 0);
});

test('acks — rather than 500s — when a concurrent delivery wins the insert race', async () => {
  // Both deliveries clear hasGrantForStripeSession, then the unique index
  // rejects the loser. Surfacing that as an error would make Stripe retry a
  // payment that is already credited until the delivery fails permanently.
  const usage = usageStub({ raceOnInsert: true });
  const service = new BillingService(configStub, usage.service, subscriptionsStub());
  const { raw, header } = signedEvent('cs_test_4');

  assert.deepEqual(await service.handleWebhook(raw, header), { received: true });
});

test('ignores event types it has no handler for', async () => {
  const usage = usageStub();
  const service = new BillingService(configStub, usage.service, subscriptionsStub());
  const raw = Buffer.from(JSON.stringify({ type: 'payment_intent.succeeded' }));
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.`)
    .update(raw)
    .digest('hex');

  assert.deepEqual(await service.handleWebhook(raw, `t=${timestamp},v1=${signature}`), {
    received: true,
  });
  assert.equal(usage.granted.length, 0);
});

test('reads the subscription from an invoice on either Stripe API version', () => {
  // Pre-2025-03-31 shape.
  assert.equal(subscriptionIdFromInvoice({ id: 'in_1', subscription: 'sub_legacy' }), 'sub_legacy');

  // The shape Stripe moved to, which a newer webhook endpoint receives.
  assert.equal(
    subscriptionIdFromInvoice({
      id: 'in_2',
      parent: { subscription_details: { subscription: 'sub_modern' } },
    }),
    'sub_modern',
  );

  // Expanded rather than an id, on either shape.
  assert.equal(
    subscriptionIdFromInvoice({ id: 'in_3', subscription: { id: 'sub_expanded' } }),
    'sub_expanded',
  );
});

test('treats an invoice with no subscription as not ours, rather than crashing', () => {
  assert.equal(subscriptionIdFromInvoice({ id: 'in_4' }), null);
  assert.equal(subscriptionIdFromInvoice({ id: 'in_5', subscription: null }), null);
  assert.equal(
    subscriptionIdFromInvoice({ id: 'in_6', parent: { subscription_details: null } }),
    null,
  );
});
