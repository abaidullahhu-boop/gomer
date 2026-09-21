import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { InviteMembersDto } from './dto';
import { InviteResult, InvitesService } from './invites.service';

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
}
