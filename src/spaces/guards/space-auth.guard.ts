import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { Space } from '../../database/entities';
import { AuthenticatedSpaceUser, SpacesAuthService } from '../spaces-auth.service';
import { SpacesService } from '../spaces.service';

/** A request that has passed SpaceAuthGuard carries its Space and end-user. */
export interface SpaceRequest extends Request {
  space: Space;
  spaceUser: AuthenticatedSpaceUser;
}

/**
 * Authenticates a Space end-user for the runtime data API. Validates the
 * space-scoped session JWT and pins the request to the Space named in the route
 * `:slug`, rejecting a token minted for a different Space — so one app's session
 * can never read or write another's data.
 *
 * These routes are marked @Public() to bypass the global workspace JWT guard;
 * this guard is the actual gate.
 */
@Injectable()
export class SpaceAuthGuard implements CanActivate {
  constructor(
    private readonly spacesAuthService: SpacesAuthService,
    private readonly spacesService: SpacesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SpaceRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing space session');
    }

    const spaceUser = await this.spacesAuthService.verifySession(header.slice(7));
    const slug = String(request.params.slug);
    const space = await this.spacesService.findPublishedBySlug(slug);
    if (space.id !== spaceUser.spaceId) {
      throw new UnauthorizedException('Session does not belong to this app');
    }

    request.space = space;
    request.spaceUser = spaceUser;
    return true;
  }
}
