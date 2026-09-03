import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CreditBucket, CreditGrantReason } from '../../common/enums';
import { CreditAllocation } from './credit-allocation.entity';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * An immutable record of credits added to a workspace — the income side of the
 * ledger whose expense side is {@link CreditEvent}.
 *
 * A grant is never mutated, not even as it is spent: what remains on it is
 * `credits` minus the {@link CreditAllocation} rows pointing at it. That keeps
 * the accounting auditable, and it is what makes expiry safe — an expired grant
 * still shows exactly how much of it was used before it died.
 */
@Entity({ name: 'credit_grants' })
export class CreditGrant {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** The member who triggered the grant (bought the top-up). Null for system grants. */
  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'enum', enum: CreditGrantReason })
  reason!: CreditGrantReason;

  /**
   * Which pot these credits land in, and so where they sit in the spend order.
   * Derived from `reason` at grant time but stored separately: several reasons
   * map to REWARD, and the bucket is what the spend query filters on.
   */
  @Index()
  @Column({ type: 'enum', enum: CreditBucket, default: CreditBucket.TOPUP })
  bucket!: CreditBucket;

  @Column({ type: 'integer' })
  credits!: number;

  /**
   * When these credits stop being spendable. Null means never, which is the
   * whole distinction between a top-up and a plan allowance.
   *
   * Indexed because every balance read filters on it.
   */
  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  /** What was paid for the grant, in the currency's minor unit. Null when free. */
  @Column({ type: 'integer', nullable: true })
  amountCents!: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  /** The Stripe Checkout session that paid for a top-up — unique, so a webhook
   * retry can never double-grant. */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  stripeSessionId!: string | null;

  /**
   * The Stripe invoice that paid for a subscription period. Unique for the same
   * reason as `stripeSessionId`: `invoice.paid` is delivered at least once, and
   * a renewal must grant exactly one allowance however many times it arrives.
   */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  stripeInvoiceId!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @OneToMany(() => CreditAllocation, (allocation) => allocation.grant)
  allocations!: CreditAllocation[];
}
