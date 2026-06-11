import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Integration } from '../database/entities';

/**
 * Scaffold service for managing external app connections (Gmail, Stripe, …).
 * Connection/OAuth logic will be implemented in a later phase.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(Integration)
    private readonly integrationRepository: Repository<Integration>,
  ) {}

  findAllForWorkspace(workspaceId: string): Promise<Integration[]> {
    return this.integrationRepository.find({
      where: { workspaceId },
      order: { connectedAt: 'DESC' },
    });
  }
}
