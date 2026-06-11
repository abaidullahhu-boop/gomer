import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { Workspace } from '../database/entities';
import { WorkspacesService } from './workspaces.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  /** Returns the workspace of the currently authenticated user. */
  @Get('me')
  getMyWorkspace(@CurrentUser('workspaceId') workspaceId: string): Promise<Workspace> {
    return this.workspacesService.findByIdOrFail(workspaceId);
  }
}
