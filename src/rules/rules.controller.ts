import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { AdRule, AdRuleAction } from '../database/entities';
import { RulesService } from './rules.service';

/**
 * Read-only dashboard views of the rule engine. Rules are created and changed
 * conversationally — the chat flow states the metric, threshold, window, action
 * and guardrails and asks for confirmation, which a form would only reproduce
 * worse — so this exposes no writes.
 */
@ApiTags('rules')
@Controller('rules')
export class RulesController {
  constructor(private readonly rulesService: RulesService) {}

  /** Every rule in the workspace, newest first. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<AdRule[]> {
    return this.rulesService.list(workspaceId);
  }

  /** What the rules have actually done, newest first. */
  @Get('actions')
  actions(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
  ): Promise<AdRuleAction[]> {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    return this.rulesService.recentActionsForWorkspace(workspaceId, take);
  }
}
