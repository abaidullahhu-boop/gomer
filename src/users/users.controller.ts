import { Body, Controller, Get, Param, ParseUUIDPipe, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { User } from '../database/entities';
import { UpdateUserRoleDto } from './dto';
import { TeamMemberView, UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Returns the full profile of the currently authenticated user. */
  @Get('me')
  getMe(@CurrentUser('userId') userId: string): Promise<User> {
    return this.usersService.findByIdOrFail(userId);
  }

  /** List the members of the current user's workspace, flagging the caller. */
  @Get()
  async listMembers(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
  ): Promise<TeamMemberView[]> {
    const members = await this.usersService.listByWorkspace(workspaceId);
    return members.map((member) => this.usersService.toTeamMemberView(member, userId));
  }

  /** Promote or demote a workspace member. Admins only. */
  @Patch(':id/role')
  @Roles(UserRole.ADMIN)
  async updateRole(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
  ): Promise<TeamMemberView> {
    const updated = await this.usersService.updateRole(workspaceId, id, dto.role);
    return this.usersService.toTeamMemberView(updated, userId);
  }
}
