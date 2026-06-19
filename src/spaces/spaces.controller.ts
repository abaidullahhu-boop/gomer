import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public } from '../common/decorators';
import { SpaceRecord, SpaceUser } from '../database/entities';
import { RecordDataDto, RequestMagicLinkDto } from './dto';
import { SpaceAuthGuard, SpaceRequest } from './guards/space-auth.guard';
import { RequestLinkResult, SpaceSessionResult, SpacesAuthService } from './spaces-auth.service';
import { PublicSpaceView, SpacesService, SpaceView } from './spaces.service';

@ApiTags('spaces')
@Controller('spaces')
export class SpacesController {
  constructor(
    private readonly spacesService: SpacesService,
    private readonly spacesAuthService: SpacesAuthService,
  ) {}

  // ---- Dashboard (workspace JWT) -------------------------------------------

  /** List the Spaces built for the current workspace. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<SpaceView[]> {
    return this.spacesService.findForWorkspace(workspaceId);
  }

  /** One Space's details. */
  @Get(':id')
  detail(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ): Promise<SpaceView> {
    return this.spacesService.findOneForWorkspace(workspaceId, id);
  }

  /** The end-users who have logged into a Space. */
  @Get(':id/members')
  async members(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ): Promise<SpaceUser[]> {
    const space = await this.spacesService.findOneForWorkspace(workspaceId, id);
    return this.spacesService.listMembers(space.id);
  }

  /** Delete a Space and all of its data. */
  @Delete(':id')
  remove(
    @CurrentUser('workspaceId') workspaceId: string,
    @Param('id') id: string,
  ): Promise<{ success: boolean }> {
    return this.spacesService.deleteForWorkspace(workspaceId, id);
  }

  // ---- Runtime: public app shell + magic-link auth -------------------------

  /** The published spec the runtime renders for a Space. */
  @Public()
  @Get('public/:slug')
  publicSpace(@Param('slug') slug: string): Promise<PublicSpaceView> {
    return this.spacesService.findPublicBySlug(slug);
  }

  /** Request a magic-link login for a Space end-user. */
  @Public()
  @Post(':slug/auth/request-link')
  requestLink(
    @Param('slug') slug: string,
    @Body() dto: RequestMagicLinkDto,
  ): Promise<RequestLinkResult> {
    return this.spacesAuthService.requestLink(slug, dto.email);
  }

  /** Redeem a magic-link token and receive a space session token. */
  @Public()
  @Get(':slug/auth/verify')
  verify(@Param('slug') slug: string, @Query('token') token: string): Promise<SpaceSessionResult> {
    return this.spacesAuthService.verify(slug, token);
  }

  // ---- Runtime: end-user data API (space session JWT) ----------------------

  @Public()
  @UseGuards(SpaceAuthGuard)
  @Get(':slug/data/:entity')
  listRecords(@Req() req: SpaceRequest, @Param('entity') entity: string): Promise<SpaceRecord[]> {
    return this.spacesService.listRecords(req.space, entity);
  }

  @Public()
  @UseGuards(SpaceAuthGuard)
  @Post(':slug/data/:entity')
  createRecord(
    @Req() req: SpaceRequest,
    @Param('entity') entity: string,
    @Body() dto: RecordDataDto,
  ): Promise<SpaceRecord> {
    return this.spacesService.createRecord(req.space, entity, dto.data, req.spaceUser.spaceUserId);
  }

  @Public()
  @UseGuards(SpaceAuthGuard)
  @Put(':slug/data/:entity/:recordId')
  updateRecord(
    @Req() req: SpaceRequest,
    @Param('entity') entity: string,
    @Param('recordId') recordId: string,
    @Body() dto: RecordDataDto,
  ): Promise<SpaceRecord> {
    return this.spacesService.updateRecord(req.space, entity, recordId, dto.data);
  }

  @Public()
  @UseGuards(SpaceAuthGuard)
  @Delete(':slug/data/:entity/:recordId')
  deleteRecord(
    @Req() req: SpaceRequest,
    @Param('entity') entity: string,
    @Param('recordId') recordId: string,
  ): Promise<{ success: boolean }> {
    return this.spacesService.deleteRecord(req.space, entity, recordId);
  }
}
