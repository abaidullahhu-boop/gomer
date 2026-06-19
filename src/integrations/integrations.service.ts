import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { App, CreateTokenResponse } from '@pipedream/sdk';
import { Brackets, Repository } from 'typeorm';
import { Integration, IntegrationAccessLevel } from '../database/entities';
import { ConfirmConnectionDto } from './dto';
import { AppTool, PipedreamService } from './pipedream.service';

/** A connected account, enriched with the member who connected it. */
export interface ConnectedIntegrationView {
  id: string;
  appName: string;
  appSlug: string;
  accountName: string | null;
  nickname: string | null;
  accessLevel: IntegrationAccessLevel;
  iconUrl: string | null;
  externalAccountId: string | null;
  isActive: boolean;
  connectedAt: Date;
  userId: string;
  userName: string | null;
}

/**
 * Manages external app connections backed by Pipedream Connect. `team` accounts
 * are scoped to the workspace `external_user_id` (shared by every member);
 * `private` accounts live under the connecting member's own namespace, so only
 * they can see and use them.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @InjectRepository(Integration)
    private readonly integrationRepository: Repository<Integration>,
    private readonly pipedream: PipedreamService,
  ) {}

  /**
   * The Pipedream `external_user_id` an account of a given access level lives
   * under: the workspace id for `team`, the member's own namespace for
   * `private`.
   */
  private resolveExternalUserId(
    workspaceId: string,
    userId: string,
    accessLevel: IntegrationAccessLevel,
  ): string {
    return accessLevel === 'private' ? PipedreamService.privateExternalUserId(userId) : workspaceId;
  }

  /**
   * List the accounts a member may see: every `team` account in the workspace
   * plus their own `private` accounts.
   */
  async findVisibleForUser(
    workspaceId: string,
    userId: string,
  ): Promise<ConnectedIntegrationView[]> {
    const rows = await this.integrationRepository
      .createQueryBuilder('integration')
      .leftJoinAndSelect('integration.user', 'user')
      .where('integration.workspaceId = :workspaceId', { workspaceId })
      .andWhere(
        new Brackets((qb) => {
          qb.where('integration.accessLevel = :team', { team: 'team' }).orWhere(
            'integration.userId = :userId',
            { userId },
          );
        }),
      )
      .orderBy('integration.connectedAt', 'DESC')
      .getMany();
    return rows.map((row) => ({
      id: row.id,
      appName: row.appName,
      appSlug: row.appSlug,
      accountName: row.accountName,
      nickname: row.nickname,
      accessLevel: row.accessLevel,
      iconUrl: row.iconUrl,
      externalAccountId: row.externalAccountId,
      isActive: row.isActive,
      connectedAt: row.connectedAt,
      userId: row.userId,
      userName: row.user?.name ?? null,
    }));
  }

  /**
   * Mint a single-use Pipedream Connect token under the scope the chosen access
   * level resolves to, so the account connects into the right bucket.
   */
  getConnectToken(
    workspaceId: string,
    userId: string,
    accessLevel: IntegrationAccessLevel = 'team',
  ): Promise<CreateTokenResponse> {
    return this.pipedream.createConnectToken(
      this.resolveExternalUserId(workspaceId, userId, accessLevel),
    );
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
    { accountId, appSlug, accessLevel, nickname }: ConfirmConnectionDto,
  ): Promise<Integration> {
    // Look the account up under the same scope it was connected with, so a
    // member can't claim an account that isn't theirs to confirm.
    const externalUserId = this.resolveExternalUserId(workspaceId, userId, accessLevel);
    const account = await this.pipedream.getAccount(accountId, externalUserId);
    if (!account) {
      throw new NotFoundException('Connected account not found for this scope');
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
    integration.nickname = nickname?.trim() || null;
    integration.accessLevel = accessLevel;
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
