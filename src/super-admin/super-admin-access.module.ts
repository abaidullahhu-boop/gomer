import { Module } from '@nestjs/common';
import { SuperAdminAccessService } from './super-admin-access.service';

/**
 * Holds the owner allowlist on its own, with no imports.
 *
 * AuthModule and SuperAdminModule both need the check, and SuperAdminModule
 * imports half the app to build its read model — so importing *it* from auth
 * would drag that whole graph into the login path and invite a cycle. A module
 * with one provider and no dependencies can be imported from anywhere.
 */
@Module({
  providers: [SuperAdminAccessService],
  exports: [SuperAdminAccessService],
})
export class SuperAdminAccessModule {}
