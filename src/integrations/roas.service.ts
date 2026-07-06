import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RoasSnapshot } from '../database/entities';
import { IntegrationsService } from './integrations.service';
import { MetaAdsService } from './meta-ads.service';
import { StripeService } from './stripe.service';

/** Parameters for one verification: the account and the (inclusive) window. */
export interface VerifyRoasParams {
  adAccountId: string;
  /** Window start, YYYY-MM-DD. */
  since: string;
  /** Window end, YYYY-MM-DD. */
  until: string;
  /** Restrict Stripe revenue to one currency (else auto-picked). */
  currency?: string;
}

/** The verified-ROAS payload returned to the model (and persisted). */
export interface VerifiedRoas {
  adAccountId: string;
  since: string;
  until: string;
  metaSpend: number;
  spendCurrency: string | null;
  stripeNetRevenue: number;
  revenueCurrency: string | null;
  /** Revenue ÷ spend. Null when spend is 0 or the currencies differ. */
  verifiedRoas: number | null;
  purchases: number;
  uniqueCustomers: number;
  /** Spend ÷ purchases. Null when there were no purchases. */
  verifiedCpa: number | null;
  /** Stripe revenue in currencies other than the one used, for transparency. */
  otherCurrencies: Array<{ currency: string; netRevenue: number; charges: number }>;
  /** Anything that lowers trust in the numbers — surface these to the user. */
  caveats: string[];
}

/** A row of a Meta account-level insights response (the fields we read). */
interface MetaInsightRow {
  spend?: string;
  account_currency?: string;
}

/**
 * Verified ROAS: pairs Meta-reported ad spend with actual Stripe revenue over
 * the same window and computes the honest ROAS/CPA — the check on Meta's
 * self-attributed conversion numbers. Each verification is persisted as a
 * {@link RoasSnapshot} so results are queryable over time and can feed the
 * automated rule engine.
 */
@Injectable()
export class RoasService {
  private readonly logger = new Logger(RoasService.name);

  constructor(
    @InjectRepository(RoasSnapshot)
    private readonly snapshotRepository: Repository<RoasSnapshot>,
    private readonly integrationsService: IntegrationsService,
    private readonly metaAds: MetaAdsService,
    private readonly stripe: StripeService,
  ) {}

  /**
   * Run one verification for a member's connected accounts. Throws when either
   * side (Meta, Stripe) is unavailable — the tool dispatcher turns that into an
   * error result the model can relay.
   */
  async verify(
    workspaceId: string,
    userId: string | null,
    params: VerifyRoasParams,
  ): Promise<VerifiedRoas> {
    const [metaToken, stripeKey] = await Promise.all([
      this.integrationsService.getMetaAccessToken(workspaceId, userId ?? ''),
      this.integrationsService.getStripeApiKey(workspaceId, userId ?? ''),
    ]);
    if (!metaToken) throw new Error('No active Meta Ads connection is available.');
    if (!stripeKey) throw new Error('No active Stripe connection is available.');

    const caveats: string[] = [];

    // Spend side: Meta account-level insights over the window. Meta bills this,
    // so it's trustworthy — it's the revenue side Meta over-attributes.
    const insights = await this.metaAds.getInsights(metaToken, {
      adAccountId: params.adAccountId,
      level: 'account',
      since: params.since,
      until: params.until,
      fields: ['spend', 'account_currency'],
    });
    const rows = insights.data as MetaInsightRow[];
    const metaSpend = rows.reduce((sum, row) => sum + (Number(row.spend) || 0), 0);
    const spendCurrency = rows.find((row) => row.account_currency)?.account_currency ?? null;
    if (!rows.length) caveats.push('Meta returned no insight rows for this window (spend 0).');

    // Revenue side: actual Stripe charges, net of refunds. The window is the
    // calendar days inclusive, in UTC.
    const revenue = await this.stripe.getRevenue(
      stripeKey,
      new Date(`${params.since}T00:00:00Z`),
      new Date(`${params.until}T23:59:59Z`),
    );
    if (revenue.truncated) {
      caveats.push('Stripe charge list was truncated; revenue is undercounted for this window.');
    }

    // Pick the revenue currency: an explicit request wins, then the spend
    // currency, then the only currency present.
    const wanted = (params.currency ?? spendCurrency ?? '').toLowerCase();
    const chosen =
      revenue.byCurrency.find((row) => row.currency === wanted) ??
      (revenue.byCurrency.length === 1 ? revenue.byCurrency[0] : null);
    const otherCurrencies = revenue.byCurrency
      .filter((row) => row !== chosen)
      .map((row) => ({
        currency: row.currency,
        netRevenue: row.netRevenue,
        charges: row.charges,
      }));
    if (!chosen && revenue.byCurrency.length > 1) {
      caveats.push(
        'Stripe revenue spans multiple currencies and none matched the request; no single ROAS was computed.',
      );
    }

    const revenueCurrency = chosen?.currency ?? null;
    const stripeNetRevenue = chosen?.netRevenue ?? 0;
    const purchases = chosen?.charges ?? 0;
    const uniqueCustomers = chosen?.uniqueCustomers ?? 0;

    // ROAS only means something when both sides are in the same currency.
    const currenciesComparable =
      spendCurrency != null &&
      revenueCurrency != null &&
      spendCurrency.toLowerCase() === revenueCurrency;
    if (!currenciesComparable && spendCurrency && revenueCurrency) {
      caveats.push(
        `Spend is in ${spendCurrency} but revenue in ${revenueCurrency.toUpperCase()}; ROAS was not computed across currencies.`,
      );
    }
    caveats.push(
      'Revenue is ALL Stripe revenue in the window, not only ad-attributed purchases — treat this as blended ROAS/CPA.',
    );

    const verifiedRoas =
      metaSpend > 0 && currenciesComparable
        ? Math.round((stripeNetRevenue / metaSpend) * 10000) / 10000
        : null;
    const verifiedCpa = purchases > 0 ? Math.round((metaSpend / purchases) * 100) / 100 : null;

    const result: VerifiedRoas = {
      adAccountId: params.adAccountId,
      since: params.since,
      until: params.until,
      metaSpend: Math.round(metaSpend * 100) / 100,
      spendCurrency,
      stripeNetRevenue,
      revenueCurrency: revenueCurrency ? revenueCurrency.toUpperCase() : null,
      verifiedRoas,
      purchases,
      uniqueCustomers,
      verifiedCpa,
      otherCurrencies,
      caveats,
    };
    await this.persistSnapshot(workspaceId, userId, result);
    return result;
  }

  /** Recent verified-ROAS snapshots for a workspace, newest first. */
  async listSnapshots(workspaceId: string, limit = 20): Promise<RoasSnapshot[]> {
    return this.snapshotRepository.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Best-effort: losing a snapshot must never fail the verification itself. */
  private async persistSnapshot(
    workspaceId: string,
    userId: string | null,
    result: VerifiedRoas,
  ): Promise<void> {
    try {
      await this.snapshotRepository.save(
        this.snapshotRepository.create({
          workspaceId,
          adAccountId: result.adAccountId,
          sinceDate: result.since,
          untilDate: result.until,
          metaSpend: result.metaSpend.toFixed(2),
          spendCurrency: result.spendCurrency,
          stripeRevenue: result.stripeNetRevenue.toFixed(2),
          revenueCurrency: result.revenueCurrency,
          roas: result.verifiedRoas != null ? result.verifiedRoas.toFixed(4) : null,
          purchases: result.purchases,
          cpa: result.verifiedCpa != null ? result.verifiedCpa.toFixed(2) : null,
          caveats: result.caveats.length ? result.caveats : null,
          createdByUserId: userId,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to persist ROAS snapshot: ${message}`);
    }
  }
}
