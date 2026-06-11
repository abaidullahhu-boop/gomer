/**
 * Shared application constants.
 */

/** Metadata key used by the @Roles() decorator and RolesGuard. */
export const ROLES_KEY = 'roles';

/** Metadata key used by the @Public() decorator to bypass JWT auth. */
export const IS_PUBLIC_KEY = 'isPublic';

/** Passport strategy name for the access-token JWT strategy. */
export const JWT_STRATEGY = 'jwt';

/** Injection token for the shared ioredis client. */
export const REDIS_CLIENT = 'REDIS_CLIENT';

/** Slack Web API + OAuth base URL. */
export const SLACK_API_BASE_URL = 'https://slack.com/api';
export const SLACK_OAUTH_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
