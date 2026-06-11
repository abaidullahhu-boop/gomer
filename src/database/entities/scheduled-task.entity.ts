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

  @Column({ type: 'text' })
  prompt!: string;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'enum', enum: TaskType, default: TaskType.USER })
  type!: TaskType;

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

  @OneToMany(() => CreditEvent, (creditEvent) => creditEvent.task)
  creditEvents!: CreditEvent[];
}
