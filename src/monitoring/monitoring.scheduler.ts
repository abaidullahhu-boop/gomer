import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SlackService } from '../slack/slack.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { MonitoringService } from './monitoring.service';

/**
 * Drives proactive monitoring: an hourly sweep compares each Meta account
 * against its baseline and posts any fresh anomalies (CPA spikes, ROAS drops,
 * spend spikes) to the workspace's alerts channel. A run guard prevents
 * overlapping sweeps.
 */
@Injectable()
export class MonitoringScheduler {
  private readonly logger = new Logger(MonitoringScheduler.name);
  private running = false;

  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const reports = await this.monitoringService.runSweep();
      for (const report of reports) {
        try {
          const workspace = await this.workspacesService.findById(report.workspaceId);
          if (!workspace?.slackBotToken) continue;
          await this.slackService.deliver(
            workspace.slackBotToken,
            report.slackChannel,
            report.message,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Failed to deliver anomaly alert for ${report.workspaceId}: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Monitoring sweep failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
