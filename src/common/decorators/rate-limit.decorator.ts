import { SetMetadata } from '@nestjs/common';
import { RATE_LIMIT_KEY } from '../constants';

/** How many requests a single caller may make to a route per window. */
export interface RateLimitOptions {
  /** Requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/**
 * Cap how often one caller may hit a route, enforced by {@link RateLimitGuard}.
 * Opt-in per route: an endpoint that costs real money or sends mail wants a
 * limit, an ordinary dashboard read does not.
 *
 * @example
 * ```ts
 * @RateLimit({ limit: 5, windowSeconds: 600 })
 * @Post('auth/request-link')
 * ```
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
