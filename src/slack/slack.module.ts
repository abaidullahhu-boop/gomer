import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SlackController } from './slack.controller';
import { SlackService } from './slack.service';

@Module({
  imports: [ConfigModule, HttpModule.register({ timeout: 10000 })],
  controllers: [SlackController],
  providers: [SlackService],
  exports: [SlackService],
})
export class SlackModule {}
