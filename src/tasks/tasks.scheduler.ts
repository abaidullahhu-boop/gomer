import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TasksService } from './tasks.service';

/**
 * Drives scheduled-task execution. A single per-minute tick asks the service to
 * run whatever is due, so schedules survive restarts (state lives in the DB, not
 * in registered cron jobs) and overlapping ticks are avoided by a run guard.
 */
@Injectable()
export class TasksScheduler {
  private readonly logger = new Logger(TasksScheduler.name);
  private running = false;

  constructor(private readonly tasksService: TasksService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tasksService.runDueTasks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scheduler tick failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
