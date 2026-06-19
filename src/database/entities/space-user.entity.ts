import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Space } from './space.entity';

/** A Space end-user's role within that Space (not a workspace role). */
export type SpaceUserRole = 'admin' | 'member';

/**
 * An end-user of a Space — i.e. someone who logs into the deployed app, not a
 * Gomer workspace member. Authentication is passwordless (magic link), so no
 * password or hash is ever stored here.
 */
@Index('UQ_space_users_space_email', ['spaceId', 'email'], { unique: true })
@Entity({ name: 'space_users' })
export class SpaceUser {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  spaceId!: string;

  @Column({ type: 'varchar', length: 320 })
  email!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'member' })
  role!: SpaceUserRole;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Space, (space) => space.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space!: Space;
}
