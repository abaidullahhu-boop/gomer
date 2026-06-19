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
 * A web app built by Gomer for a workspace. The app's shape lives entirely in
 * `spec` (a declarative JSON app spec); a single shared runtime renders any
 * Space from its spec, so no per-app code is generated or executed. Data the
 * app's end-users enter is stored generically in {@link SpaceRecord}.
 */
@Entity({ name: 'spaces' })
export class Space {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /** The workspace member who asked Gomer to build it. */
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
