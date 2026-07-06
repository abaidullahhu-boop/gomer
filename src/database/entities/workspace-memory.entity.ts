import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * A durable workspace fact — a key/value the assistant remembers across every
 * conversation (e.g. "target_roas" → "3.0"). Written and deleted by the model
 * via the memory tools; injected into the system prompt on every run.
 */
@Entity({ name: 'workspace_memory' })
@Index(['workspaceId', 'key'], { unique: true })
export class WorkspaceMemory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** Short, stable identifier for the fact, e.g. "target_roas". */
  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  /** The member whose conversation last set the fact. Null for system writes. */
  @Column({ type: 'uuid', nullable: true })
  updatedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'updatedByUserId' })
  updatedBy!: User | null;
}
