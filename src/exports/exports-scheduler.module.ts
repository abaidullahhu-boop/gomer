import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { ExportsModule } from './exports.module';
import { ExportsScheduler } from './exports.scheduler';

/**
 * Leaf module hosting the {@link ExportsScheduler}. Imported only by AppModule,
 * so its SlackModule dependency (needed to post export confirmations) never
 * feeds back into AiModule → ExportsModule and creates a cycle. Mirrors
 * RulesSchedulerModule.
 */
@Module({
  imports: [ExportsModule, SlackModule, WorkspacesModule],
  providers: [ExportsScheduler],
})
export class ExportsSchedulerModule {}
