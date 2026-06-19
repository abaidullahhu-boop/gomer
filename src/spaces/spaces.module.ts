import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Space, SpaceAuthToken, SpaceRecord, SpaceUser } from '../database/entities';
import { SpaceAuthGuard } from './guards/space-auth.guard';
import { SpacesAuthService } from './spaces-auth.service';
import { SpacesController } from './spaces.controller';
import { SpacesMailerService } from './spaces-mailer.service';
import { SpacesService } from './spaces.service';

/**
 * Spaces: AI-built, spec-driven web apps. The dashboard side is guarded by the
 * global workspace JWT; the runtime side ([@Public] routes) is gated by the
 * space-scoped session via SpaceAuthGuard. JwtModule is registered bare because
 * the secret/expiry are passed explicitly per sign/verify call.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Space, SpaceUser, SpaceAuthToken, SpaceRecord]),
    JwtModule.register({}),
  ],
  controllers: [SpacesController],
  providers: [SpacesService, SpacesAuthService, SpacesMailerService, SpaceAuthGuard],
  exports: [SpacesService],
})
export class SpacesModule {}
