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
 * A connection to an external application (Gmail, Stripe, Shopify, …) connected
 * through Pipedream Connect and shared across a workspace.
 */
@Index('UQ_integrations_workspace_account', ['workspaceId', 'externalAccountId'], {
  unique: true,
})
@Entity({ name: 'integrations' })
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 128 })
  appName!: string;

  @Column({ type: 'varchar', length: 128 })
  appSlug!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  externalAccountId!: string | null;

  /** The user-facing label of the connected account (from Pipedream). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  accountName!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  iconUrl!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  connectedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.integrations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;
}
