import { Injectable } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { User } from '../database/entities';
import { IntegrationsService } from '../integrations/integrations.service';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';

/** A member row on the admin roster (includes deactivated members). */
export interface AdminMemberView {
  id: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  isActive: boolean;
  lastActiveAt: Date | null;
  createdAt: Date;
}

/**
 * Read-model composition for the admin dashboard: member management plus the
 * workspace's usage analytics and revenue overview, all sourced from the
 * services that own the underlying tables.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly usersService: UsersService,
    private readonly usageService: UsageService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  toMemberView(user: User): AdminMemberView {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
      isActive: user.isActive,
      lastActiveAt: user.lastActiveAt,
      createdAt: user.createdAt,
    };
  }

  /** Headline numbers for the admin landing view. */
  async overview(workspaceId: string) {
    const [members, balance, usage, integrations] = await Promise.all([
      this.usersService.listAllByWorkspace(workspaceId),
      this.usageService.getBalance(workspaceId),
      this.usageService.summarizeForWorkspace(workspaceId),
      this.integrationsService.getWorkspaceIntegrations(workspaceId),
    ]);
    return {
      members: {
        total: members.length,
        active: members.filter((m) => m.isActive).length,
        admins: members.filter((m) => m.role === UserRole.ADMIN && m.isActive).length,
      },
      credits: balance,
      usage,
      connectedAccounts: integrations.filter((row) => row.isActive).length,
    };
  }

  /** Time series + leaderboard for the analytics tab. */
  async analytics(workspaceId: string, days = 30) {
    const [daily, spenders, members] = await Promise.all([
      this.usageService.dailyUsage(workspaceId, days),
      this.usageService.topSpenders(workspaceId, days),
      this.usersService.listAllByWorkspace(workspaceId),
    ]);
    const nameById = new Map(members.map((m) => [m.id, m.name ?? m.email ?? m.id]));
    return {
      days,
      daily,
      topSpenders: spenders.map((row) => ({
        ...row,
        name: row.userId ? (nameById.get(row.userId) ?? row.userId) : 'System (rules & tasks)',
      })),
    };
  }

  /** Money in vs credits out for the revenue tab. */
  async revenue(workspaceId: string) {
    const [byReason, grants, balance] = await Promise.all([
      this.usageService.grantTotalsByReason(workspaceId),
      this.usageService.findGrantsForWorkspace(workspaceId),
      this.usageService.getBalance(workspaceId),
    ]);
    const paidCents = byReason
      .filter((row) => row.reason === 'topup')
      .reduce((sum, row) => sum + row.amountCents, 0);
    return {
      totalPaidCents: paidCents,
      creditsGranted: balance.granted,
      creditsConsumed: balance.used,
      creditsRemaining: balance.balance,
      byReason,
      recentGrants: grants,
    };
  }
}
