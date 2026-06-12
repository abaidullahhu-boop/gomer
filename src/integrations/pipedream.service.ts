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

/**
 * Thin wrapper over the Pipedream Connect SDK. Owns the single backend client
 * and exposes the few operations the integrations module needs: minting
 * connect tokens, reading/removing a workspace's connected accounts, and
 * proxying the app catalogue.
 *
 * The `external_user_id` we pass to Pipedream is always the hektor workspace id,
 * so connections are shared by every member of a workspace.
 *
 * The client is built lazily: when credentials are absent the app still boots
 * (mirroring the Slack module), and only the integration endpoints fail.
 */
@Injectable()
export class PipedreamService implements OnModuleInit {
  private readonly logger = new Logger(PipedreamService.name);
  private client: PipedreamClient | null = null;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

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

  /** Mint a single-use Connect token scoped to a workspace (external user). */
  createConnectToken(workspaceId: string): Promise<CreateTokenResponse> {
    return this.run('tokens.create', (client) =>
      client.tokens.create({ externalUserId: workspaceId }, REQUEST_OPTIONS),
    );
  }

  /** List every connected account belonging to a workspace. */
  listAccounts(workspaceId: string): Promise<Account[]> {
    return this.run('accounts.list', async (client) => {
      const accounts: Account[] = [];
      const page = await client.accounts.list({ externalUserId: workspaceId }, REQUEST_OPTIONS);
      for await (const account of page) {
        accounts.push(account);
      }
      return accounts;
    });
  }

  /**
   * Fetch a single account, scoped to the workspace that should own it. We look
   * it up within the workspace's account list (rather than `retrieve`, which
   * can't filter by external user) so a workspace can only confirm accounts that
   * actually belong to it. Returns null if no such account exists.
   */
  async getAccount(accountId: string, workspaceId: string): Promise<Account | null> {
    const accounts = await this.listAccounts(workspaceId);
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
}
