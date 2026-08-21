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
import { CreditGrantReason } from '../common/enums';
import { UsageService } from '../usage/usage.service';

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** How stale a webhook's signed timestamp may be before it is rejected. */
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** A purchasable credit bundle. 1 credit = $0.01, so credits = cents paid. */
export interface CreditPack {
  id: string;
  label: string;
  amountCents: number;
  credits: number;
}

/**
 * The packs offered on the billing page. Credits map 1:1 to cents so what the
 * grants ledger records as revenue is exactly what Stripe collected.
 */
export const CREDIT_PACKS: CreditPack[] = [
  { id: 'starter', label: 'Starter — $25', amountCents: 2500, credits: 2500 },
  { id: 'growth', label: 'Growth — $50', amountCents: 5000, credits: 5000 },
  { id: 'scale', label: 'Scale — $100', amountCents: 10000, credits: 10000 },
  { id: 'pro', label: 'Pro — $250', amountCents: 25000, credits: 25000 },
];

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
  ) {}

  getPacks(): CreditPack[] {
    return CREDIT_PACKS;
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
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) throw new BadRequestException(`Unknown credit pack: ${packId}`);

    const secretKey = this.configService.get('billing', { infer: true }).stripeSecretKey;
    if (!secretKey) {
      throw new ServiceUnavailableException('Billing is not configured (set STRIPE_SECRET_KEY)');
    }

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

    const res = await fetch(`${STRIPE_BASE}/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    } & StripeCheckoutSession;
    if (!res.ok || body.error || !body.url) {
      const message = body.error?.message ?? `Stripe API error (HTTP ${res.status})`;
      this.logger.warn(`Checkout session creation failed: ${message}`);
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
      data?: { object?: StripeCheckoutSession };
    };
    if (event.type !== 'checkout.session.completed') return { received: true };

    const session = event.data?.object;
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
