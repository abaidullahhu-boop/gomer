import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { ScheduledTask } from '../database/entities';
import { TasksService } from './tasks.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  /** List the scheduled tasks for the current workspace. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<ScheduledTask[]> {
    return this.tasksService.findAllForWorkspace(workspaceId);
  }
}
