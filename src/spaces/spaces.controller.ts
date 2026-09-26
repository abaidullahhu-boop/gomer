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
import { CurrentUser, Public, RateLimit } from '../common/decorators';
import { AuthenticatedUser } from '../common/interfaces';
import { SpaceRecord, SpaceUser } from '../database/entities';
import { PageStateDto, RecordDataDto, RequestMagicLinkDto } from './dto';
import { SpaceAuthGuard, SpaceRequest } from './guards/space-auth.guard';
import { RequestLinkResult, SpaceSessionResult, SpacesAuthService } from './spaces-auth.service';
import { PageDocument, PublicSpaceView, SpacesService, SpaceView } from './spaces.service';

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

  /**
   * Request a sign-in link for a Space end-user. Unauthenticated and it sends
   * Slack DMs, so it is the one route an outsider could turn into a spam relay
   * against the team's inboxes — rate limited per client address.
   */
  @Public()
  @RateLimit({ limit: 5, windowSeconds: 15 * 60 })
  @Post(':slug/auth/request-link')
  requestLink(
    @Param('slug') slug: string,
    @Body() dto: RequestMagicLinkDto,
  ): Promise<RequestLinkResult> {
    return this.spacesAuthService.requestLink(slug, dto.email);
  }

  /**
   * Exchange the caller's dashboard session for a session in one of their
   * workspace's Spaces, so the team opens its own apps without a link. Not
   * public: the global workspace JWT guard is what proves who they are.
   */
  @Post(':slug/auth/workspace-session')
  workspaceSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
  ): Promise<SpaceSessionResult> {
    return this.spacesAuthService.workspaceSession(slug, user.workspaceId, user.userId);
  }

  /**
   * Redeem a magic-link token and receive a space session token. Limited
   * because every attempt costs a bcrypt comparison, which is deliberately
   * expensive and therefore a cheap way to burn server CPU.
   */
  @Public()
  @RateLimit({ limit: 20, windowSeconds: 15 * 60 })
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

  // ---- Runtime: pages (space session JWT) ----------------------------------

  /**
   * A page's HTML and saved state. Behind the session like app data, since a
   * plan can carry real numbers: the public route only ever names the page.
   */
  @Public()
  @UseGuards(SpaceAuthGuard)
  @Get(':slug/page')
  page(@Req() req: SpaceRequest): Promise<PageDocument> {
    return this.spacesService.pageDocument(req.space);
  }

  /** Save one key of what a page remembers (a ticked step, an input). */
  @Public()
  @UseGuards(SpaceAuthGuard)
  @Put(':slug/page/state')
  savePageState(
    @Req() req: SpaceRequest,
    @Body() dto: PageStateDto,
  ): Promise<{ success: boolean }> {
    return this.spacesService.savePageState(req.space, dto.key, dto.value);
  }
}
