import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { AppSpec } from '../../spaces/spec/app-spec';
import { SpaceRecord } from './space-record.entity';
import { SpaceUser } from './space-user.entity';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/** Lifecycle of a Space: a draft is editable, a published one is live. */
export type SpaceStatus = 'draft' | 'published';

/**
 * What a Space is: an `app` rendered from its spec by the shared runtime, or a
 * `page` Gaspo wrote as a whole HTML document, for plans, reports and
 * calculators that people read rather than fill in.
 */
export type SpaceKind = 'app' | 'page';

/**
 * A web app built by Gaspo for a workspace. An app's shape lives entirely in
 * `spec` (a declarative JSON app spec); a single shared runtime renders any app
 * from its spec, so no per-app code is generated or executed, and data its
 * end-users enter is stored generically in {@link SpaceRecord}. A page is the
 * exception: its `html` is generated code, which the runtime only ever runs in
 * a sandboxed frame with no access to Gaspo's own origin.
 */
@Entity({ name: 'spaces' })
export class Space {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** The workspace member who asked Gaspo to build it. */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  /** Stable, human-readable identifier used in the public URL (`/s/:slug`). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  slug!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** The declarative app spec the runtime renders. */
  @Column({ type: 'jsonb' })
  spec!: AppSpec;

  @Column({ type: 'varchar', length: 16, default: 'published' })
  status!: SpaceStatus;

  @Column({ type: 'varchar', length: 16, default: 'app' })
  kind!: SpaceKind;

  /**
   * A page's whole HTML document; null for an app. Not selected by default, so
   * the runtime's per-request lookups do not haul it around.
   */
  @Column({ type: 'text', nullable: true, select: false })
  html!: string | null;

  /** What a page saves as people use it, by key. Shared by everyone who opens it. */
  @Column({ type: 'jsonb', default: {}, select: false })
  pageState!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Workspace, (workspace) => workspace.spaces, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: User | null;

  @OneToMany(() => SpaceUser, (spaceUser) => spaceUser.space)
  members!: SpaceUser[];

  @OneToMany(() => SpaceRecord, (record) => record.space)
  records!: SpaceRecord[];
}
