import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Space, SpaceAuthToken, SpaceRecord, SpaceUser } from '../database/entities';
import { SlackService } from '../slack/slack.service';
import { UsersModule } from '../users/users.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { SpaceAuthGuard } from './guards/space-auth.guard';
import { SpacesAuthService } from './spaces-auth.service';
import { SpacesController } from './spaces.controller';
import { SpacesLinkDeliveryService } from './spaces-link-delivery.service';
import { SpacesService } from './spaces.service';

/**
 * Spaces: AI-built, spec-driven web apps. The dashboard side is guarded by the
 * global workspace JWT; the runtime side ([@Public] routes) is gated by the
 * space-scoped session via SpaceAuthGuard. JwtModule is registered bare because
 * the secret/expiry are passed explicitly per sign/verify call.
 *
 * SlackService is provided here rather than imported with SlackModule, which
 * imports AiModule, which imports this module. It is a stateless Web API
 * wrapper over HttpService and config, so a second instance costs nothing.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Space, SpaceUser, SpaceAuthToken, SpaceRecord]),
    JwtModule.register({}),
    HttpModule.register({ timeout: 10000 }),
    UsersModule,
    WorkspacesModule,
  ],
  controllers: [SpacesController],
  providers: [
    SpacesService,
    SpacesAuthService,
    SpacesLinkDeliveryService,
    SlackService,
    SpaceAuthGuard,
  ],
  exports: [SpacesService],
})
export class SpacesModule {}
