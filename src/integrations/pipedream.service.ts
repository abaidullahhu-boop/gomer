import {
  HttpException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Account,
  App,
  CreateTokenResponse,
  PipedreamClient,
  PipedreamError,
  ProjectEnvironment,
} from '@pipedream/sdk';
import { AppConfig } from '../config/configuration';

/** Fail fast rather than letting a dead connection hang on SDK retries. */
const REQUEST_OPTIONS = { timeoutInSeconds: 20 };

/** Pipedream's managed remote MCP server — one logical server per connected app. */
const PIPEDREAM_MCP_BASE_URL = 'https://remote.mcp.pipedream.net/v3';

/** A connected app exposed to an LLM as a Pipedream MCP server. */
export interface PipedreamMcpServer {
  appSlug: string;
  name: string;
  url: string;
}

/** A single action an app exposes — surfaced as an MCP tool to the LLM. */
export interface AppTool {
  key: string;
  name: string;
  description?: string;
}

/**
 * Thin wrapper over the Pipedream Connect SDK. Owns the single backend client
 * and exposes the few operations the integrations module needs: minting
 * connect tokens, reading/removing a workspace's connected accounts, and
 * proxying the app catalogue.
 *
 * The `external_user_id` we pass to Pipedream is the gomer workspace id for
 * `team` accounts (shared by every member) and a per-user namespace for
 * `private` accounts (see {@link PipedreamService.privateExternalUserId}), so
 * access isolation holds at the Pipedream boundary, not just in our queries.
 *
 * The client is built lazily: when credentials are absent the app still boots
 * (mirroring the Slack module), and only the integration endpoints fail.
 */
@Injectable()
export class PipedreamService implements OnModuleInit {
  private readonly logger = new Logger(PipedreamService.name);
  private client: PipedreamClient | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  /**
   * The Pipedream `external_user_id` a member's `private` accounts live under.
   * Namespaced so it can never collide with a workspace id, giving private
   * accounts their own isolated bucket at Pipedream.
   */
  static privateExternalUserId(userId: string): string {
    return `u:${userId}`;
  }

  onModuleInit(): void {
    const pd = this.configService.get('pipedream', { infer: true });
    if (!pd.clientId || !pd.clientSecret || !pd.projectId) {
      this.logger.warn(
        'Pipedream credentials are not fully configured; integration connect flows will fail until PIPEDREAM_* env vars are set.',
      );
      return;
    }
    this.client = new PipedreamClient({
      clientId: pd.clientId,
      clientSecret: pd.clientSecret,
      projectId: pd.projectId,
      projectEnvironment: pd.environment as ProjectEnvironment,
    });
  }

  private getClient(): PipedreamClient {
    if (!this.client) {
      throw new ServiceUnavailableException('Pipedream integration is not configured');
    }
    return this.client;
  }

  /**
   * Run an SDK call, translating failures into clear HTTP errors. A Pipedream
   * error without a `statusCode` is a transport failure (DNS, timeout, dropped
   * connection) — surface it as 503 so the client can retry rather than
   * swallowing an opaque 500.
   */
  private async run<T>(label: string, fn: (client: PipedreamClient) => Promise<T>): Promise<T> {
    try {
      return await fn(this.getClient());
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const cause =
        error instanceof PipedreamError
          ? ((error.cause as { code?: string })?.code ?? error.statusCode)
          : undefined;
      this.logger.error(`Pipedream ${label} failed: ${message}${cause ? ` (${cause})` : ''}`);
      if (error instanceof PipedreamError && !error.statusCode) {
        throw new ServiceUnavailableException('Pipedream is currently unreachable, please retry');
      }
      throw new ServiceUnavailableException(`Pipedream request failed: ${message}`);
    }
  }

  /** Mint a single-use Connect token scoped to an external user. */
  createConnectToken(externalUserId: string): Promise<CreateTokenResponse> {
    return this.run('tokens.create', (client) =>
      client.tokens.create({ externalUserId }, REQUEST_OPTIONS),
    );
  }

  /** List every connected account belonging to an external user. */
  listAccounts(externalUserId: string): Promise<Account[]> {
    return this.run('accounts.list', async (client) => {
      const accounts: Account[] = [];
      const page = await client.accounts.list({ externalUserId }, REQUEST_OPTIONS);
      for await (const account of page) {
        accounts.push(account);
      }
      return accounts;
    });
  }

  /**
   * Fetch a single account, scoped to the external user that should own it. We
   * look it up within that external user's account list (rather than `retrieve`,
   * which can't filter by external user) so a caller can only confirm accounts
   * that actually belong to the scope it claims. Returns null if none exists.
   */
  async getAccount(accountId: string, externalUserId: string): Promise<Account | null> {
    const accounts = await this.listAccounts(externalUserId);
    return accounts.find((account) => account.id === accountId) ?? null;
  }

  /** Revoke a connected account at Pipedream. */
  async deleteAccount(accountId: string): Promise<void> {
    await this.run('accounts.delete', (client) =>
      client.accounts.delete(accountId, REQUEST_OPTIONS),
    );
  }

  /**
   * Search the Pipedream app catalogue. Returns one page of apps plus the
   * cursor for the following page (undefined when there are no more results).
   */
  listApps(query?: string, after?: string): Promise<{ apps: App[]; after?: string }> {
    return this.run('apps.list', async (client) => {
      const page = await client.apps.list(
        {
          q: query || undefined,
          after: after || undefined,
          limit: 48,
          sortKey: 'featured_weight',
          sortDirection: 'desc',
        },
        REQUEST_OPTIONS,
      );
      return {
        apps: page.data,
        after: page.hasNextPage() ? page.response.pageInfo?.endCursor : undefined,
      };
    });
  }

  /**
   * List the actions an app exposes. These are the same components Pipedream's
   * remote MCP server turns into tools, so this answers "what can Gomer do with
   * this app?" for the UI. Returns one page plus the cursor for the next.
   */
  listAppTools(appSlug: string, after?: string): Promise<{ tools: AppTool[]; after?: string }> {
    return this.run('actions.list', async (client) => {
      const page = await client.actions.list(
        { app: appSlug, after: after || undefined, limit: 100 },
        REQUEST_OPTIONS,
      );
      return {
        tools: page.data.map((action) => ({
          key: action.key,
          name: action.name,
          description: action.description ?? undefined,
        })),
        after: page.hasNextPage() ? page.response.pageInfo?.endCursor : undefined,
      };
    });
  }

  /**
   * A short-lived Pipedream API access token. Used as the bearer credential when
   * an LLM connects to Pipedream's remote MCP server on a workspace's behalf.
   */
  getAccessToken(): Promise<string> {
    return this.run('rawAccessToken', (client) => client.rawAccessToken);
  }

  /**
   * Build the Pipedream MCP server descriptors for an external user's connected
   * apps. Pipedream accepts its routing parameters as query string values (only
   * the bearer token must be a header), so each app maps to one MCP URL the LLM
   * can point at directly. The caller pairs these with {@link getAccessToken}.
   *
   * The server name is keyed by both the app and the external user so the same
   * app connected under two scopes (e.g. a team and a private account) produces
   * two distinct, non-colliding servers.
   */
  buildMcpServers(externalUserId: string, appSlugs: string[]): PipedreamMcpServer[] {
    const pd = this.configService.get('pipedream', { infer: true });
    const scope = externalUserId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return appSlugs.map((appSlug) => {
      const params = new URLSearchParams({
        projectId: pd.projectId,
        environment: pd.environment,
        externalUserId,
        app: appSlug,
      });
      return {
        appSlug,
        name: `pipedream-${scope}-${appSlug}`,
        url: `${PIPEDREAM_MCP_BASE_URL}?${params.toString()}`,
      };
    });
  }
}
