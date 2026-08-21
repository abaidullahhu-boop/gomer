import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { CreditEvent } from '../database/entities';
import { CreditBalance, UsageService, UsageSummary } from './usage.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('usage')
@Controller('usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  /** Aggregate usage totals for the current workspace. */
  @Get('summary')
  summary(@CurrentUser('workspaceId') workspaceId: string): Promise<UsageSummary> {
    return this.usageService.summarizeForWorkspace(workspaceId);
  }

  /** The workspace's credit position: granted, used, and remaining. */
  @Get('balance')
  balance(@CurrentUser('workspaceId') workspaceId: string): Promise<CreditBalance> {
    return this.usageService.getBalance(workspaceId);
  }

  /** What the workspace's runs cost us vs what it was charged — the margin view. */
  @Get('cost')
  cost(@CurrentUser('workspaceId') workspaceId: string, @Query('days') days?: string) {
    const window = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.usageService.costSummary(workspaceId, window);
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
  analytics(@CurrentUser('workspaceId') workspaceId: string, @Query('days') days?: string) {
    const window = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.usageService.analyticsForWorkspace(workspaceId, window);
  }

  /** Recent credit events for the current workspace. */
  @Get('events')
  events(@CurrentUser('workspaceId') workspaceId: string): Promise<CreditEvent[]> {
    return this.usageService.findRecentForWorkspace(workspaceId);
  }
}
