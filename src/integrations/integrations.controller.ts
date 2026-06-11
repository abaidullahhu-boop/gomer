import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import { Integration } from '../database/entities';
import { IntegrationsService } from './integrations.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  /** List the connected integrations for the current workspace. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<Integration[]> {
    return this.integrationsService.findAllForWorkspace(workspaceId);
  }
}
