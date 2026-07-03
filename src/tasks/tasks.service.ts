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
import { SlackService } from '../slack/slack.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { CreateTaskDto, UpdateTaskDto } from './dto';

/** Name of the per-workspace SYSTEM task that drives proactive check-ins. */
const SYSTEM_CHECK_IN_NAME = 'Daily workspace check-in';

/** Cron for the seeded check-in: 9am daily, in the task's (server-local) tz. */
const SYSTEM_CHECK_IN_CRON = '0 9 * * *';

/** Prompt the seeded check-in runs — a short, proactive "how can I help?". */
const SYSTEM_CHECK_IN_PROMPT = [
  'You are doing a brief daily workspace check-in, posted proactively in Slack.',
  'Review what you know about this workspace and the apps members have connected,',
  'then suggest 2-3 specific, concrete ways you could help right now (a report,',
  'an automation, research, or a draft tailored to this team). Lead with one strong',
  'idea, keep it short and friendly, and end by inviting them to just reply with',
  "what they need. If there's genuinely nothing useful to suggest, say a brief",
  'hello and offer to help rather than inventing busywork.',
].join(' ');

/** A scheduled task shaped for the dashboard, with author resolved. */
export interface TaskView {
  id: string;
  name: string;
  description: string | null;
  cronExpression: string;
  timezone: string | null;
  prompt: string;
  slackChannelId: string | null;
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
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
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
      slackChannelId: dto.slackChannelId ?? null,
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
    if (dto.slackChannelId !== undefined) task.slackChannelId = dto.slackChannelId || null;
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

  /** Run one task's prompt, deliver its answer to Slack, and advance its schedule. */
  private async executeTask(task: ScheduledTask): Promise<void> {
    this.logger.log(`Running task ${task.id} (${task.name})`);
    try {
      const result = await this.aiService.run(task.workspaceId, task.createdByUserId, task.prompt, {
        model: task.model,
        taskId: task.id,
        sourceName: `task:${task.name}`,
      });
      await this.deliver(task, result.answer);
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

  /**
   * Post a task's answer to its configured Slack destination. Best-effort: a
   * task with no destination (or an empty answer) simply runs silently, and a
   * missing bot token is logged rather than thrown so the schedule still advances.
   */
  private async deliver(task: ScheduledTask, answer: string): Promise<void> {
    const text = answer?.trim();
    if (!task.slackChannelId || !text) return;

    const workspace = await this.workspacesService.findById(task.workspaceId);
    if (!workspace?.slackBotToken) {
      this.logger.warn(`Task ${task.id} (${task.name}) has no Slack bot token to deliver with`);
      return;
    }
    await this.slackService.deliver(workspace.slackBotToken, task.slackChannelId, text);
  }

  /**
   * Seed the per-workspace SYSTEM check-in task that drives proactive outreach,
   * delivering to the given destination (typically the installer's DM). Idempotent
   * — does nothing if the workspace already has one. Returns true only when it
   * created the task, so the caller can treat that as "first install".
   */
  async ensureSystemCheckIn(workspaceId: string, slackChannelId: string | null): Promise<boolean> {
    const existing = await this.taskRepository.findOne({
      where: { workspaceId, type: TaskType.SYSTEM, name: SYSTEM_CHECK_IN_NAME },
    });
    if (existing) {
      // Backfill the destination if an earlier seed had none.
      if (!existing.slackChannelId && slackChannelId) {
        existing.slackChannelId = slackChannelId;
        await this.taskRepository.save(existing);
      }
      return false;
    }

    const task = this.taskRepository.create({
      workspaceId,
      name: SYSTEM_CHECK_IN_NAME,
      description: 'Gomer reviews the workspace and proposes ways it can help.',
      prompt: SYSTEM_CHECK_IN_PROMPT,
      cronExpression: SYSTEM_CHECK_IN_CRON,
      timezone: null,
      slackChannelId,
      type: TaskType.SYSTEM,
      model: null,
      oneTime: false,
      createdByUserId: null,
      isActive: true,
      nextRun: this.nextRunFrom(SYSTEM_CHECK_IN_CRON, null),
    });
    await this.taskRepository.save(task);
    return true;
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
      slackChannelId: task.slackChannelId,
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
