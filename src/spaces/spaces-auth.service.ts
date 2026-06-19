import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { SpaceAuthToken, SpaceUser } from '../database/entities';
import { SpacesMailerService } from './spaces-mailer.service';
import { SpacesService } from './spaces.service';

/** Claims inside a Space end-user's session token. Disjoint from workspace JWTs. */
export interface SpaceJwtPayload {
  sub: string;
  spaceId: string;
  email: string;
  scope: 'space';
}

/** The authenticated Space end-user attached to a request by SpaceAuthGuard. */
export interface AuthenticatedSpaceUser {
  spaceUserId: string;
  spaceId: string;
  email: string;
}

export interface RequestLinkResult {
  sent: boolean;
  /** The magic link, returned only in dev where there is no real mailbox. */
  devLink?: string;
}

export interface SpaceSessionResult {
  token: string;
  user: { id: string; email: string; name: string | null };
}

const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes
const TOKEN_SALT_ROUNDS = 10;
const SESSION_TTL = '7d';

/**
 * Passwordless authentication for a Space's end-users. A request mints a
 * single-use token (only its hash is stored), delivered as a link; redeeming it
 * upserts the end-user and issues a space-scoped session JWT. No passwords are
 * ever stored or shown.
 */
@Injectable()
export class SpacesAuthService {
  constructor(
    @InjectRepository(SpaceAuthToken)
    private readonly tokenRepository: Repository<SpaceAuthToken>,
    @InjectRepository(SpaceUser)
    private readonly spaceUserRepository: Repository<SpaceUser>,
    private readonly spacesService: SpacesService,
    private readonly mailer: SpacesMailerService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Issue a magic link to `email` for the Space at `slug`. */
  async requestLink(slug: string, email: string): Promise<RequestLinkResult> {
    const space = await this.spacesService.findPublishedBySlug(slug);
    const normalizedEmail = email.trim().toLowerCase();

    // When signup is closed, only previously-invited members may request a link.
    if (!space.spec.auth.allowSignup) {
      const member = await this.spaceUserRepository.findOne({
        where: { spaceId: space.id, email: normalizedEmail },
      });
      if (!member) {
        throw new ForbiddenException('This email is not invited to this app');
      }
    }

    // raw = "<tokenId>.<secret>": the id lets us locate the row, the secret is
    // checked against its bcrypt hash. Only the hash is persisted.
    const secret = randomBytes(32).toString('base64url');
    const tokenRow = await this.tokenRepository.save(
      this.tokenRepository.create({
        spaceId: space.id,
        email: normalizedEmail,
        tokenHash: await bcrypt.hash(secret, TOKEN_SALT_ROUNDS),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      }),
    );

    const raw = `${tokenRow.id}.${secret}`;
    const link = `${this.spacesService.spaceUrl(slug)}?token=${encodeURIComponent(raw)}`;
    await this.mailer.sendMagicLink(normalizedEmail, link);

    return { sent: true, ...(this.mailer.isDev ? { devLink: link } : {}) };
  }

  /** Redeem a magic-link token and return a space-scoped session. */
  async verify(slug: string, rawToken: string): Promise<SpaceSessionResult> {
    const space = await this.spacesService.findPublishedBySlug(slug);
    const [tokenId, secret] = rawToken.split('.');
    if (!tokenId || !secret) {
      throw new UnauthorizedException('Malformed token');
    }

    const tokenRow = await this.tokenRepository.findOne({
      where: { id: tokenId, spaceId: space.id },
    });
    if (
      !tokenRow ||
      tokenRow.usedAt ||
      tokenRow.expiresAt.getTime() < Date.now() ||
      !(await bcrypt.compare(secret, tokenRow.tokenHash))
    ) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    tokenRow.usedAt = new Date();
    await this.tokenRepository.save(tokenRow);

    const user = await this.upsertMember(space.id, tokenRow.email);
    const payload: SpaceJwtPayload = {
      sub: user.id,
      spaceId: space.id,
      email: user.email,
      scope: 'space',
    };
    const token = await this.jwtService.signAsync(payload, {
      secret: this.configService.get('jwt.secret', { infer: true }),
      expiresIn: SESSION_TTL,
    });

    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }

  /** Verify a session token from the SpaceAuthGuard. */
  async verifySession(token: string): Promise<AuthenticatedSpaceUser> {
    let payload: SpaceJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<SpaceJwtPayload>(token, {
        secret: this.configService.get('jwt.secret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Invalid space session');
    }
    if (payload.scope !== 'space') {
      throw new UnauthorizedException('Not a space session');
    }
    return { spaceUserId: payload.sub, spaceId: payload.spaceId, email: payload.email };
  }

  private async upsertMember(spaceId: string, email: string): Promise<SpaceUser> {
    const existing = await this.spaceUserRepository.findOne({ where: { spaceId, email } });
    if (existing) {
      existing.lastLoginAt = new Date();
      return this.spaceUserRepository.save(existing);
    }
    return this.spaceUserRepository.save(
      this.spaceUserRepository.create({
        spaceId,
        email,
        role: 'member',
        lastLoginAt: new Date(),
      }),
    );
  }

  /** Best-effort cleanup hook (not scheduled yet): drop expired tokens. */
  async purgeExpired(): Promise<void> {
    await this.tokenRepository.delete({ expiresAt: LessThan(new Date()) });
  }
}
