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
 * For Pipedream accounts the level is mirrored by the `external_user_id` the
 * account lives under (workspace id for `team`, a per-user namespace for
 * `private`), so isolation holds at the Pipedream boundary and not just in our
 * queries. For `meta` accounts the isolation is enforced by our queries alone
 * (a Meta connection is one OAuth grant scoped by its own token).
 */
export type IntegrationAccessLevel = 'team' | 'private';

/**
 * Which backend brokers a connection's MCP toolset:
 * - `pipedream`: connected through Pipedream Connect (the default; most apps).
 * - `meta`: connected directly to Meta's hosted Ads MCP via Meta Business OAuth,
 *   with the OAuth token material stored on this row.
 */
export type IntegrationProvider = 'pipedream' | 'meta';

/**
 * A connection to an external application (Gmail, Stripe, Shopify, Meta Ads, …).
 * Most apps are brokered by Pipedream Connect; `meta` connections talk directly
 * to Meta's hosted MCP using OAuth tokens stored on this row. Shared across the
 * workspace when `accessLevel` is `team`, kept to the connecting member when
 * `private`.
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

  /** Which backend brokers this connection's MCP toolset. */
  @Column({ type: 'varchar', length: 16, default: 'pipedream' })
  provider!: IntegrationProvider;

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

  /**
   * OAuth access token for `meta` connections, used as the bearer credential
   * against Meta's hosted MCP. Short-lived — refreshed from {@link refreshToken}
   * when {@link tokenExpiresAt} has passed. Null for Pipedream connections.
   */
  @Column({ type: 'text', nullable: true })
  accessToken!: string | null;

  /** OAuth refresh token for `meta` connections. Null for Pipedream. */
  @Column({ type: 'text', nullable: true })
  refreshToken!: string | null;

  /** When {@link accessToken} expires, so we know to refresh before a run. */
  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt!: Date | null;

  /** Space-separated OAuth scopes granted to a `meta` connection. */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  scopes!: string | null;

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
