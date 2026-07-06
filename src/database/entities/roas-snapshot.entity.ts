import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * One verified-ROAS computation: Meta ad spend paired with actual Stripe
 * revenue over a window. Persisted so results are queryable over time (trend
 * questions, Sheets exports) and can feed the automated rule engine.
 */
@Entity({ name: 'roas_snapshots' })
export class RoasSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** The Meta ad account the spend side came from, e.g. "act_123". */
  @Column({ type: 'varchar', length: 64 })
  adAccountId!: string;

  /** Window start (inclusive), as a calendar date. */
  @Column({ type: 'date' })
  sinceDate!: string;

  /** Window end (inclusive), as a calendar date. */
  @Column({ type: 'date' })
  untilDate!: string;

  /** Meta-reported ad spend over the window, major units. */
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  metaSpend!: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  spendCurrency!: string | null;

  /** Stripe net revenue (succeeded charges minus refunds), major units. */
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  stripeRevenue!: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  revenueCurrency!: string | null;

  /** Verified ROAS (revenue ÷ spend). Null when currencies differ or spend is 0. */
  @Column({ type: 'numeric', precision: 10, scale: 4, nullable: true })
  roas!: string | null;

  /** Succeeded Stripe charges in the window (the purchase count). */
  @Column({ type: 'integer' })
  purchases!: number;

  /** Verified CPA (spend ÷ purchases). Null when there were no purchases. */
  @Column({ type: 'numeric', precision: 14, scale: 2, nullable: true })
  cpa!: string | null;

  /** Caveats affecting trust in the numbers (currency mismatch, truncation…). */
  @Column({ type: 'jsonb', nullable: true })
  caveats!: string[] | null;

  /** The member whose conversation ran the verification. Null for system runs. */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: User | null;
}
