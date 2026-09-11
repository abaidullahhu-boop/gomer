import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  BugReport,
  CreditEvent,
  CreditGrant,
  Integration,
  Subscription,
  User,
  Workspace,
} from '../database/entities';
import { UsageModule } from '../usage/usage.module';
import { UsersModule } from '../users/users.module';
import { SuperAdminGuard } from './guards/super-admin.guard';
import { SuperAdminAccessModule } from './super-admin-access.module';
import { SuperAdminController } from './super-admin.controller';
import { SuperAdminService } from './super-admin.service';

/**
 * Registers the tables directly rather than importing each owning module.
 *
 * Deliberate: the read model's whole reason to exist is grouped cross-tenant
 * aggregates, and every one of those services exposes single-workspace methods
 * only. Going through them would mean a query per tenant. The two that do have
 * something reusable — UsageService for a single workspace's drill-in,
 * UsersService for its roster — are imported and used as-is.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workspace,
      User,
      CreditEvent,
      CreditGrant,
      Subscription,
      Integration,
      BugReport,
    ]),
    UsageModule,
    UsersModule,
    SuperAdminAccessModule,
  ],
  controllers: [SuperAdminController],
  // The guard injects UsersService and the allowlist, so it is provided here
  // rather than left for Nest to construct from the bare class reference.
  providers: [SuperAdminService, SuperAdminGuard],
})
export class SuperAdminModule {}
