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
import { Space } from './space.entity';

/**
 * A single row of data for one of a Space's entities. Rather than create a real
 * table per app, every Space stores its data here generically, keyed by
 * `entityName`, with the row's fields in `data` (validated against the Space's
 * spec before being written).
 */
@Index('IDX_space_records_space_entity', ['spaceId', 'entityName'])
@Entity({ name: 'space_records' })
export class SpaceRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  spaceId!: string;

  /** The spec entity this row belongs to (e.g. "Project", "TimeEntry"). */
  @Column({ type: 'varchar', length: 128 })
  entityName!: string;

  @Column({ type: 'jsonb' })
  data!: Record<string, unknown>;

  /** The Space end-user who created the row, if known. */
  @Column({ type: 'uuid', nullable: true })
  createdBySpaceUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Space, (space) => space.records, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'spaceId' })
  space!: Space;
}
