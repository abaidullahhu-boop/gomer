import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageRole } from '../../common/enums';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * A single message in a conversation thread between a user and the assistant.
 */
@Entity({ name: 'messages' })
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'uuid', nullable: true })
  userId!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  threadId!: string;

  @Column({ type: 'enum', enum: MessageRole })
  role!: MessageRole;

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, (user) => user.messages, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'userId' })
  user!: User | null;
}
