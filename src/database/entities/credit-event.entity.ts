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

  @Column({ type: 'integer', default: 0 })
  tokensUsed!: number;

  @Column({ type: 'varchar', length: 128 })
  model!: string;

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
