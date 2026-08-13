import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlackService } from '../slack/slack.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { ExportsService } from './exports.service';

/**
 * Drives the Sheets export automation. A per-minute tick runs whatever exports
 * are due (state lives in the DB, so schedules survive restarts) and posts each
 * one's confirmation to its Slack destination. A run guard prevents overlapping
 * ticks — a long export must not be started twice.
 *
 * Slack posting lives here (a leaf, imported only by AppModule) rather than in
 * ExportsService, so the export core stays free of a SlackModule import that
 * would cycle back through AiModule. Mirrors RulesScheduler.
 */
@Injectable()
export class ExportsScheduler {
  private readonly logger = new Logger(ExportsScheduler.name);
  private running = false;

  constructor(
    private readonly exportsService: ExportsService,
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const reports = await this.exportsService.runDueExports();
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
          this.logger.warn(`Failed to deliver export ${report.exportId} report: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Exports tick failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
