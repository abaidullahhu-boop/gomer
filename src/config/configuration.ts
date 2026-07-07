/**
 * Strongly-typed configuration loaded from environment variables.
 * Consumed via Nest's ConfigService<AppConfig, true>.
 */
export interface AppConfig {
  app: {
    nodeEnv: string;
    port: number;
    frontendUrl: string;
  };
  database: {
    host: string;
    port: number;
    name: string;
    user: string;
    password: string;
    url: string;
    /** Enable TLS for the connection (required by managed Postgres, e.g. DigitalOcean). */
    ssl: boolean;
  };
  redis: {
    host: string;
    port: number;
    /** Full connection URL (e.g. rediss://...). Takes precedence over host/port when set. */
    url: string;
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  slack: {
    clientId: string;
    clientSecret: string;
    signingSecret: string;
    redirectUri: string;
    scopes: string;
  };
  pipedream: {
    clientId: string;
    clientSecret: string;
    projectId: string;
    environment: string;
  };
  meta: {
    /** Meta's hosted Ads MCP endpoint (the OAuth-protected resource). */
    mcpUrl: string;
    /**
     * OAuth client credentials for talking to Meta's MCP authorization server.
     * Optional: when blank the service self-registers via Dynamic Client
     * Registration and caches the result.
     */
    oauthClientId: string;
    oauthClientSecret: string;
    /** Where Meta bounces the browser back after consent. */
    redirectUri: string;
    /** Space-separated ad scopes to request. */
    scopes: string;
  };
  ai: {
    anthropicApiKey: string;
    model: string;
  };
  billing: {
    /** The platform's own Stripe secret key (top-ups) — NOT a customer's. */
    stripeSecretKey: string;
    /** Signing secret of the Stripe webhook endpoint. */
    stripeWebhookSecret: string;
  };
}

export const configuration = (): AppConfig => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
  },
  database: {
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    name: process.env.DATABASE_NAME ?? 'gomer',
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'password',
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/gomer',
    ssl: process.env.DATABASE_SSL === 'true',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    url: process.env.REDIS_URL ?? '',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'super-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'refresh-secret-key',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  slack: {
    clientId: process.env.SLACK_CLIENT_ID ?? '',
    clientSecret: process.env.SLACK_CLIENT_SECRET ?? '',
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    redirectUri: process.env.SLACK_REDIRECT_URI ?? 'http://localhost:3000/auth/slack/callback',
    scopes:
      process.env.SLACK_SCOPES ??
      'app_mentions:read,chat:write,reactions:write,im:history,im:read,im:write,channels:history,groups:history,users:read,users:read.email,team:read',
  },
  pipedream: {
    clientId: process.env.PIPEDREAM_CLIENT_ID ?? '',
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET ?? '',
    projectId: process.env.PIPEDREAM_PROJECT_ID ?? '',
    environment: process.env.PIPEDREAM_ENVIRONMENT ?? 'development',
  },
  meta: {
    mcpUrl: process.env.META_MCP_URL ?? 'https://mcp.facebook.com/ads',
    oauthClientId: process.env.META_OAUTH_CLIENT_ID ?? '',
    oauthClientSecret: process.env.META_OAUTH_CLIENT_SECRET ?? '',
    redirectUri:
      process.env.META_REDIRECT_URI ?? 'http://localhost:3000/integrations/meta/callback',
    scopes: process.env.META_SCOPES ?? 'ads_management ads_read business_management',
  },
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'claude-opus-4-8',
  },
  billing: {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  },
});
