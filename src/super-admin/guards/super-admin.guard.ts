import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../../common/interfaces';
import { UsersService } from '../../users/users.service';
import { SuperAdminAccessService } from '../super-admin-access.service';

/** A request that has passed SuperAdminGuard knows the owner's email. */
export interface SuperAdminRequest extends Request {
  user?: AuthenticatedUser;
  superAdminEmail: string;
}

/**
 * Gates the cross-tenant owner panel.
 *
 * Runs after the global JwtAuthGuard, so the caller is already a proven
 * workspace member; this only asks whether that member is also the platform
 * owner. The email is re-read from the database on every request rather than
 * taken from the token: access tokens live 15 minutes and refresh tokens 7
 * days, so a token minted before an address was removed from the allowlist
 * would otherwise keep working for up to a week. Revoking access has to mean
 * revoked now.
 *
 * The lookup is one indexed primary-key read on routes a single person calls,
 * which is a price worth paying for that.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private readonly usersService: UsersService,
    private readonly access: SuperAdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SuperAdminRequest>();
    const userId = request.user?.userId;
    if (!userId) {
      throw new ForbiddenException('Insufficient permissions for this resource');
    }

    const user = await this.usersService.findById(userId);
    if (!user || !user.isActive || !this.access.isSuperAdmin(user.email)) {
      // Deliberately the same message the RolesGuard gives, and the same status
      // whether the panel is unconfigured, the user is unknown, or they simply
      // are not the owner. A distinct "no owner is configured" reply would tell
      // an unauthenticated prober how this deployment is set up.
      throw new ForbiddenException('Insufficient permissions for this resource');
    }

    request.superAdminEmail = user.email as string;
    return true;
  }
}
