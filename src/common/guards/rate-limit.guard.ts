import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import Redis from 'ioredis';
import { RateLimitOptions } from '../decorators/rate-limit.decorator';
import { RATE_LIMIT_KEY, REDIS_CLIENT } from '../constants';
import { AuthenticatedUser } from '../interfaces';

/** Namespace for the counters, so they are obvious in a Redis keyspace dump. */
const KEY_PREFIX = 'ratelimit:';

/**
 * Fixed-window rate limiting for routes annotated with `@RateLimit()`.
 *
 * The counter lives in Redis rather than in process memory because the API runs
 * as more than one instance — an in-memory limit would let a caller multiply
 * their allowance by the instance count.
 *
 * Fails **open**: if Redis is unreachable the request proceeds. A limiter
 * outage should not take down the whole API, and every route it protects has
 * its own authentication or signature check behind it.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const key = `${KEY_PREFIX}${context.getClass().name}.${context.getHandler().name}:${callerId(request)}`;

    let count: number;
    try {
      count = await this.redis.incr(key);
      // Only the request that opened the window sets its expiry, so the window
      // slides forward from the first hit rather than the most recent one.
      if (count === 1) await this.redis.expire(key, options.windowSeconds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Rate limiter unavailable, allowing request: ${message}`);
      return true;
    }

    if (count > options.limit) {
      throw new HttpException(
        'Too many requests — wait a moment and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

/**
 * Who to charge the request to: the authenticated member when there is one,
 * otherwise the client address.
 *
 * The address is read from `x-forwarded-for` because the API sits behind the
 * DigitalOcean load balancer, where `req.ip` is the proxy and would put every
 * caller in the world into one shared bucket. Only the first hop is used — the
 * rest of that header is caller-supplied and trivially forged.
 */
function callerId(request: Request & { user?: AuthenticatedUser }): string {
  if (request.user?.userId) return `user:${request.user.userId}`;

  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const clientIp = raw?.split(',')[0]?.trim();
  return `ip:${clientIp || request.ip || 'unknown'}`;
}
