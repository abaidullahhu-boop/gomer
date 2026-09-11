import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, RateLimit } from '../common/decorators';
import { BugReportsService, BugReportView } from './bug-reports.service';
import { CreateBugReportDto } from './dto';

/**
 * Filing a bug from inside the dashboard.
 *
 * Open to any authenticated member — bugs are found by whoever hits them, and
 * making a member ask an admin to report on their behalf is how a bug report
 * becomes a shrug. Triage is the privileged half, and it lives under
 * `/super-admin`.
 */
@ApiTags('bug-reports')
@Controller('bug-reports')
export class BugReportsController {
  constructor(private readonly bugReportsService: BugReportsService) {}

  /**
   * File a report against the caller's own workspace.
   *
   * Rate-limited because this is an authenticated write that anyone can reach
   * and it lands in an inbox a person reads; ten an hour is far above genuine
   * use and far below enough to bury the queue.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 10, windowSeconds: 3600 })
  create(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Body() dto: CreateBugReportDto,
  ): Promise<BugReportView> {
    return this.bugReportsService.create({
      workspaceId,
      reportedByUserId: userId,
      title: dto.title,
      description: dto.description,
      stepsToReproduce: dto.stepsToReproduce,
      severity: dto.severity,
      pageUrl: dto.pageUrl,
      userAgent,
    });
  }

  /** The caller's own reports and where each one got to. */
  @Get('mine')
  listMine(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
  ): Promise<BugReportView[]> {
    return this.bugReportsService.listMine(workspaceId, userId);
  }
}
