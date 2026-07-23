import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { buildCatalog } from '../ai/providers/model-catalog';
import { CurrentUser, Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { Workspace } from '../database/entities';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Returns the workspace of the currently authenticated user. */
  @Get('me')
  getMyWorkspace(@CurrentUser('workspaceId') workspaceId: string): Promise<Workspace> {
    return this.workspacesService.findByIdOrFail(workspaceId);
  }

  /**
   * Update the workspace's Gomer settings. Admin-only: these change behaviour
   * and spend for everyone in the workspace, not just the caller.
   */
  @Patch('me')
  @Roles(UserRole.ADMIN)
  updateMyWorkspace(
    @CurrentUser('workspaceId') workspaceId: string,
    @Body() dto: UpdateWorkspaceSettingsDto,
  ): Promise<Workspace> {
    if (dto.defaultModel) {
      // Validated here rather than in the DTO because which models exist depends
      // on runtime configuration (which gateway, if any, is wired up).
      const gatewayModels = this.configService.get('ai', { infer: true }).gatewayModels;
      const model = buildCatalog(gatewayModels).find(
        (candidate) => candidate.id === dto.defaultModel,
      );
      if (!model) {
        throw new BadRequestException(`Unknown model: ${dto.defaultModel}`);
      }
      // Gomer drives everything through tools, so a model that cannot call them
      // would fail on every request rather than merely performing worse.
      if (!model.supportsTools) {
        throw new BadRequestException(`${model.name} does not support tool use`);
      }
    }
    return this.workspacesService.updateSettings(workspaceId, dto);
  }
}
