import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MonitoringModule } from './monitoring.module';
import { MonitoringScheduler } from './monitoring.scheduler';

/**
 * Leaf module hosting the {@link MonitoringScheduler}. Imported only by
 * AppModule so its SlackModule dependency never creates a cycle back through
 * AiModule (mirrors RulesSchedulerModule).
 */
@Module({
  imports: [MonitoringModule, SlackModule, WorkspacesModule],
  providers: [MonitoringScheduler],
})
export class MonitoringSchedulerModule {}
