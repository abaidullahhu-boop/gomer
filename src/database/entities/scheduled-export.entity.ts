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
 * Which body of data an export writes to the sheet:
 *
 * - `roas_snapshots`: verified-ROAS runs (Meta spend vs actual Stripe revenue).
 * - `campaign_insights`: Meta campaign performance over the lookback window.
 * - `rule_actions`: what the automated rule engine alerted on, paused, or scaled.
 *
 * The first and last are event streams — each run appends only rows created
 * since the previous one, so a daily export never duplicates history. Campaign
 * insights are a periodic re-measurement instead: every run appends the whole
 * window stamped with its run time, building a performance log over time.
 */
export type ExportDataset = 'roas_snapshots' | 'campaign_insights' | 'rule_actions';

/**
 * A recurring export of Gomer's own reporting data into a Google Sheet — the
 * automation behind "email me the numbers every Monday", without a human (or
 * the model) in the loop. Scheduling mirrors {@link AdRule}/{@link ScheduledTask}:
 * a cron expression plus a materialised {@link nextRun} so schedules survive
 * restarts, ticked once a minute by ExportsScheduler.
 */
@Entity({ name: 'scheduled_exports' })
export class ScheduledExport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 32 })
  dataset!: ExportDataset;

  /** Required by `campaign_insights`; unused by the other datasets. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  adAccountId!: string | null;

  /** Lookback window in days, and the backfill window on the very first run. */
  @Column({ type: 'integer', default: 7 })
  windowDays!: number;

  // ── Destination ──────────────────────────────────────────────────────────

  /** Null until the first run, which creates the spreadsheet and stores its id. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  spreadsheetId!: string | null;

  /** Title used when this export has to create the spreadsheet itself. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  spreadsheetTitle!: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  spreadsheetUrl!: string | null;

  /** The tab written to, created on demand if the spreadsheet lacks it. */
  @Column({ type: 'varchar', length: 128, default: 'Sheet1' })
  sheetTitle!: string;

  // ── Scheduling ───────────────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 128 })
  cronExpression!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  /** Where the "export finished" confirmation is posted, if anywhere. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  slackChannelId!: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdByUserId!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastRun!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRun!: Date | null;

  /**
   * Watermark for the event datasets: the newest row already written. The next
   * run starts from here, which is what keeps repeated exports append-only
   * rather than duplicating rows.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastExportedAt!: Date | null;

  /** Rows written by the most recent run, for a quick "is it working?" read. */
  @Column({ type: 'integer', nullable: true })
  lastRowCount!: number | null;

  /** Failure reason from the most recent run, cleared on the next success. */
  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'createdByUserId' })
  createdBy!: User | null;
}
