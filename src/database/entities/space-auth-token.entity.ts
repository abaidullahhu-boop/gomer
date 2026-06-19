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

/**
 * A single-use magic-link token for a Space end-user. The raw token is emailed
 * (or, in dev, surfaced in the response); only its bcrypt hash is stored, the
 * same way refresh tokens are handled for workspace users.
 */
@Entity({ name: 'space_auth_tokens' })
export class SpaceAuthToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  spaceId!: string;

  /** The email the link was issued to (the eventual SpaceUser identity). */
  @Column({ type: 'varchar', length: 320 })
  email!: string;

  /** bcrypt hash of the raw token; the raw value never touches the database. */
  @Column({ type: 'varchar', length: 255 })
  tokenHash!: string;

  @Column({ type: 'timestamptz' })
  expiresAt!: Date;

  /** Set when the token is redeemed, making it single-use. */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Space, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space!: Space;
}
