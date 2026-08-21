import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { CreditEvent } from '../database/entities';
import {
  ActivityEntry,
  CreditBalance,
  DateRange,
  UsageService,
  UsageSummary,
} from './usage.service';
import { ApiTags } from '@nestjs/swagger';

/**
 * The widest window a single request may ask for. A range is one grouped scan
 * of credit_events, so an unbounded span is a table scan a client can trigger
 * at will; a year is longer than any period the dropdown offers.
 */
const MAX_RANGE_DAYS = 366;

/** Fallback span when a caller sends no range at all. */
const DEFAULT_RANGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the `from`/`to` query pair into a window to report over.
 *
 * The caller sends absolute instants because it is the only side that knows
 * the viewer's timezone — "this month" starts at a different moment in Karachi
 * than in London, and the Workspace entity has no timezone to consult. The
 * server's job is only to check that what arrived is a sane window.
 */
function parseRange(from?: string, to?: string): DateRange {
  if (!from && !to) {
    const now = new Date();
    return { from: new Date(now.getTime() - DEFAULT_RANGE_DAYS * DAY_MS), to: now };
  }
  if (!from || !to) {
    throw new BadRequestException('from and to must be supplied together');
  }

  const parsedFrom = new Date(from);
  const parsedTo = new Date(to);
  // An unparseable date yields Invalid Date rather than throwing, and every
  // comparison against it is false — so it would slip through a naive
  // from <= to check and reach the query as NaN.
  if (Number.isNaN(parsedFrom.getTime()) || Number.isNaN(parsedTo.getTime())) {
    throw new BadRequestException('from and to must be ISO-8601 dates');
  }
  if (parsedFrom.getTime() > parsedTo.getTime()) {
    throw new BadRequestException('from must not be after to');
  }
  if (parsedTo.getTime() - parsedFrom.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(`range must not exceed ${MAX_RANGE_DAYS} days`);
  }
  return { from: parsedFrom, to: parsedTo };
}

@ApiTags('usage')
@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  /** Aggregate usage totals for the current workspace, all time. */
  @Get('summary')
  summary(@CurrentUser('workspaceId') workspaceId: string): Promise<UsageSummary> {
    return this.usageService.summarizeForWorkspace(workspaceId);
  }

  /** The workspace's credit position: granted, used, and remaining. */
  @Get('balance')
  balance(@CurrentUser('workspaceId') workspaceId: string): Promise<CreditBalance> {
    return this.usageService.getBalance(workspaceId);
  }

  /**
   * What the workspace's runs cost us vs what it was charged — the margin view.
   *
   * Internal: this is our economics, not the customer's. It is deliberately not
   * surfaced on the Usage page.
   */
  @Get('cost')
  cost(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.usageService.costSummary(workspaceId, parseRange(from, to));
  }

  /**
   * Daily spend plus the spender leaderboard — what the Usage page charts.
   *
   * The same numbers exist under /admin/analytics, but that route is
   * @Roles(ADMIN), so a non-admin member opening Usage could not read their own
   * workspace's chart. This is the unprivileged view of the workspace the
   * caller already belongs to.
   */
  @Get('analytics')
  analytics(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.usageService.analyticsForWorkspace(workspaceId, parseRange(from, to));
  }

  /**
   * The activity feed: recent spend with each row's user and task resolved.
   *
   * `taskId` narrows to one scheduled task, which is what the Scheduled Tasks
   * table deep-links into.
   */
  @Get('activity')
  activity(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('taskId') taskId?: string,
    @Query('limit') limit?: string,
  ): Promise<ActivityEntry[]> {
    return this.usageService.recentActivity(workspaceId, {
      ...(taskId ? { taskId } : {}),
      ...(limit ? { limit: Number(limit) || undefined } : {}),
    });
  }

  /** Raw recent credit events. Superseded by /usage/activity for display. */
  @Get('events')
  events(@CurrentUser('workspaceId') workspaceId: string): Promise<CreditEvent[]> {
    return this.usageService.findRecentForWorkspace(workspaceId);
  }
}
