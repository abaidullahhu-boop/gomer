import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Not, Repository } from 'typeorm';
import { UserRole } from '../common/enums';
import { User } from '../database/entities';

/** A workspace member as exposed to the team-management UI (no secrets). */
export interface TeamMemberView {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: UserRole;
  isCurrentUser: boolean;
  lastActiveAt: Date | null;
  createdAt: Date;
}

export interface UpsertUserFromSlackInput {
  workspaceId: string;
  slackUserId: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
  /** First user of a workspace becomes the admin. */
  role?: UserRole;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  findBySlackIdentity(workspaceId: string, slackUserId: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { workspaceId, slackUserId } });
  }

  countByWorkspace(workspaceId: string): Promise<number> {
    return this.userRepository.count({ where: { workspaceId } });
  }

  /** Strips secrets and flags the caller for the team-management UI. */
  toTeamMemberView(member: User, currentUserId: string): TeamMemberView {
    return {
      id: member.id,
      name: member.name,
      email: member.email,
      avatarUrl: member.avatarUrl,
      role: member.role,
      isCurrentUser: member.id === currentUserId,
      lastActiveAt: member.lastActiveAt,
      createdAt: member.createdAt,
    };
  }

  /** Active members of a workspace, oldest first (the first member is the founding admin). */
  listByWorkspace(workspaceId: string): Promise<User[]> {
    return this.userRepository.find({
      where: { workspaceId, isActive: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Changes a member's role within a workspace. Only callable by an admin (enforced
   * at the controller). Refuses to demote the workspace's last remaining admin so a
   * team can never be left without one.
   */
  async updateRole(workspaceId: string, targetUserId: string, role: UserRole): Promise<User> {
    const target = await this.userRepository.findOne({
      where: { id: targetUserId, workspaceId },
    });
    if (!target) {
      throw new NotFoundException(`User ${targetUserId} not found in this workspace`);
    }

    if (target.role === role) {
      return target;
    }

    if (target.role === UserRole.ADMIN && role === UserRole.MEMBER) {
      const otherAdmins = await this.userRepository.count({
        where: {
          workspaceId,
          role: UserRole.ADMIN,
          isActive: true,
          id: Not(targetUserId),
        },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException('A workspace must have at least one admin');
      }
    }

    target.role = role;
    return this.userRepository.save(target);
  }

  /**
   * All active user records belonging to the same person across workspaces.
   * Slack user ids are team-scoped, so the email is the cross-workspace link
   * (with the slackUserId as a fallback for Enterprise Grid shared ids).
   */
  findMembershipsOf(user: User): Promise<User[]> {
    const where: FindOptionsWhere<User>[] = [{ slackUserId: user.slackUserId, isActive: true }];
    if (user.email) {
      where.push({ email: user.email, isActive: true });
    }
    return this.userRepository.find({
      where,
      relations: { workspace: true },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Creates or updates a user from their Slack identity. If the workspace has no
   * users yet, the new user is promoted to ADMIN.
   */
  async upsertFromSlack(input: UpsertUserFromSlackInput): Promise<User> {
    const existing = await this.findBySlackIdentity(input.workspaceId, input.slackUserId);

    if (existing) {
      existing.name = input.name;
      existing.email = input.email ?? existing.email;
      existing.avatarUrl = input.avatarUrl ?? existing.avatarUrl;
      existing.isActive = true;
      existing.lastActiveAt = new Date();
      return this.userRepository.save(existing);
    }

    const isFirstUser = (await this.countByWorkspace(input.workspaceId)) === 0;

    const user = this.userRepository.create({
      workspaceId: input.workspaceId,
      slackUserId: input.slackUserId,
      name: input.name,
      email: input.email ?? null,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role ?? (isFirstUser ? UserRole.ADMIN : UserRole.MEMBER),
      isActive: true,
      lastActiveAt: new Date(),
    });

    return this.userRepository.save(user);
  }

  async setRefreshTokenHash(userId: string, refreshTokenHash: string | null): Promise<void> {
    await this.userRepository.update({ id: userId }, { refreshTokenHash });
  }

  async updateLastActive(userId: string): Promise<void> {
    await this.userRepository.update({ id: userId }, { lastActiveAt: new Date() });
  }
}
