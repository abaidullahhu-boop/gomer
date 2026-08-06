import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CreditEventType } from '../../common/enums';
import { ScheduledTask } from './scheduled-task.entity';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * An immutable record of credit (and token) consumption, attributed to either an
 * interactive thread or a scheduled task.
 */
@Entity({ name: 'credit_events' })
export class CreditEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  taskId!: string | null;

  @Column({ type: 'enum', enum: CreditEventType })
  type!: CreditEventType;

  @Column({ type: 'varchar', length: 255 })
  sourceName!: string;

  @Column({ type: 'integer', default: 0 })
  creditsUsed!: number;

  /** Input + output, kept denormalised so analytics reads stay one column. */
  @Column({ type: 'integer', default: 0 })
  tokensUsed!: number;

  /** Billed at the model's input rate, which is far cheaper than output. */
  @Column({ type: 'integer', default: 0 })
  inputTokens!: number;

  @Column({ type: 'integer', default: 0 })
  outputTokens!: number;

  /**
   * The cached slices of {@link inputTokens} (already included in it). Broken
   * out because a cache write and a cache read are billed to us at different
   * rates than fresh input, so without them {@link providerCostUsd} cannot be
   * reconstructed or re-derived if prices change. Zero on providers that report
   * no cache split, which is indistinguishable from a run that cached nothing —
   * both cost the same.
   */
  @Column({ type: 'integer', default: 0 })
  cacheWriteTokens!: number;

  @Column({ type: 'integer', default: 0 })
  cacheReadTokens!: number;

  @Column({ type: 'varchar', length: 128 })
  model!: string;

  /**
   * The model that actually served the run. Router ids like `auto/best-coding`
   * resolve to a different backend per call, so `model` alone cannot explain
   * what happened; null when the provider served exactly what was asked for.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  resolvedModel!: string | null;

  /**
   * What the run cost *us* in USD, as opposed to `creditsUsed` which is what the
   * workspace was charged. Taken from the provider's reported cost when it gives
   * one, otherwise derived from the model's list price. Free routes record 0,
   * which is a real cost and not a missing value — hence the default rather than
   * null.
   */
  @Column({ type: 'numeric', precision: 12, scale: 6, default: 0 })
  providerCostUsd!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.creditEvents, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, (user) => user.creditEvents, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;

  @ManyToOne(() => ScheduledTask, (task) => task.creditEvents, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'taskId' })
  task!: ScheduledTask | null;
}
