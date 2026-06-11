import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workspace } from '../database/entities';

export interface UpsertWorkspaceFromSlackInput {
  slackTeamId: string;
  name: string;
  slackBotToken?: string | null;
}

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepository: Repository<Workspace>,
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

    return this.workspaceRepository.save(workspace);
  }
}
