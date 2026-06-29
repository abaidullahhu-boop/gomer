import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from '../ai/ai.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SlackController } from './slack.controller';
import { SlackEventsService } from './slack-events.service';
import { SlackService } from './slack.service';

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({ timeout: 10000 }),
    AiModule,
    WorkspacesModule,
    UsersModule,
  ],
  controllers: [SlackController],
  providers: [SlackService, SlackEventsService],
  exports: [SlackService],
})
export class SlackModule {}
