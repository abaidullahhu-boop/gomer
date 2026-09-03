import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CreditBucket } from '../../common/enums';
import { CreditEvent } from './credit-event.entity';
import { CreditGrant } from './credit-grant.entity';

/**
 * Which grant paid for which run, and how much of it.
 *
 * Without this table a workspace has one number for a balance, and "spend the
 * soonest-expiring credits first" has nowhere to record what it decided. With
 * it, a single {@link CreditEvent} costing more than any one grant holds splits
 * across several rows — rollover first, then plan, then top-up, then reward —
 * and each grant's remaining balance is its `credits` minus the allocations
 * against it.
 *
 * Both sides are immutable, so the split is permanent evidence: when a customer
 * asks why their rollover vanished, the answer is a query rather than a guess.
 */
@Entity({ name: 'credit_allocations' })
@Index(['grantId', 'creditEventId'], { unique: true })
export class CreditAllocation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The run this paid for. Null only on rows written by the migration that
   * introduced buckets: consumption from before allocations existed is real and
   * has to be subtracted from the grants, but it cannot be attributed to a
   * single event after the fact. Everything written since is attributed.
   */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  creditEventId!: string | null;

  @Index()
  @Column({ type: 'uuid' })
  grantId!: string;

  /** Denormalised from the grant so per-bucket reporting needs no join. */
  @Column({ type: 'enum', enum: CreditBucket })
  bucket!: CreditBucket;

  @Column({ type: 'integer' })
  credits!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => CreditEvent, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'creditEventId' })
  creditEvent!: CreditEvent | null;

  @ManyToOne(() => CreditGrant, (grant) => grant.allocations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grantId' })
  grant!: CreditGrant;
}
