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
import { TaskType } from '../../common/enums';
import { CreditEvent } from './credit-event.entity';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * A cron-scheduled (or one-time) automation that runs a prompt on a workspace's behalf.
 */
@Entity({ name: 'scheduled_tasks' })
export class ScheduledTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 128 })
  cronExpression!: string;

  /**
   * IANA timezone the cron expression is interpreted in (e.g. "Asia/Karachi").
   * Null falls back to the server's local time.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'enum', enum: TaskType, default: TaskType.USER })
  type!: TaskType;

  /**
   * Model override for this task's runs. Null means "Team default" — the
   * workspace's configured model is used at execution time.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  model!: string | null;

  /** The member who created the task (its "Author"). Null for system tasks. */
  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastRun!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRun!: Date | null;

  @Column({ type: 'boolean', default: false })
  oneTime!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.tasks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: User | null;

  @OneToMany(() => CreditEvent, (creditEvent) => creditEvent.task)
  creditEvents!: CreditEvent[];
}
