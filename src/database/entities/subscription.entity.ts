import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SubscriptionStatus } from '../../common/enums';
import { Workspace } from './workspace.entity';

/**
 * A workspace's recurring plan, mirrored from Stripe.
 *
 * Stripe is the source of truth for the money; this row is the local shadow the
 * app reads on every request, because asking Stripe what someone is entitled to
 * is far too slow to do inline. Everything here is overwritten by webhooks, so
 * treat it as a cache with a ledger attached — never edit it by hand expecting
 * the change to stick.
 *
 * One per workspace: a workspace on two plans has an ambiguous allowance, so
 * the uniqueness is enforced in the database rather than trusted to the flow.
 */
@Entity({ name: 'subscriptions' })
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** Matches an id in `SUBSCRIPTION_PLANS`; decides the monthly allowance. */
  @Column({ type: 'varchar', length: 64 })
  planId!: string;

  @Column({ type: 'enum', enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  stripeSubscriptionId!: string;

  @Column({ type: 'varchar', length: 255 })
  stripeCustomerId!: string;

  /**
   * The period the current allowance belongs to. `currentPeriodEnd` is also the
   * expiry stamped on that allowance's grant, so the two can never drift.
   */
  @Column({ type: 'timestamptz' })
  currentPeriodStart!: Date;

  @Column({ type: 'timestamptz' })
  currentPeriodEnd!: Date;

  /**
   * Billable seats at the last renewal. Stored because the seat bonus is paid
   * per period against the headcount *then*, and a workspace that adds five
   * people mid-month must not retroactively earn five bonuses.
   */
  @Column({ type: 'integer', default: 0 })
  seats!: number;

  /** Set when the customer cancels but the paid period has not yet run out. */
  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;
}
