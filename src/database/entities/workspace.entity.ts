import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CreditEvent } from './credit-event.entity';
import { Integration } from './integration.entity';
import { Message } from './message.entity';
import { ScheduledTask } from './scheduled-task.entity';
import { User } from './user.entity';

/**
 * A tenant. Each workspace maps 1:1 to a Slack workspace (team).
 */
@Entity({ name: 'workspaces' })
export class Workspace {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  slackTeamId!: string;

  @Column({ type: 'text', nullable: true })
  slackBotToken!: string | null;

  @Column({ type: 'integer', default: 0 })
  credits!: number;

  @Column({ type: 'text', nullable: true })
  workspaceInstructions!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  defaultModel!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  personalityTone!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  accessControl!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @OneToMany(() => User, (user) => user.workspace)
  users!: User[];

  @OneToMany(() => Integration, (integration) => integration.workspace)
  integrations!: Integration[];

  @OneToMany(() => ScheduledTask, (task) => task.workspace)
  tasks!: ScheduledTask[];

  @OneToMany(() => CreditEvent, (creditEvent) => creditEvent.workspace)
  creditEvents!: CreditEvent[];

  @OneToMany(() => Message, (message) => message.workspace)
  messages!: Message[];
}
