import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CreditGrantReason } from '../../common/enums';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * An immutable record of credits added to a workspace — the income side of the
 * ledger whose expense side is {@link CreditEvent}. A workspace's balance is
 * the sum of its grants minus the sum of its credit events; neither table is
 * ever mutated, so the accounting stays auditable.
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

  @Column({ type: 'integer' })
  credits!: number;

  /** What was paid for the grant, in the currency's minor unit. Null when free. */
  @Column({ type: 'integer', nullable: true })
  amountCents!: number | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  /** The Stripe Checkout session that paid for a top-up — unique, so a webhook
   * retry can never double-grant. */
  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  stripeSessionId!: string | null;

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
}
