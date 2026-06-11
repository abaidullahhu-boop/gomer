import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScheduledTask } from '../database/entities';

/**
 * Scaffold service for scheduled/one-time tasks. Cron scheduling and execution
 * (via Redis-backed queues) will be implemented in a later phase.
 */
@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(ScheduledTask)
    private readonly taskRepository: Repository<ScheduledTask>,
  ) {}

  findAllForWorkspace(workspaceId: string): Promise<ScheduledTask[]> {
    return this.taskRepository.find({
      where: { workspaceId },
      order: { createdAt: 'DESC' },
    });
  }
}
