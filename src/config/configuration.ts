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
  };
  redis: {
    host: string;
    port: number;
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
    redirectUri: string;
    scopes: string;
  };
  pipedream: {
    clientId: string;
    clientSecret: string;
    projectId: string;
    environment: string;
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
    name: process.env.DATABASE_NAME ?? 'hektor',
    user: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'password',
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:password@localhost:5432/hektor',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
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
    redirectUri: process.env.SLACK_REDIRECT_URI ?? 'http://localhost:3000/auth/slack/callback',
    scopes: process.env.SLACK_SCOPES ?? 'chat:write,users:read,users:read.email,team:read',
  },
  pipedream: {
    clientId: process.env.PIPEDREAM_CLIENT_ID ?? '',
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET ?? '',
    projectId: process.env.PIPEDREAM_PROJECT_ID ?? '',
    environment: process.env.PIPEDREAM_ENVIRONMENT ?? 'development',
  },
});
