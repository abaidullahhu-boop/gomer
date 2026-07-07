import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from '../common/decorators';
import { UserRole } from '../common/enums';
import { UsersService } from '../users/users.service';
import { AdminMemberView, AdminService } from './admin.service';
import { UpdateUserActiveDto } from './dto';

/** The admin dashboard's API. Every route requires the workspace ADMIN role. */
@ApiTags('admin')
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly usersService: UsersService,
  ) {}

  /** Headline stats: members, credit position, usage, connected accounts. */
  @Get('overview')
  overview(@CurrentUser('workspaceId') workspaceId: string) {
    return this.adminService.overview(workspaceId);
  }

  /** Daily usage series and top spenders for the trailing window. */
  @Get('analytics')
  analytics(@CurrentUser('workspaceId') workspaceId: string, @Query('days') days?: string) {
    const window = Math.min(Math.max(Number(days) || 30, 1), 365);
    return this.adminService.analytics(workspaceId, window);
  }

  /** Money in vs credits out, with the full grant history. */
  @Get('revenue')
  revenue(@CurrentUser('workspaceId') workspaceId: string) {
    return this.adminService.revenue(workspaceId);
  }

  /** Full member roster, including deactivated members. */
  @Get('users')
  async users(@CurrentUser('workspaceId') workspaceId: string): Promise<AdminMemberView[]> {
    const members = await this.usersService.listAllByWorkspace(workspaceId);
    return members.map((member) => this.adminService.toMemberView(member));
  }

  /** Activate or deactivate a member. */
  @Patch('users/:id/active')
  async setActive(
    @CurrentUser('workspaceId') workspaceId: string,
    @CurrentUser('userId') callerUserId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserActiveDto,
  ): Promise<AdminMemberView> {
    const updated = await this.usersService.setActive(workspaceId, callerUserId, id, dto.isActive);
    return this.adminService.toMemberView(updated);
  }
}
