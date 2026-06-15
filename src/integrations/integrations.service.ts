import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { App, CreateTokenResponse } from '@pipedream/sdk';
import { Repository } from 'typeorm';
import { Integration } from '../database/entities';
import { ConfirmConnectionDto } from './dto';
import { AppTool, PipedreamService } from './pipedream.service';

/** A connected account, enriched with the member who connected it. */
export interface ConnectedIntegrationView {
  id: string;
  appName: string;
  appSlug: string;
  accountName: string | null;
  iconUrl: string | null;
  externalAccountId: string | null;
  isActive: boolean;
  connectedAt: Date;
  userId: string;
  userName: string | null;
}

/**
 * Manages external app connections backed by Pipedream Connect. Connections are
 * scoped to a workspace (the Pipedream `external_user_id`), so any member of a
 * workspace can connect an app and the whole workspace shares it.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(Integration)
    private readonly integrationRepository: Repository<Integration>,
    private readonly pipedream: PipedreamService,
  ) {}

  async findAllForWorkspace(workspaceId: string): Promise<ConnectedIntegrationView[]> {
    const rows = await this.integrationRepository.find({
      where: { workspaceId },
      relations: { user: true },
      order: { connectedAt: 'DESC' },
    });
    return rows.map((row) => ({
      id: row.id,
      appName: row.appName,
      appSlug: row.appSlug,
      accountName: row.accountName,
      iconUrl: row.iconUrl,
      externalAccountId: row.externalAccountId,
      isActive: row.isActive,
      connectedAt: row.connectedAt,
      userId: row.userId,
      userName: row.user?.name ?? null,
    }));
  }

  /** Mint a single-use Pipedream Connect token for the workspace. */
  getConnectToken(workspaceId: string): Promise<CreateTokenResponse> {
    return this.pipedream.createConnectToken(workspaceId);
  }

  /** Search the Pipedream app catalogue for the connect UI. */
  listApps(query?: string, after?: string): Promise<{ apps: App[]; after?: string }> {
    return this.pipedream.listApps(query, after);
  }

  /** List the actions/tools a given app exposes, for the "what can it do?" UI. */
  listAppTools(appSlug: string, after?: string): Promise<{ tools: AppTool[]; after?: string }> {
    return this.pipedream.listAppTools(appSlug, after);
  }

  /**
   * Persist a connection after the frontend's Pipedream popup succeeds. Fetches
   * the account from Pipedream to confirm it belongs to the workspace, then
   * upserts the row (idempotent on the (workspaceId, externalAccountId) index).
   */
  async confirmConnection(
    workspaceId: string,
    userId: string,
    { accountId, appSlug }: ConfirmConnectionDto,
  ): Promise<Integration> {
    const account = await this.pipedream.getAccount(accountId, workspaceId);
    if (!account) {
      throw new NotFoundException('Connected account not found for this workspace');
    }

    const existing = await this.integrationRepository.findOne({
      where: { workspaceId, externalAccountId: account.id },
    });

    const integration =
      existing ??
      this.integrationRepository.create({
        workspaceId,
        userId,
        externalAccountId: account.id,
      });

    integration.userId = existing?.userId ?? userId;
    integration.appSlug = account.app?.nameSlug ?? appSlug;
    integration.appName = account.app?.name ?? appSlug;
    integration.accountName = account.name ?? null;
    integration.iconUrl = account.app?.imgSrc ?? null;
    integration.isActive = account.healthy !== false;

    return this.integrationRepository.save(integration);
  }

  /**
   * Disconnect an integration: revoke the account at Pipedream and remove the
   * row. Scoped to the workspace so members can't disconnect other tenants.
   */
  async disconnect(workspaceId: string, integrationId: string): Promise<{ success: boolean }> {
    const integration = await this.integrationRepository.findOne({
      where: { id: integrationId, workspaceId },
    });
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    if (integration.externalAccountId) {
      try {
        await this.pipedream.deleteAccount(integration.externalAccountId);
      } catch (error) {
        // The account may already be gone at Pipedream; log and continue so the
        // local row is still removed.
        this.logger.warn(
          `Failed to revoke Pipedream account ${integration.externalAccountId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    await this.integrationRepository.remove(integration);
    return { success: true };
  }
}
