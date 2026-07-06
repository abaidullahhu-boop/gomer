import { Module } from '@nestjs/common';
import { SlackModule } from '../slack/slack.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { RulesModule } from './rules.module';
import { RulesScheduler } from './rules.scheduler';

/**
 * Leaf module hosting the {@link RulesScheduler}. Imported only by AppModule, so
 * its SlackModule dependency (needed to post rule notifications) never feeds
 * back into AiModule → RulesModule and creates a cycle.
 */
@Module({
  imports: [RulesModule, SlackModule, WorkspacesModule],
  providers: [RulesScheduler],
})
export class RulesSchedulerModule {}
