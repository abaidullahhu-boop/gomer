import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { App, CreateTokenResponse } from '@pipedream/sdk';
import { CurrentUser } from '../common/decorators';
import { Integration } from '../database/entities';
import { ConfirmConnectionDto } from './dto';
import { ConnectedIntegrationView, IntegrationsService } from './integrations.service';
import { AppTool } from './pipedream.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  /** List the connected integrations for the current workspace. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<ConnectedIntegrationView[]> {
    return this.integrationsService.findAllForWorkspace(workspaceId);
  }

  /** Search the Pipedream app catalogue for the connect UI. */
  @Get('apps')
  listApps(
    @Query('query') query?: string,
    @Query('after') after?: string,
  ): Promise<{ apps: App[]; after?: string }> {
    return this.integrationsService.listApps(query, after);
  }

  /** List the actions/tools an app exposes, so the UI can show its capabilities. */
  @Get(':appSlug/tools')
  listAppTools(
    @Param('appSlug') appSlug: string,
    @Query('after') after?: string,
  ): Promise<{ tools: AppTool[]; after?: string }> {
    return this.integrationsService.listAppTools(appSlug, after);
  }

  /** Mint a single-use Pipedream Connect token for the current workspace. */
  @Post('connect-token')
  connectToken(@CurrentUser('workspaceId') workspaceId: string): Promise<CreateTokenResponse> {
    return this.integrationsService.getConnectToken(workspaceId);
  }

  /** Persist a connection after the Pipedream popup succeeds. */
  @Post('confirm')
  confirm(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: ConfirmConnectionDto,
  ): Promise<Integration> {
    return this.integrationsService.confirmConnection(workspaceId, userId, dto);
  }

  /** Disconnect an integration and revoke it at Pipedream. */
  @Delete(':id')
  disconnect(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.integrationsService.disconnect(workspaceId, id);
  }
}
