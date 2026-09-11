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
import { BugReportSeverity, BugReportStatus } from '../../common/enums';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * A bug filed from inside the dashboard.
 *
 * Support today is a `mailto:` on the marketing site, which loses the two
 * things that make a report actionable: who sent it and what the app was doing.
 * A row here captures both at the moment of the click, so triage starts from
 * the workspace and the page rather than from a reply asking for them.
 *
 * Tenant-scoped like everything else — `workspaceId` is the reporter's
 * workspace — but read across tenants by the owner panel, which is the only
 * consumer of the whole table.
 */
@Entity({ name: 'bug_reports' })
export class BugReport {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  workspaceId!: string;

  /**
   * Who filed it. Nullable only so that deactivating or removing a member does
   * not delete their reports — the bug outlives the reporter's account, and a
   * report that vanishes when someone leaves is a bug that comes back.
   */
  @Column({ type: 'uuid', nullable: true })
  reportedByUserId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  @Column({ type: 'text' })
  description!: string;

  /** What the reporter did, in their own words. Optional — many reports are obvious. */
  @Column({ type: 'text', nullable: true })
  stepsToReproduce!: string | null;

  @Column({ type: 'enum', enum: BugReportSeverity, default: BugReportSeverity.MEDIUM })
  severity!: BugReportSeverity;

  @Index()
  @Column({ type: 'enum', enum: BugReportStatus, default: BugReportStatus.OPEN })
  status!: BugReportStatus;

  /**
   * The dashboard route the reporter was on. Captured by the form rather than
   * asked for: the answer to "where were you?" is the single most useful field
   * in a report and the one people are worst at supplying.
   */
  @Column({ type: 'varchar', length: 512, nullable: true })
  pageUrl!: string | null;

  /** Raw User-Agent, for the class of bug that only happens in one browser. */
  @Column({ type: 'varchar', length: 512, nullable: true })
  userAgent!: string | null;

  /** Triage notes, written in the owner panel. Never shown to the reporter. */
  @Column({ type: 'text', nullable: true })
  resolutionNote!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace!: Workspace;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'reportedByUserId' })
  reportedBy!: User | null;
}
