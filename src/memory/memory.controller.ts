import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { WorkspaceMemory } from '../database/entities';
import { WorkspaceMemoryService } from './workspace-memory.service';

/**
 * Read-only view of what the assistant durably remembers about a workspace.
 * Facts are written and forgotten conversationally ("remember our target ROAS
 * is 3"), so there are no writes here — this exists so a member can audit what
 * the assistant is carrying without having to ask it.
 */
@ApiTags('memory')
@Controller('memory')
export class MemoryController {
  constructor(private readonly workspaceMemory: WorkspaceMemoryService) {}

  /** Every remembered fact for the workspace. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<WorkspaceMemory[]> {
    return this.workspaceMemory.list(workspaceId);
  }
}
