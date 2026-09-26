import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { InviteMembersDto } from './dto';
import { InviteResult, InvitesService, SlackRosterEntry } from './invites.service';

@ApiTags('users')
@Controller('users/invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  /**
   * Add Slack teammates to the workspace by email and DM them. Admins only:
   * every invite is a seat, and seats size the plan's credit bonus.
   */
  @Post()
  @Roles(UserRole.ADMIN)
  invite(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
    @Body() dto: InviteMembersDto,
  ): Promise<InviteResult[]> {
    return this.invitesService.invite(workspaceId, userId, dto.emails);
  }

  /**
   * Everyone on the workspace's Slack team and whether each is on Gaspo, so
   * the Team page can offer an Invite button per person. Admins only, like
   * inviting: it hands out every teammate's email, which Slack can hide from
   * ordinary members.
   */
  @Get('slack-members')
  @Roles(UserRole.ADMIN)
  slackRoster(@CurrentUser('workspaceId') workspaceId: string): Promise<SlackRosterEntry[]> {
    return this.invitesService.slackRoster(workspaceId);
  }
}
