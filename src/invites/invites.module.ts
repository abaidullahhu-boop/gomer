import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SlackModule } from '../slack/slack.module';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

/**
 * Lives outside UsersModule on purpose: SlackModule already imports
 * UsersModule (inbound messages provision members), so invites — which need
 * both — sit above them, the same way AuthModule does.
 */
@Module({
  imports: [ConfigModule, UsersModule, WorkspacesModule, SlackModule],
  controllers: [InvitesController],
  providers: [InvitesService],
})
export class InvitesModule {}
