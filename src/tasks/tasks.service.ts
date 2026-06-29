import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CronExpressionParser } from 'cron-parser';
import { Repository } from 'typeorm';
import { AiService } from '../ai/ai.service';
import { TaskType } from '../common/enums';
import { ScheduledTask } from '../database/entities';
import { CreateTaskDto, UpdateTaskDto } from './dto';

/** A scheduled task shaped for the dashboard, with author resolved. */
export interface TaskView {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  timezone: string | null;
  prompt: string;
  isActive: boolean;
  isSystem: boolean;
  model: string | null;
  oneTime: boolean;
  lastRun: string | null;
  nextRun: string | null;
  createdAt: string;
  authorName: string | null;
  authorIsCurrentUser: boolean;
}

/**
 * CRUD and execution for scheduled (and one-time) tasks. A task runs its prompt
 * through {@link AiService} on its cron schedule; the actual ticking is driven
 * by TasksScheduler, which calls {@link runDueTasks} once a minute.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(ScheduledTask)
    private readonly taskRepository: Repository<ScheduledTask>,
    private readonly aiService: AiService,
  ) {}

  async findAllForWorkspace(workspaceId: string, currentUserId: string): Promise<TaskView[]> {
    const tasks = await this.taskRepository.find({
      where: { workspaceId },
      relations: { createdBy: true },
      order: { createdAt: 'DESC' },
    });
    return tasks.map((task) => this.toView(task, currentUserId));
  }

  async create(workspaceId: string, userId: string, dto: CreateTaskDto): Promise<TaskView> {
    const timezone = dto.timezone ?? null;
    const nextRun = this.nextRunFrom(dto.cronExpression, timezone);
    const task = this.taskRepository.create({
      workspaceId,
      name: dto.name,
      prompt: dto.prompt,
      cronExpression: dto.cronExpression,
      timezone,
      description: dto.description ?? null,
      model: dto.model ?? null,
      oneTime: dto.oneTime ?? false,
      type: TaskType.USER,
      createdByUserId: userId,
      isActive: true,
      nextRun,
    });
    const saved = await this.taskRepository.save(task);
    return this.findOneView(workspaceId, saved.id, userId);
  }

  async update(
    workspaceId: string,
    userId: string,
    id: string,
    dto: UpdateTaskDto,
  ): Promise<TaskView> {
    const task = await this.findOwned(workspaceId, id);

    if (dto.name !== undefined) task.name = dto.name;
    if (dto.prompt !== undefined) task.prompt = dto.prompt;
    if (dto.description !== undefined) task.description = dto.description;
    if (dto.model !== undefined) task.model = dto.model || null;
    if (dto.oneTime !== undefined) task.oneTime = dto.oneTime;
    if (dto.isActive !== undefined) task.isActive = dto.isActive;
    if (dto.timezone !== undefined) task.timezone = dto.timezone || null;
    if (dto.cronExpression !== undefined) task.cronExpression = dto.cronExpression;
    // Recompute the next fire time whenever the schedule or its timezone moves.
    if (dto.cronExpression !== undefined || dto.timezone !== undefined) {
      task.nextRun = this.nextRunFrom(task.cronExpression, task.timezone);
    }

    await this.taskRepository.save(task);
    return this.findOneView(workspaceId, id, userId);
  }

  async remove(workspaceId: string, id: string): Promise<{ success: boolean }> {
    const task = await this.findOwned(workspaceId, id);
    await this.taskRepository.remove(task);
    return { success: true };
  }

  /** Run a task immediately, regardless of its schedule. */
  async runNow(workspaceId: string, id: string, currentUserId: string): Promise<TaskView> {
    const task = await this.taskRepository.findOne({ where: { id, workspaceId } });
    if (!task) throw new NotFoundException('Task not found');
    await this.executeTask(task);
    return this.findOneView(workspaceId, id, currentUserId);
  }

  /**
   * Execute every active task that is due, called on each scheduler tick. Tasks
   * run sequentially; one failure never blocks the rest.
   */
  async runDueTasks(now: Date = new Date()): Promise<void> {
    const due = await this.taskRepository
      .createQueryBuilder('task')
      .where('task.isActive = :active', { active: true })
      .andWhere('task.nextRun IS NOT NULL')
      .andWhere('task.nextRun <= :now', { now })
      .getMany();

    for (const task of due) {
      await this.executeTask(task).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Scheduled task ${task.id} (${task.name}) failed: ${message}`);
      });
    }
  }

  /** Run one task's prompt and advance its schedule. */
  private async executeTask(task: ScheduledTask): Promise<void> {
    this.logger.log(`Running task ${task.id} (${task.name})`);
    try {
      await this.aiService.run(task.workspaceId, task.createdByUserId, task.prompt, {
        model: task.model,
        taskId: task.id,
        sourceName: `task:${task.name}`,
      });
    } finally {
      task.lastRun = new Date();
      if (task.oneTime) {
        task.isActive = false;
        task.nextRun = null;
      } else {
        task.nextRun = this.nextRunFrom(task.cronExpression, task.timezone);
      }
      await this.taskRepository.save(task);
    }
  }

  private async findOwned(workspaceId: string, id: string): Promise<ScheduledTask> {
    const task = await this.taskRepository.findOne({ where: { id, workspaceId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.type === TaskType.SYSTEM) {
      throw new ForbiddenException('System tasks cannot be modified');
    }
    return task;
  }

  private async findOneView(
    workspaceId: string,
    id: string,
    currentUserId: string,
  ): Promise<TaskView> {
    const task = await this.taskRepository.findOne({
      where: { id, workspaceId },
      relations: { createdBy: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    return this.toView(task, currentUserId);
  }

  /**
   * Compute the next fire time for a cron expression, interpreting its fields in
   * the given timezone (server-local when null). Validates the expression.
   */
  private nextRunFrom(cronExpression: string, timezone: string | null): Date {
    try {
      return CronExpressionParser.parse(cronExpression, {
        tz: timezone ?? undefined,
      })
        .next()
        .toDate();
    } catch {
      throw new BadRequestException(`Invalid cron expression: "${cronExpression}"`);
    }
  }

  private toView(task: ScheduledTask, currentUserId: string): TaskView {
    return {
      id: task.id,
      name: task.name,
      description: task.description,
      cronExpression: task.cronExpression,
      timezone: task.timezone,
      prompt: task.prompt,
      isActive: task.isActive,
      isSystem: task.type === TaskType.SYSTEM,
      model: task.model,
      oneTime: task.oneTime,
      lastRun: task.lastRun ? task.lastRun.toISOString() : null,
      nextRun: task.nextRun ? task.nextRun.toISOString() : null,
      createdAt: task.createdAt.toISOString(),
      authorName: task.createdBy ? task.createdBy.name : null,
      authorIsCurrentUser: task.createdByUserId === currentUserId,
    };
  }
}
