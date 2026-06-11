import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JWT_STRATEGY } from '../../common/constants';
import { AuthenticatedUser, JwtPayload } from '../../common/interfaces';
import { AppConfig } from '../../config/configuration';

/**
 * Validates the access-token JWT and projects its claims onto `request.user`.
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

  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      userId: payload.sub,
      workspaceId: payload.workspaceId,
      slackUserId: payload.slackUserId,
      role: payload.role,
    };
  }
}
