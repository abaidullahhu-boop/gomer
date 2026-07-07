import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../database/entities';
import { UsageService } from '../usage/usage.service';

export interface UpsertWorkspaceFromSlackInput {
  slackTeamId: string;
  name: string;
  slackBotToken?: string | null;
}

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepository: Repository<Workspace>,
    private readonly usageService: UsageService,
  ) {}

  findById(id: string): Promise<Workspace | null> {
    return this.workspaceRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<Workspace> {
    const workspace = await this.findById(id);
    if (!workspace) {
      throw new NotFoundException(`Workspace ${id} not found`);
    }
    return workspace;
  }

  findBySlackTeamId(slackTeamId: string): Promise<Workspace | null> {
    return this.workspaceRepository.findOne({ where: { slackTeamId } });
  }

  /**
   * Creates the workspace for a Slack team if it does not yet exist, otherwise
   * updates the mutable Slack-derived fields (name, bot token).
   */
  async upsertFromSlack(input: UpsertWorkspaceFromSlackInput): Promise<Workspace> {
    const existing = await this.findBySlackTeamId(input.slackTeamId);

    if (existing) {
      existing.name = input.name;
      if (input.slackBotToken !== undefined) {
        existing.slackBotToken = input.slackBotToken;
      }
      return this.workspaceRepository.save(existing);
    }

    const workspace = this.workspaceRepository.create({
      name: input.name,
      slackTeamId: input.slackTeamId,
      slackBotToken: input.slackBotToken ?? null,
      credits: 0,
    });

    const saved = await this.workspaceRepository.save(workspace);
    // Free onboarding credits, best-effort: a grant failure must not block the
    // Slack install. Idempotent, so a retried install can't double-grant.
    try {
      await this.usageService.grantOnboardingCredits(saved.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to grant onboarding credits for ${saved.id}: ${message}`);
    }
    return saved;
  }
}
