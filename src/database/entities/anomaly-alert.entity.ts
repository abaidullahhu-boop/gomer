import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Workspace } from './workspace.entity';

/**
 * A proactive anomaly alert the monitor has already sent — one row per
 * workspace/account/metric/day, so the hourly sweep can re-detect the same
 * anomaly all day without re-notifying anyone.
 */
@Entity({ name: 'anomaly_alerts' })
@Index(['workspaceId', 'adAccountId', 'metric', 'day'], { unique: true })
export class AnomalyAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 64 })
  adAccountId!: string;

  /** Which signal fired: 'cpa_spike', 'roas_drop', or 'spend_spike'. */
  @Column({ type: 'varchar', length: 32 })
  metric!: string;

  /** The calendar day (UTC) the anomaly was detected for. */
  @Column({ type: 'date' })
  day!: string;

  /** The message that was delivered to Slack. */
  @Column({ type: 'text' })
  message!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;
}
