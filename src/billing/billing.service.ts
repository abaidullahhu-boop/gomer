import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../config/configuration';
import { CreditGrantReason, SubscriptionStatus } from '../common/enums';
import { UsageService } from '../usage/usage.service';
import {
  CREDIT_PACKS,
  CreditPack,
  SUBSCRIPTION_PLANS,
  SubscriptionPlan,
  findPack,
  findPlan,
} from './plans';
import { StripeSubscriptionShape, SubscriptionsService } from './subscriptions.service';

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** How stale a webhook's signed timestamp may be before it is rejected. */
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Invoice reasons that mean "a new period started". Stripe raises invoices for
 * prorations and manual charges too, and those must not grant an allowance.
 */
const RENEWAL_REASONS = ['subscription_create', 'subscription_cycle'];

/** A field Stripe returns either as an id or, when expanded, as an object. */
type StripeRef = string | { id?: string } | null | undefined;

/** The fields we read off a Stripe invoice. */
interface StripeInvoiceShape {
  id: string;
  /** Where the subscription lives on API versions before 2025-03-31. */
  subscription?: StripeRef;
  /** Where it moved to afterwards. */
  parent?: { subscription_details?: { subscription?: StripeRef } | null } | null;
  billing_reason?: string;
  /** The invoice's first line carries the period it paid for. */
  lines?: { data?: Array<{ period?: { start: number; end: number } }> };
}

/** Unwrap an id that may have arrived expanded into a full object. */
function refId(ref: StripeRef): string | null {
  if (typeof ref === 'string') return ref || null;
  return typeof ref?.id === 'string' && ref.id ? ref.id : null;
}

/**
 * The subscription an invoice belongs to, read from either place Stripe puts it.
 *
 * Stripe API versions from 2025-03-31 moved this off the invoice and under
 * `parent.subscription_details`. A webhook endpoint pins its own version, so
 * which shape arrives depends on when the endpoint was created — and the
 * platform's account and a client's can easily differ. Reading both costs
 * nothing; reading one silently ignores every renewal on the other, which is
 * the worst failure this file can have.
 */
export function subscriptionIdFromInvoice(invoice: StripeInvoiceShape): string | null {
  return refId(invoice.subscription) ?? refId(invoice.parent?.subscription_details?.subscription);
}

export { CREDIT_PACKS, SUBSCRIPTION_PLANS };
export type { CreditPack, SubscriptionPlan };

/** Postgres `unique_violation`, raised when a duplicate grant loses the race. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { code?: string }).code === '23505' ||
      (error as { driverError?: { code?: string } }).driverError?.code === '23505')
  );
}

/** The fields we read off a Stripe Checkout Session. */
interface StripeCheckoutSession {
  id: string;
  url?: string | null;
  /** `payment` for a top-up, `subscription` for a plan. */
  mode?: string;
  payment_status?: string;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string>;
}

/**
 * Credit top-ups through the platform's own Stripe account: creates Checkout
 * sessions and turns verified `checkout.session.completed` webhooks into
 * credit grants. Unrelated to {@link StripeService}, which reads a *customer's*
 * Stripe account for ROAS verification.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly usageService: UsageService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  getPacks(): CreditPack[] {
    return CREDIT_PACKS;
  }

  getPlans(): SubscriptionPlan[] {
    return SUBSCRIPTION_PLANS;
  }

  /** The Stripe secret, or a clear failure when billing was never configured. */
  private secretKey(): string {
    const key = this.configService.get('billing', { infer: true }).stripeSecretKey;
    if (!key) {
      throw new ServiceUnavailableException('Billing is not configured (set STRIPE_SECRET_KEY)');
    }
    return key;
  }

  /**
   * Start a recurring subscription checkout.
   *
   * Like the top-up flow this builds its price inline rather than referencing a
   * Stripe Price object, so the plan ladder stays defined in one place —
   * `plans.ts` — instead of being split between this repo and the Stripe
   * dashboard, where the two would drift and nobody would notice until a
   * customer was charged the wrong amount.
   */
  async createSubscriptionSession(
    workspaceId: string,
    userId: string | null,
    planId: string,
  ): Promise<{ checkoutUrl: string }> {
    const plan = findPlan(planId);
    if (!plan) throw new BadRequestException(`Unknown plan: ${planId}`);

    const billingPage = `${this.configService.get('app', { infer: true }).frontendUrl}/dashboard/billing`;
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: `${billingPage}?subscription=success`,
      cancel_url: `${billingPage}?subscription=cancelled`,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': `Gomer ${plan.label} plan`,
      'line_items[0][price_data][unit_amount]': String(plan.priceCents),
      'line_items[0][price_data][recurring][interval]': 'month',
      'line_items[0][quantity]': '1',
      'metadata[workspaceId]': workspaceId,
      'metadata[planId]': plan.id,
      // Mirrored onto the subscription itself: webhooks for renewals arrive
      // against the subscription, not the checkout session, and would otherwise
      // have no way back to the workspace that owns it.
      'subscription_data[metadata][workspaceId]': workspaceId,
      'subscription_data[metadata][planId]': plan.id,
      'managed_payments[enabled]': 'false',
    });
    if (userId) form.set('metadata[userId]', userId);

    const body = await this.stripePost<{ url?: string }>('checkout/sessions', form);
    if (!body.url) {
      throw new ServiceUnavailableException('Could not start the checkout — try again shortly.');
    }
    return { checkoutUrl: body.url };
  }

  /**
   * A link into Stripe's own billing portal for this workspace.
   *
   * Deliberately not a bespoke cancel button. The portal covers updating a
   * failed card, cancelling, resuming, and downloading invoices — and the card
   * case is the one that matters most: a `past_due` workspace currently has no
   * way to fix its payment method anywhere in Gomer, so the subscription simply
   * dies. Rebuilding that flow means holding card details ourselves, which is a
   * different compliance question entirely.
   *
   * Whatever the customer changes comes back through the subscription webhooks,
   * so the local mirror stays correct without polling.
   */
  async createPortalSession(workspaceId: string): Promise<{ portalUrl: string }> {
    const subscription = await this.subscriptionsService.findForWorkspace(workspaceId);
    if (!subscription) {
      throw new BadRequestException('This workspace has no subscription to manage.');
    }

    const billingPage = `${this.configService.get('app', { infer: true }).frontendUrl}/dashboard/billing`;
    const body = await this.stripePost<{ url?: string }>(
      'billing_portal/sessions',
      new URLSearchParams({
        customer: subscription.stripeCustomerId,
        return_url: billingPage,
      }),
    );
    if (!body.url) {
      throw new ServiceUnavailableException(
        'Could not open the billing portal — try again shortly.',
      );
    }
    return { portalUrl: body.url };
  }

  /** POST a form to Stripe, raising a clean 503 on any non-2xx. */
  private async stripePost<T>(path: string, form: URLSearchParams): Promise<T> {
    const res = await fetch(`${STRIPE_BASE}/${path}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey()}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok || body.error) {
      const message = body.error?.message ?? `Stripe API error (HTTP ${res.status})`;
      this.logger.warn(`Stripe ${path} failed: ${message}`);
      throw new ServiceUnavailableException('Could not reach Stripe — try again shortly.');
    }
    return body;
  }

  /**
   * Create a Stripe Checkout session for a credit pack and return its payment
   * URL. The workspace/user/pack ride along as session metadata, which is what
   * the webhook trusts when it records the grant.
   */
  async createTopupSession(
    workspaceId: string,
    userId: string | null,
    packId: string,
  ): Promise<{ checkoutUrl: string }> {
    const pack = findPack(packId);
    if (!pack) throw new BadRequestException(`Unknown credit pack: ${packId}`);

    const billingPage = `${this.configService.get('app', { infer: true }).frontendUrl}/dashboard/billing`;
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${billingPage}?topup=success`,
      cancel_url: `${billingPage}?topup=cancelled`,
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][product_data][name]': `Gomer credits — ${pack.label}`,
      'line_items[0][price_data][unit_amount]': String(pack.amountCents),
      'line_items[0][quantity]': '1',
      'metadata[workspaceId]': workspaceId,
      'metadata[packId]': pack.id,
      'metadata[credits]': String(pack.credits),
      // Managed Payments — Stripe acting as merchant of record — is on by
      // default for accounts created from mid-2026, and it rejects any
      // line item whose product carries no tax code. We build prices inline
      // with price_data and have no product catalogue to hang a tax code on,
      // so every session 400s with "the product tax code is missing".
      //
      // Opting out per session keeps this working regardless of the account's
      // default, which a dashboard toggle could otherwise change under us.
      // Adopting Managed Payments later is a tax decision, not a code one: it
      // needs a real tax code per pack and changes who remits VAT.
      'managed_payments[enabled]': 'false',
    });
    if (userId) form.set('metadata[userId]', userId);

    const body = await this.stripePost<StripeCheckoutSession>('checkout/sessions', form);
    if (!body.url) {
      throw new ServiceUnavailableException('Could not start the checkout — try again shortly.');
    }
    return { checkoutUrl: body.url };
  }

  /**
   * Handle a Stripe webhook delivery: verify the signature over the raw bytes,
   * then turn a paid `checkout.session.completed` into a credit grant. The
   * grant is idempotent on the session id, so Stripe's retries can't
   * double-credit. Other event types are acknowledged and ignored.
   */
  async handleWebhook(rawBody: Buffer | undefined, signatureHeader: string | undefined) {
    if (!rawBody) throw new BadRequestException('Missing request body');
    this.verifySignature(rawBody, signatureHeader);

    const event = JSON.parse(rawBody.toString('utf8')) as {
      type?: string;
      data?: { object?: Record<string, unknown> };
    };

    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckoutCompleted(event.data?.object as StripeCheckoutSession | undefined);
      case 'invoice.paid':
        return this.onInvoicePaid(event.data?.object as StripeInvoiceShape | undefined);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        return this.onSubscriptionChanged(
          event.data?.object as StripeSubscriptionShape | undefined,
        );
      case 'customer.subscription.deleted':
        return this.onSubscriptionDeleted(
          event.data?.object as StripeSubscriptionShape | undefined,
        );
      default:
        return { received: true };
    }
  }

  /**
   * A completed checkout. Subscription checkouts are acknowledged and ignored
   * here: their credits are granted by `invoice.paid`, which is the event that
   * actually means money arrived, and which also fires for every renewal after
   * this one. Granting on both would double the first period.
   */
  private async onCheckoutCompleted(session: StripeCheckoutSession | undefined) {
    if (session?.mode === 'subscription') return { received: true };
    const workspaceId = session?.metadata?.workspaceId;
    const credits = Number(session?.metadata?.credits ?? 0);
    if (!session?.id || !workspaceId || !Number.isFinite(credits) || credits <= 0) {
      this.logger.warn(`checkout.session.completed missing metadata (session ${session?.id})`);
      return { received: true };
    }
    if (session.payment_status && session.payment_status !== 'paid') return { received: true };
    if (await this.usageService.hasGrantForStripeSession(session.id)) return { received: true };

    try {
      await this.usageService.grantCredits({
        workspaceId,
        userId: session.metadata?.userId ?? null,
        reason: CreditGrantReason.TOPUP,
        credits,
        amountCents: session.amount_total ?? null,
        currency: session.currency ?? null,
        stripeSessionId: session.id,
        note: `Top-up (${session.metadata?.packId ?? 'unknown pack'})`,
      });
    } catch (error) {
      // Two deliveries of the same session can both clear the check above and
      // race to insert. The unique index on stripeSessionId settles it — the
      // loser must still ack, or Stripe retries a payment that is already
      // credited until the delivery is marked permanently failed.
      if (!isUniqueViolation(error)) throw error;
      this.logger.log(`Ignored a concurrent duplicate of Stripe session ${session.id}`);
      return { received: true };
    }
    this.logger.log(`Granted ${credits} credits to workspace ${workspaceId} (${session.id})`);
    return { received: true };
  }

  /**
   * A paid invoice — the event that grants a subscription period's credits.
   *
   * This fires for the first payment and for every renewal, which is precisely
   * the set of moments an allowance should land, so both paths run the same
   * code. `subscription_create` and `subscription_cycle` are the two reasons we
   * act on; a proration or a one-off invoice line is not a new period and must
   * not mint a new allowance.
   */
  private async onInvoicePaid(invoice: StripeInvoiceShape | undefined) {
    if (!invoice?.id) return { received: true };
    if (invoice.billing_reason && !RENEWAL_REASONS.includes(invoice.billing_reason)) {
      return { received: true };
    }

    const stripeSubscriptionId = subscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) {
      // A one-off invoice carries no subscription and is genuinely not ours to
      // act on. Logged all the same: if this ever fires for a renewal, it means
      // Stripe moved the field again and every allowance is being dropped.
      this.logger.log(`invoice.paid ${invoice.id} carries no subscription; ignored`);
      return { received: true };
    }

    const subscription = await this.subscriptionsService.findByStripeId(stripeSubscriptionId);
    if (!subscription) {
      // The subscription webhook has not landed yet. Stripe retries a 5xx, and
      // by the next delivery `customer.subscription.created` will have created
      // the row — so fail loudly rather than silently dropping the allowance.
      this.logger.warn(`invoice.paid for unknown subscription ${stripeSubscriptionId}; retrying`);
      throw new ServiceUnavailableException('Subscription not yet synced');
    }

    const periodEnd = invoice.lines?.data?.[0]?.period?.end;
    const result = await this.subscriptionsService.applyRenewal(
      subscription,
      invoice.id,
      periodEnd ? new Date(periodEnd * 1000) : subscription.currentPeriodEnd,
    );
    if (result.applied) {
      this.logger.log(
        `Renewed ${subscription.workspaceId}: ${result.planCredits} plan credits, ` +
          `${result.rolledOver} rolled over, ${result.seatBonus} seat bonus`,
      );
    }
    return { received: true };
  }

  /** A subscription was created or changed — mirror it locally. */
  private async onSubscriptionChanged(stripe: StripeSubscriptionShape | undefined) {
    const workspaceId = stripe?.metadata?.workspaceId;
    const planId = stripe?.metadata?.planId;
    if (!stripe?.id || !workspaceId || !planId) {
      this.logger.warn(`subscription event missing workspace metadata (${stripe?.id})`);
      return { received: true };
    }
    await this.subscriptionsService.syncFromStripe(workspaceId, planId, stripe);
    return { received: true };
  }

  /**
   * A subscription ended. The status changes; the credits do not.
   *
   * Credits already granted for the paid period keep their original expiry,
   * because the customer paid for that period. What stops is the next
   * allowance — there simply is no further `invoice.paid`.
   */
  private async onSubscriptionDeleted(stripe: StripeSubscriptionShape | undefined) {
    if (!stripe?.id) return { received: true };
    await this.subscriptionsService.markStatus(stripe.id, SubscriptionStatus.CANCELED);
    return { received: true };
  }

  /**
   * Verify Stripe's `stripe-signature` header: HMAC-SHA256 of
   * `${timestamp}.${rawBody}` with the webhook signing secret, within a
   * freshness window. Throws 401 on any mismatch.
   */
  private verifySignature(rawBody: Buffer, header: string | undefined): void {
    const secret = this.configService.get('billing', { infer: true }).stripeWebhookSecret;
    if (!secret) {
      throw new ServiceUnavailableException(
        'Billing webhook is not configured (set STRIPE_WEBHOOK_SECRET)',
      );
    }
    if (!header) throw new UnauthorizedException('Missing Stripe signature');

    const parts = new Map<string, string[]>();
    for (const pair of header.split(',')) {
      const [key, value] = pair.split('=', 2);
      if (!key || !value) continue;
      parts.set(key.trim(), [...(parts.get(key.trim()) ?? []), value.trim()]);
    }
    const timestamp = Number(parts.get('t')?.[0]);
    const signatures = parts.get('v1') ?? [];
    if (!Number.isFinite(timestamp) || !signatures.length) {
      throw new UnauthorizedException('Malformed Stripe signature');
    }
    if (Math.abs(Date.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new UnauthorizedException('Stripe signature timestamp out of tolerance');
    }

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const valid = signatures.some((signature) => {
      const candidate = Buffer.from(signature, 'hex');
      return candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf);
    });
    if (!valid) throw new UnauthorizedException('Invalid Stripe signature');
  }
}
