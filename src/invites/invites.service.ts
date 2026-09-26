import { BadGatewayException, BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { User } from '../database/entities';
import { buildInviteMessage } from '../slack/slack-messages';
import { SlackService } from '../slack/slack.service';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

/**
 * Inviting a teammate from the dashboard.
 *
 * A workspace *is* a Slack team, and signing in is Slack-only, so an invite
 * cannot be an emailed link the way most SaaS does it — Gaspo sends no email at
 * all. Instead the address is resolved to a member of the workspace's Slack
 * team, that person is made a member straight away, and the bot DMs them where
 * to find Gaspo. Someone who is not in the Slack team cannot be invited: the
 * admin is told to add them to Slack first.
 */

export type InviteStatus = 'invited' | 'already_member' | 'not_in_slack' | 'failed';

/** What happened to one address, in words the inviting admin can act on. */
export interface InviteResult {
  email: string;
  status: InviteStatus;
  /** The teammate's Slack display name, when Slack knew the address. */
  name: string | null;
  /** Whether the Slack DM went out. Only meaningful for `invited`. */
  notified: boolean;
  message: string;
}

/**
 * Where a Slack teammate stands with Gaspo: signed in, invited but not seen
 * yet, or not on Gaspo at all (never added, or deactivated by an admin).
 */
export type SlackRosterStatus = 'on_gaspo' | 'invited' | 'not_on_gaspo';

/** One person on the workspace's Slack team, for the Team page's roster. */
export interface SlackRosterEntry {
  slackUserId: string;
  name: string;
  /** Null when Slack withholds it; such a person cannot be invited by email. */
  email: string | null;
  avatarUrl: string | null;
  status: SlackRosterStatus;
}

/** Addresses per request: each costs a Slack lookup and a DM. */
export const MAX_INVITES_PER_REQUEST = 25;

/** Lower-cases, trims and de-duplicates, keeping first-seen order. */
export function normalizeEmails(emails: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

/** Added by an admin and not yet seen in Slack or the dashboard. */
export function isPendingInvite(
  user: Pick<User, 'isActive' | 'invitedAt' | 'lastActiveAt'>,
): boolean {
  return user.isActive && user.invitedAt !== null && user.lastActiveAt === null;
}

/** Where the Gaspo member behind a Slack teammate stands, if there is one. */
export function rosterStatus(
  user: Pick<User, 'isActive' | 'invitedAt' | 'lastActiveAt'> | undefined,
): SlackRosterStatus {
  if (!user || !user.isActive) return 'not_on_gaspo';
  return isPendingInvite(user) ? 'invited' : 'on_gaspo';
}

interface InviteBatch {
  workspaceId: string;
  botToken: string;
  dashboardUrl: string;
  message: string;
  /** Existing members keyed by lower-cased email and by Slack id; updated as the batch adds people. */
  byEmail: Map<string, User>;
  bySlackId: Map<string, User>;
}

@Injectable()
export class InvitesService {
  constructor(
    private readonly usersService: UsersService,
    private readonly workspacesService: WorkspacesService,
    private readonly slackService: SlackService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Invite each address, one result per distinct address in the order given.
   * A failure on one address never aborts the others — the admin sees exactly
   * which ones went through.
   */
  async invite(
    workspaceId: string,
    inviterUserId: string,
    emails: string[],
  ): Promise<InviteResult[]> {
    const workspace = await this.workspacesService.findByIdOrFail(workspaceId);
    if (!workspace.slackBotToken) {
      throw new BadRequestException(
        'Gaspo is not installed in your Slack workspace. Reinstall it from the sign-in page, then invite again.',
      );
    }

    const inviter = await this.usersService.findByIdOrFail(inviterUserId);
    const members = await this.usersService.listAllByWorkspace(workspaceId);
    const byEmail = new Map<string, User>();
    const bySlackId = new Map<string, User>();
    for (const member of members) {
      if (member.email) byEmail.set(member.email.toLowerCase(), member);
      bySlackId.set(member.slackUserId, member);
    }

    const dashboardUrl = this.dashboardUrl();
    const batch: InviteBatch = {
      workspaceId,
      botToken: workspace.slackBotToken,
      dashboardUrl,
      message: buildInviteMessage(inviter.name, workspace.name, dashboardUrl),
      byEmail,
      bySlackId,
    };

    const results: InviteResult[] = [];
    for (const email of normalizeEmails(emails)) {
      results.push(await this.inviteOne(batch, email));
    }
    return results;
  }

  /**
   * Everyone on the workspace's Slack team, each marked with where they stand
   * with Gaspo, so an admin can invite the ones who are not on it yet without
   * typing their addresses. Matched on Slack id, not email: an address may have
   * changed in Slack since the person was added.
   */
  async slackRoster(workspaceId: string): Promise<SlackRosterEntry[]> {
    const workspace = await this.workspacesService.findByIdOrFail(workspaceId);
    if (!workspace.slackBotToken) {
      throw new BadRequestException(
        'Gaspo is not installed in your Slack workspace. Reinstall it from the sign-in page.',
      );
    }

    const slackMembers = await this.slackService.listMembers(workspace.slackBotToken);
    if (slackMembers === null) {
      throw new BadGatewayException("Slack didn't answer. Try again in a minute.");
    }

    const bySlackId = new Map<string, User>();
    for (const member of await this.usersService.listAllByWorkspace(workspaceId)) {
      bySlackId.set(member.slackUserId, member);
    }

    return slackMembers
      .map((person) => ({
        slackUserId: person.id,
        name: person.name,
        email: person.email,
        avatarUrl: person.avatarUrl,
        status: rosterStatus(bySlackId.get(person.id)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async inviteOne(batch: InviteBatch, email: string): Promise<InviteResult> {
    const known = batch.byEmail.get(email);
    if (known && known.isActive && !isPendingInvite(known)) {
      return alreadyMember(email, known.name);
    }

    const lookup = await this.slackService.lookupUserByEmail(batch.botToken, email);
    if (lookup.status === 'error') {
      return {
        email,
        status: 'failed',
        name: null,
        notified: false,
        message: "Slack didn't answer. Try again in a minute.",
      };
    }
    if (lookup.status === 'not_found') {
      return {
        email,
        status: 'not_in_slack',
        name: null,
        notified: false,
        message: 'Not in your Slack workspace yet. Add them to Slack first, then invite again.',
      };
    }
    if (lookup.deleted) {
      return {
        email,
        status: 'not_in_slack',
        name: lookup.name,
        notified: false,
        message: `${lookup.name}'s Slack account is deactivated.`,
      };
    }
    if (lookup.isBot) {
      return {
        email,
        status: 'not_in_slack',
        name: lookup.name,
        notified: false,
        message: `${lookup.name} is a bot, not a person.`,
      };
    }

    // The same person may already be a member under another email (Slack
    // profile emails change); match on the Slack id before creating anything.
    const existing = batch.bySlackId.get(lookup.id);
    if (existing && existing.isActive && !isPendingInvite(existing)) {
      return alreadyMember(email, existing.name);
    }
    const reminder = existing !== undefined && isPendingInvite(existing);

    const member = await this.usersService.provisionInvited({
      workspaceId: batch.workspaceId,
      slackUserId: lookup.id,
      name: lookup.name,
      email: lookup.email,
      avatarUrl: lookup.avatarUrl,
    });
    batch.byEmail.set(email, member);
    batch.bySlackId.set(member.slackUserId, member);

    const notified =
      (await this.slackService.deliver(batch.botToken, lookup.id, batch.message)) !== null;

    let message: string;
    if (!notified) {
      message = `Added ${member.name}, but the Slack DM could not be sent. They can sign in at ${batch.dashboardUrl}.`;
    } else if (reminder) {
      message = `Sent ${member.name} another Slack reminder.`;
    } else {
      message = `Added ${member.name} and sent them a Slack DM.`;
    }
    return { email, status: 'invited', name: member.name, notified, message };
  }

  private dashboardUrl(): string {
    const base = this.configService.get('app', { infer: true }).frontendUrl.replace(/\/+$/, '');
    return `${base}/sign-in`;
  }
}

function alreadyMember(email: string, name: string): InviteResult {
  return {
    email,
    status: 'already_member',
    name,
    notified: false,
    message: `${name} is already on the team.`,
  };
}
