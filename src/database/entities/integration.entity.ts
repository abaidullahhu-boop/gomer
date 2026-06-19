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
 * How widely a connected account is shared within its workspace:
 * - `team`: visible to and usable by every member (the default).
 * - `private`: visible to and usable only by the member who connected it.
 *
 * The level is mirrored by the Pipedream `external_user_id` the account lives
 * under (workspace id for `team`, a per-user namespace for `private`), so the
 * isolation holds at the Pipedream boundary and not just in our queries.
 */
export type IntegrationAccessLevel = 'team' | 'private';

/**
 * A connection to an external application (Gmail, Stripe, Shopify, …) connected
 * through Pipedream Connect. Shared across the workspace when `accessLevel` is
 * `team`, kept to the connecting member when `private`.
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

  /** A member-set label to tell several accounts of the same app apart. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  nickname!: string | null;

  /** Who in the workspace may see and use this account. */
  @Column({ type: 'varchar', length: 16, default: 'team' })
  accessLevel!: IntegrationAccessLevel;

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
