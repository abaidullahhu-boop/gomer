import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlackService } from '../slack/slack.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { RulesService } from './rules.service';

/**
 * Drives the rule engine. A per-minute tick evaluates whatever rules are due
 * (state lives in the DB, so schedules survive restarts) and delivers each
 * rule's report to its Slack destination — the after-the-fact notification for
 * autonomous actions. A run guard prevents overlapping ticks.
 *
 * Slack posting lives here (a leaf, imported only by AppModule) rather than in
 * RulesService, so the engine core stays free of a SlackModule import that
 * would cycle back through AiModule.
 */
@Injectable()
export class RulesScheduler {
  private readonly logger = new Logger(RulesScheduler.name);
  private running = false;

  constructor(
    private readonly rulesService: RulesService,
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const reports = await this.rulesService.runDueRules();
      for (const report of reports) {
        if (!report.message || !report.slackChannelId) continue;
        try {
          const workspace = await this.workspacesService.findById(report.workspaceId);
          if (!workspace?.slackBotToken) continue;
          await this.slackService.deliver(
            workspace.slackBotToken,
            report.slackChannelId,
            report.message,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to deliver rule ${report.ruleId} report: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rules tick failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
