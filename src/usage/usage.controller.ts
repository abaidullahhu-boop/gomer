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

  /** Recent credit events for the current workspace. */
  @Get('events')
  events(@CurrentUser('workspaceId') workspaceId: string): Promise<CreditEvent[]> {
    return this.usageService.findRecentForWorkspace(workspaceId);
  }
}
