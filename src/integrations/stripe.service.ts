import { Injectable, Logger } from '@nestjs/common';

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** Page size for charge listing (Stripe's maximum). */
const PAGE_LIMIT = 100;

/** Most pages fetched per window, bounding worst-case latency. */
const MAX_PAGES = 10;

/** Currencies Stripe treats as zero-decimal (amounts are already major units). */
const ZERO_DECIMAL = new Set([
  'bif',
  'clp',
  'djf',
  'gnf',
  'jpy',
  'kmf',
  'krw',
  'mga',
  'pyg',
  'rwf',
  'ugx',
  'vnd',
  'vuv',
  'xaf',
  'xof',
  'xpf',
]);

/** Revenue totals for one currency over a window, in major units. */
export interface StripeRevenueByCurrency {
  currency: string;
  grossRevenue: number;
  refunded: number;
  netRevenue: number;
  charges: number;
  uniqueCustomers: number;
}

export interface StripeRevenueResult {
  byCurrency: StripeRevenueByCurrency[];
  /** True when the window had more charges than we paged through. */
  truncated: boolean;
}

/** A charge row as returned by Stripe's list endpoint (the fields we read). */
interface StripeCharge {
  id: string;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: string;
  paid: boolean;
  customer: string | null;
}

/**
 * A thin client for the Stripe API, used by ROAS verification to read actual
 * revenue (the ground truth Meta's self-reported conversions are checked
 * against). Deliberately stateless: the caller passes the API key, resolved
 * from the workspace's Pipedream-connected Stripe account — mirroring how
 * MetaAdsService keeps token concerns out of its request helpers.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  /**
   * Sum succeeded charge revenue over a window, net of refunds, grouped by
   * currency. Paginates Stripe's charge list up to a page cap; `truncated`
   * flags when the window had more charges than we read.
   */
  async getRevenue(apiKey: string, since: Date, until: Date): Promise<StripeRevenueResult> {
    const totals = new Map<
      string,
      { gross: number; refunded: number; charges: number; customers: Set<string> }
    >();
    let startingAfter: string | undefined;
    let truncated = false;

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const query = new URLSearchParams({
        limit: String(PAGE_LIMIT),
        'created[gte]': String(Math.floor(since.getTime() / 1000)),
        'created[lte]': String(Math.floor(until.getTime() / 1000)),
      });
      if (startingAfter) query.set('starting_after', startingAfter);

      const body = await this.get<{ data: StripeCharge[]; has_more: boolean }>(
        `charges?${query.toString()}`,
        apiKey,
      );

      for (const charge of body.data) {
        if (charge.status !== 'succeeded' || !charge.paid) continue;
        const currency = charge.currency.toLowerCase();
        const entry = totals.get(currency) ?? {
          gross: 0,
          refunded: 0,
          charges: 0,
          customers: new Set<string>(),
        };
        entry.gross += charge.amount;
        entry.refunded += charge.amount_refunded;
        entry.charges += 1;
        if (charge.customer) entry.customers.add(charge.customer);
        totals.set(currency, entry);
      }

      if (!body.has_more || !body.data.length) break;
      startingAfter = body.data[body.data.length - 1].id;
      if (page === MAX_PAGES - 1) truncated = true;
    }

    return {
      byCurrency: [...totals.entries()].map(([currency, entry]) => ({
        currency,
        grossRevenue: this.toMajor(entry.gross, currency),
        refunded: this.toMajor(entry.refunded, currency),
        netRevenue: this.toMajor(entry.gross - entry.refunded, currency),
        charges: entry.charges,
        uniqueCustomers: entry.customers.size,
      })),
      truncated,
    };
  }

  /** Convert a Stripe minor-unit amount to major units for its currency. */
  private toMajor(amount: number, currency: string): number {
    return ZERO_DECIMAL.has(currency) ? amount : Math.round(amount) / 100;
  }

  /**
   * Issue a GET against the Stripe API, translating Stripe's error envelope into
   * a thrown Error the tool dispatcher can surface to the model.
   */
  private async get<T>(path: string, apiKey: string): Promise<T> {
    const res = await fetch(`${STRIPE_BASE}/${path}`, {
      headers: { authorization: `Bearer ${apiKey}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; type?: string };
    } & Record<string, unknown>;
    if (!res.ok || body.error) {
      const message = body.error?.message ?? `Stripe API error (HTTP ${res.status})`;
      this.logger.warn(`Stripe GET ${path.split('?')[0]} failed: ${message}`);
      throw new Error(message);
    }
    return body as T;
  }
}
