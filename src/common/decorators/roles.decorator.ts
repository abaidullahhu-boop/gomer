import { SetMetadata } from '@nestjs/common';
import { ROLES_KEY } from '../constants';
import { UserRole } from '../enums';

/**
 * Restricts a route to the given workspace roles. Enforced by RolesGuard.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
