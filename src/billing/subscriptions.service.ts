import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreditBucket, CreditGrantReason, SubscriptionStatus } from '../common/enums';
import { ENTITLED_STATUSES } from '../common/enums';
import { CreditAllocation, CreditGrant, Subscription } from '../database/entities';
import {
  FREE_SEATS,
  GRANT_ALIAS,
  SEAT_BONUS_CAP,
  SEAT_BONUS_CREDITS,
  formatCredits,
} from '../usage/usage.service';
import { UsersService } from '../users/users.service';
import { SubscriptionPlan, findPlan } from './plans';

/** The shape of a Stripe subscription object, in the fields we act on. */
export interface StripeSubscriptionShape {
  id: string;
  customer: string;
  status: string;
  current_period_start: number;
  current_period_end: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
}

/** What a renewal did, for logging and for the tests to assert against. */
export interface RenewalResult {
  planCredits: number;
  rolledOver: number;
  seatBonus: number;
  /** False when this invoice had already been applied. */
  applied: boolean;
}

/**
 * The recurring side of billing: mirrors Stripe subscriptions locally, and
 * turns each paid period into the credit grants that period buys.
 *
 * Separate from {@link BillingService}, which handles one-off top-ups. The two
 * both talk to Stripe but they are different products with different expiry
 * rules, and merging them produced a class where every method needed to ask
 * which kind of purchase it was looking at.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(CreditGrant)
    private readonly creditGrantRepository: Repository<CreditGrant>,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  findForWorkspace(workspaceId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({ where: { workspaceId } });
  }

  findByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({ where: { stripeSubscriptionId } });
  }

  /** Whether a workspace currently carries a plan allowance. */
  async isEntitled(workspaceId: string): Promise<boolean> {
    const subscription = await this.findForWorkspace(workspaceId);
    return Boolean(subscription && ENTITLED_STATUSES.includes(subscription.status));
  }

  /**
   * Mirror a Stripe subscription object into the local row.
   *
   * Stripe owns every field here, so this overwrites rather than merges: a
   * partial update would leave the local copy describing a state Stripe has
   * already moved on from.
   */
  async syncFromStripe(
    workspaceId: string,
    planId: string,
    stripe: StripeSubscriptionShape,
  ): Promise<Subscription> {
    const existing = await this.subscriptionRepository.findOne({
      where: { stripeSubscriptionId: stripe.id },
    });

    const row = this.subscriptionRepository.create({
      ...(existing ?? {}),
      workspaceId,
      planId,
      status: this.toStatus(stripe.status),
      stripeSubscriptionId: stripe.id,
      stripeCustomerId: stripe.customer,
      currentPeriodStart: new Date(stripe.current_period_start * 1000),
      currentPeriodEnd: new Date(stripe.current_period_end * 1000),
      cancelAtPeriodEnd: Boolean(stripe.cancel_at_period_end),
    });
    return this.subscriptionRepository.save(row);
  }

  /**
   * Apply one paid period: carry forward what is left, grant the new
   * allowance, and pay the seat bonus.
   *
   * Ordering matters and is not arbitrary. The rollover is measured *before*
   * the new allowance lands, or the new credits would themselves look like
   * unspent balance and roll into their own successor, compounding an allowance
   * that was never bought.
   *
   * Idempotent on the invoice id: `invoice.paid` is delivered at least once,
   * and a renewal that ran twice would double a customer's allowance. The
   * unique index on `stripeInvoiceId` is the real guard — the pre-check below
   * only saves the work in the common case.
   */
  async applyRenewal(
    subscription: Subscription,
    stripeInvoiceId: string,
    periodEnd: Date,
  ): Promise<RenewalResult> {
    const plan = findPlan(subscription.planId);
    if (!plan) {
      this.logger.error(
        `Subscription ${subscription.id} names unknown plan "${subscription.planId}" — no credits granted`,
      );
      return { planCredits: 0, rolledOver: 0, seatBonus: 0, applied: false };
    }

    const already = await this.creditGrantRepository.findOne({ where: { stripeInvoiceId } });
    if (already) {
      return { planCredits: 0, rolledOver: 0, seatBonus: 0, applied: false };
    }

    const seats = await this.usersService.countActiveByWorkspace(subscription.workspaceId);
    const seatBonus = this.seatBonusFor(seats);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const grants = manager.getRepository(CreditGrant);
        const rolledOver = await this.unspentPlanCredits(manager, subscription.workspaceId);

        if (rolledOver > 0) {
          await grants.save(
            grants.create({
              workspaceId: subscription.workspaceId,
              reason: CreditGrantReason.ROLLOVER,
              bucket: CreditBucket.ROLLOVER,
              credits: rolledOver,
              expiresAt: periodEnd,
              note: `Carried forward from the previous period (${formatCredits(rolledOver)})`,
            }),
          );
        }

        await grants.save(
          grants.create({
            workspaceId: subscription.workspaceId,
            reason: CreditGrantReason.SUBSCRIPTION,
            bucket: CreditBucket.PLAN,
            credits: plan.monthlyCredits,
            expiresAt: periodEnd,
            amountCents: plan.priceCents,
            currency: 'usd',
            stripeInvoiceId,
            note: `${plan.label} plan — monthly allowance`,
          }),
        );

        if (seatBonus > 0) {
          await grants.save(
            grants.create({
              workspaceId: subscription.workspaceId,
              reason: CreditGrantReason.SEAT_BONUS,
              bucket: CreditBucket.REWARD,
              credits: seatBonus,
              note: `Team bonus — ${seats - FREE_SEATS} seat(s) over ${FREE_SEATS} (${formatCredits(seatBonus)})`,
            }),
          );
        }

        await manager.getRepository(Subscription).update(subscription.id, {
          seats,
          currentPeriodEnd: periodEnd,
        });

        return { planCredits: plan.monthlyCredits, rolledOver, seatBonus, applied: true };
      });
    } catch (error) {
      // The unique index fired: a concurrent delivery of the same invoice won
      // the race and already granted this period. Not an error.
      if (isUniqueViolation(error)) {
        return { planCredits: 0, rolledOver: 0, seatBonus: 0, applied: false };
      }
      throw error;
    }
  }

  /**
   * Credits left on the plan allowance that is about to be replaced.
   *
   * Only the PLAN bucket rolls. Last period's rollover does not roll again —
   * that is what "carries for one month" means, and re-rolling it would let an
   * unused allowance survive indefinitely.
   */
  private async unspentPlanCredits(
    manager: { getRepository: DataSource['getRepository'] },
    workspaceId: string,
  ): Promise<number> {
    const raw = await manager
      .getRepository(CreditGrant)
      .createQueryBuilder(GRANT_ALIAS)
      .leftJoin(CreditAllocation, 'allocation', `allocation."grantId" = ${GRANT_ALIAS}.id`)
      .select(
        `COALESCE(SUM(${GRANT_ALIAS}.credits), 0) - COALESCE(SUM(allocation.credits), 0)`,
        'remaining',
      )
      .where(`${GRANT_ALIAS}."workspaceId" = :workspaceId`, { workspaceId })
      .andWhere(`${GRANT_ALIAS}.bucket = :bucket`, { bucket: CreditBucket.PLAN })
      .andWhere(`(${GRANT_ALIAS}."expiresAt" IS NULL OR ${GRANT_ALIAS}."expiresAt" > NOW())`)
      .getRawOne<{ remaining: string }>();
    return Math.max(0, Number(raw?.remaining ?? 0));
  }

  /** The per-period team bonus: paid on seats above the threshold, capped. */
  seatBonusFor(seats: number): number {
    const billable = Math.max(0, seats - FREE_SEATS);
    return Math.min(billable * SEAT_BONUS_CREDITS, SEAT_BONUS_CAP);
  }

  /** Record a cancellation or lapse. The current period's credits still stand. */
  async markStatus(stripeSubscriptionId: string, status: SubscriptionStatus): Promise<void> {
    await this.subscriptionRepository.update({ stripeSubscriptionId }, { status });
  }

  /**
   * Map Stripe's status string onto ours, defaulting unknown values to
   * CANCELED — the safe direction, since a status we do not recognise is more
   * likely a subscription that stopped paying than one that started.
   */
  private toStatus(raw: string): SubscriptionStatus {
    const known = Object.values(SubscriptionStatus) as string[];
    return known.includes(raw) ? (raw as SubscriptionStatus) : SubscriptionStatus.CANCELED;
  }
}

/** Postgres `unique_violation`, raised when a duplicate grant loses the race. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    ((error as { code?: string }).code === '23505' ||
      (error as { driverError?: { code?: string } }).driverError?.code === '23505')
  );
}

export type { SubscriptionPlan };
