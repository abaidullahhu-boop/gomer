import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_STRATEGY } from '../../common/constants';
import { UserRole } from '../../common/enums';
import { AuthenticatedUser, JwtPayload } from '../../common/interfaces';
import { AppConfig } from '../../config/configuration';

/** The roles a workspace access token may legitimately carry. */
const WORKSPACE_ROLES = new Set<string>(Object.values(UserRole));

/**
 * Validates the access-token JWT and projects its claims onto `request.user`.
 *
 * A valid signature is not enough to authenticate a *workspace* member. Space
 * end-user sessions are signed with the same `jwt.secret` (see
 * `SpacesAuthService`), so without a shape check a Space visitor's 7-day token
 * would satisfy the global guard and arrive at workspace routes as a member
 * with `workspaceId: undefined`. Every claim this strategy projects is
 * therefore asserted before the token is accepted.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, JWT_STRATEGY) {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.secret', { infer: true }),
    });
  }

  validate(payload: JwtPayload & { scope?: string }): AuthenticatedUser {
    // A scoped token belongs to another trust domain (currently 'space').
    // Workspace access tokens carry no scope at all.
    if (payload.scope !== undefined) {
      throw new UnauthorizedException('Not a workspace session');
    }
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.workspaceId !== 'string' ||
      !payload.sub ||
      !payload.workspaceId ||
      !WORKSPACE_ROLES.has(payload.role)
    ) {
      throw new UnauthorizedException('Malformed workspace session');
    }

    return {
      userId: payload.sub,
      workspaceId: payload.workspaceId,
      slackUserId: payload.slackUserId,
      role: payload.role,
    };
  }
}
