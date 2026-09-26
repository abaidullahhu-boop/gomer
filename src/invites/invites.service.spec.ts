import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { UserRole } from '../common/enums';
import { User } from '../database/entities';
import { SlackEmailLookup, SlackTeamMember } from '../slack/interfaces/slack-oauth.interface';
import { InvitesService, isPendingInvite, normalizeEmails, rosterStatus } from './invites.service';

test('normalizeEmails lower-cases, trims and de-duplicates in first-seen order', () => {
  assert.deepEqual(
    normalizeEmails([' Bob@Example.com ', 'alice@example.com', 'bob@example.com', '']),
    ['bob@example.com', 'alice@example.com'],
  );
});

test('a member is pending only while invited, active and never seen', () => {
  const now = new Date();
  assert.equal(isPendingInvite({ isActive: true, invitedAt: now, lastActiveAt: null }), true);
  assert.equal(isPendingInvite({ isActive: true, invitedAt: now, lastActiveAt: now }), false);
  assert.equal(isPendingInvite({ isActive: true, invitedAt: null, lastActiveAt: null }), false);
  assert.equal(isPendingInvite({ isActive: false, invitedAt: now, lastActiveAt: null }), false);
});

/** Enough of a User for the service to classify it. */
function member(overrides: Partial<User> & Pick<User, 'slackUserId' | 'name'>): User {
  return {
    id: `id-${overrides.slackUserId}`,
    workspaceId: 'ws',
    email: null,
    avatarUrl: null,
    role: UserRole.MEMBER,
    isActive: true,
    lastActiveAt: new Date('2026-09-01'),
    invitedAt: null,
    ...overrides,
  } as User;
}

/** Wires the service to in-memory fakes and records what it asked them to do. */
function harness(options: {
  botToken?: string | null;
  members?: User[];
  lookups?: Record<string, SlackEmailLookup>;
  deliverOk?: boolean;
  /** What users.list returns; null means Slack did not answer. */
  slackMembers?: SlackTeamMember[] | null;
}) {
  const provisioned: Array<{ slackUserId: string; email: string | null }> = [];
  const delivered: string[] = [];
  const members = options.members ?? [];

  const usersService = {
    findByIdOrFail: async () => member({ slackUserId: 'U_ADMIN', name: 'Ada Admin' }),
    listAllByWorkspace: async () => members,
    provisionInvited: async (input: {
      slackUserId: string;
      name: string;
      email: string | null;
    }) => {
      provisioned.push({ slackUserId: input.slackUserId, email: input.email });
      return member({ slackUserId: input.slackUserId, name: input.name, email: input.email });
    },
  };
  const workspacesService = {
    findByIdOrFail: async () => ({
      id: 'ws',
      name: 'Acme',
      slackBotToken: options.botToken === undefined ? 'xoxb-test' : options.botToken,
    }),
  };
  const slackService = {
    lookupUserByEmail: async (_token: string, email: string): Promise<SlackEmailLookup> =>
      options.lookups?.[email] ?? { status: 'not_found' },
    listMembers: async () => (options.slackMembers === undefined ? [] : options.slackMembers),
    deliver: async (_token: string, userId: string) => {
      delivered.push(userId);
      return options.deliverOk === false ? null : '1.0';
    },
  };
  const configService = {
    get: () => ({ frontendUrl: 'https://gaspo.co/' }),
  };

  const service = new InvitesService(
    usersService as never,
    workspacesService as never,
    slackService as never,
    configService as never,
  );
  return { service, provisioned, delivered };
}

const found = (
  id: string,
  name: string,
  extra: Partial<Extract<SlackEmailLookup, { status: 'found' }>> = {},
) =>
  ({
    status: 'found',
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    avatarUrl: null,
    deleted: false,
    isBot: false,
    ...extra,
  }) satisfies SlackEmailLookup;

test('refuses to invite when the workspace has no bot token', async () => {
  const { service } = harness({ botToken: null });
  await assert.rejects(service.invite('ws', 'admin', ['bob@example.com']), BadRequestException);
});

test('classifies every address and only provisions and DMs the ones Slack knows', async () => {
  const alice = member({ slackUserId: 'U_ALICE', name: 'Alice', email: 'alice@example.com' });
  const { service, provisioned, delivered } = harness({
    members: [alice],
    lookups: {
      'bob@example.com': found('U_BOB', 'Bob'),
      'dave@example.com': { status: 'error', error: 'ratelimited' },
      'ghost@example.com': found('U_GHOST', 'Ghost', { deleted: true }),
    },
  });

  const results = await service.invite('ws', 'admin', [
    'Alice@Example.com',
    'bob@example.com',
    'carol@example.com',
    'dave@example.com',
    'ghost@example.com',
    'bob@example.com',
  ]);

  assert.deepEqual(
    results.map((r) => [r.email, r.status, r.notified]),
    [
      ['alice@example.com', 'already_member', false],
      ['bob@example.com', 'invited', true],
      ['carol@example.com', 'not_in_slack', false],
      ['dave@example.com', 'failed', false],
      ['ghost@example.com', 'not_in_slack', false],
    ],
  );
  assert.deepEqual(provisioned, [{ slackUserId: 'U_BOB', email: 'bob@example.com' }]);
  assert.deepEqual(delivered, ['U_BOB']);
});

test('matches an existing member by Slack id when their email changed', async () => {
  const bob = member({ slackUserId: 'U_BOB', name: 'Bob', email: 'old-bob@example.com' });
  const { service, provisioned } = harness({
    members: [bob],
    lookups: { 'bob@example.com': found('U_BOB', 'Bob') },
  });

  const [result] = await service.invite('ws', 'admin', ['bob@example.com']);
  assert.equal(result.status, 'already_member');
  assert.equal(provisioned.length, 0);
});

test('re-inviting someone who never showed up sends a reminder, not a duplicate', async () => {
  const bob = member({
    slackUserId: 'U_BOB',
    name: 'Bob',
    email: 'bob@example.com',
    invitedAt: new Date('2026-09-20'),
    lastActiveAt: null,
  });
  const { service, provisioned, delivered } = harness({
    members: [bob],
    lookups: { 'bob@example.com': found('U_BOB', 'Bob') },
  });

  const [result] = await service.invite('ws', 'admin', ['bob@example.com']);
  assert.equal(result.status, 'invited');
  assert.match(result.message, /reminder/);
  assert.equal(provisioned.length, 1);
  assert.deepEqual(delivered, ['U_BOB']);
});

test('still adds the member when the DM cannot be sent, and says so', async () => {
  const { service } = harness({
    lookups: { 'bob@example.com': found('U_BOB', 'Bob') },
    deliverOk: false,
  });

  const [result] = await service.invite('ws', 'admin', ['bob@example.com']);
  assert.equal(result.status, 'invited');
  assert.equal(result.notified, false);
  assert.match(result.message, /https:\/\/gaspo\.co\/sign-in/);
});

test('rosterStatus: signed in, invited and unseen, or not on Gaspo', () => {
  const now = new Date();
  assert.equal(rosterStatus(undefined), 'not_on_gaspo');
  assert.equal(
    rosterStatus({ isActive: false, invitedAt: null, lastActiveAt: now }),
    'not_on_gaspo',
  );
  assert.equal(rosterStatus({ isActive: true, invitedAt: now, lastActiveAt: null }), 'invited');
  assert.equal(rosterStatus({ isActive: true, invitedAt: now, lastActiveAt: now }), 'on_gaspo');
  assert.equal(rosterStatus({ isActive: true, invitedAt: null, lastActiveAt: now }), 'on_gaspo');
});

const slackPerson = (id: string, name: string, email: string | null = null): SlackTeamMember => ({
  id,
  name,
  email,
  avatarUrl: null,
});

test('slackRoster marks each Slack teammate by Slack id and sorts by name', async () => {
  const { service } = harness({
    members: [
      // Email changed in Slack since joining: still matched by Slack id.
      member({ slackUserId: 'U_ALICE', name: 'Alice', email: 'old-alice@example.com' }),
      member({ slackUserId: 'U_BOB', name: 'Bob', invitedAt: new Date(), lastActiveAt: null }),
      member({ slackUserId: 'U_DAVE', name: 'Dave', isActive: false }),
    ],
    slackMembers: [
      slackPerson('U_DAVE', 'Dave', 'dave@example.com'),
      slackPerson('U_CAROL', 'Carol', 'carol@example.com'),
      slackPerson('U_BOB', 'Bob', 'bob@example.com'),
      slackPerson('U_ALICE', 'Alice', 'alice@example.com'),
    ],
  });

  const roster = await service.slackRoster('ws');
  assert.deepEqual(
    roster.map((r) => [r.name, r.email, r.status]),
    [
      ['Alice', 'alice@example.com', 'on_gaspo'],
      ['Bob', 'bob@example.com', 'invited'],
      ['Carol', 'carol@example.com', 'not_on_gaspo'],
      ['Dave', 'dave@example.com', 'not_on_gaspo'],
    ],
  );
});

test('slackRoster refuses without a bot token and reports a Slack outage', async () => {
  await assert.rejects(harness({ botToken: null }).service.slackRoster('ws'), BadRequestException);
  await assert.rejects(
    harness({ slackMembers: null }).service.slackRoster('ws'),
    BadGatewayException,
  );
});
