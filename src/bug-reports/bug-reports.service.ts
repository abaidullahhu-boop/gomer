import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BugReportSeverity, BugReportStatus } from '../common/enums';
import { BugReport } from '../database/entities';

/** Everything needed to file a report, after the server has filled its half in. */
export interface CreateBugReportInput {
  workspaceId: string;
  reportedByUserId: string;
  title: string;
  description: string;
  stepsToReproduce?: string | null;
  severity?: BugReportSeverity;
  pageUrl?: string | null;
  userAgent?: string | null;
}

/** A report as its own author sees it — no triage notes. */
export interface BugReportView {
  id: string;
  title: string;
  description: string;
  stepsToReproduce: string | null;
  severity: BugReportSeverity;
  status: BugReportStatus;
  pageUrl: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

/**
 * Filing and reading back bug reports, from the reporter's side.
 *
 * The owner's side lives in `SuperAdminService` — same table, opposite scope:
 * everything here is pinned to the caller's workspace, and nothing here can
 * change a report's status. Keeping the two apart means a change to triage can
 * never widen what a customer can see.
 */
@Injectable()
export class BugReportsService {
  private readonly logger = new Logger(BugReportsService.name);

  constructor(
    @InjectRepository(BugReport)
    private readonly bugReportRepository: Repository<BugReport>,
  ) {}

  private toView(report: BugReport): BugReportView {
    return {
      id: report.id,
      title: report.title,
      description: report.description,
      stepsToReproduce: report.stepsToReproduce,
      severity: report.severity,
      status: report.status,
      pageUrl: report.pageUrl,
      createdAt: report.createdAt,
      resolvedAt: report.resolvedAt,
    };
  }

  async create(input: CreateBugReportInput): Promise<BugReportView> {
    const report = this.bugReportRepository.create({
      workspaceId: input.workspaceId,
      reportedByUserId: input.reportedByUserId,
      title: input.title.trim(),
      description: input.description.trim(),
      stepsToReproduce: input.stepsToReproduce?.trim() || null,
      severity: input.severity ?? BugReportSeverity.MEDIUM,
      status: BugReportStatus.OPEN,
      pageUrl: input.pageUrl ?? null,
      // Truncated rather than rejected: a browser sending a 600-character UA is
      // odd but it is not the reporter's fault, and losing the whole report
      // over a header nobody reads in full would be.
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    });

    const saved = await this.bugReportRepository.save(report);
    // Logged at warn so a spike in reports is visible in the same place an
    // incident would be, without anyone having to open the panel.
    this.logger.warn(
      `Bug report filed: "${saved.title}" (${saved.severity}) by user ${input.reportedByUserId} in workspace ${input.workspaceId}`,
    );
    return this.toView(saved);
  }

  /** The caller's own reports, newest first — so the form can say "you already told us". */
  async listMine(workspaceId: string, userId: string): Promise<BugReportView[]> {
    const reports = await this.bugReportRepository.find({
      where: { workspaceId, reportedByUserId: userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return reports.map((report) => this.toView(report));
  }
}
