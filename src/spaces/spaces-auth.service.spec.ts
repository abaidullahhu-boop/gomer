import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Space, SpaceUser, User } from '../database/entities';
import { SlackTeammate } from './spaces-link-delivery.service';
import { SpacesAuthService } from './spaces-auth.service';

const TEAMMATE: SlackTeammate = { slackUserId: 'U_TEAM', botToken: 'xoxb-test' };

function space(allowSignup: boolean): Space {
  return {
    id: 'space-1',
    workspaceId: 'ws-1',
    slug: 'time-log',
    name: 'Time Log',
    spec: { auth: { mode: 'magic-link', allowSignup } },
  } as unknown as Space;
}

/** Wires the service to in-memory fakes and records what it asked them to do. */
function harness(options: {
  allowSignup?: boolean;
  teammates?: Record<string, SlackTeammate>;
  members?: string[];
  dev?: boolean;
  user?: Partial<User> | null;
}) {
  const minted: string[] = [];
  const sent: Array<{ email: string; teammate: SlackTeammate | null }> = [];
  const members = new Map<string, SpaceUser>(
    (options.members ?? []).map((email) => [
      email,
      { id: `su-${email}`, spaceId: 'space-1', email, name: null } as SpaceUser,
    ]),
  );

  const tokenRepository = {
    create: (row: { email: string }) => row,
    save: async (row: { email: string }) => {
      minted.push(row.email);
      return { ...row, id: 'token-1' };
    },
  };
  const spaceUserRepository = {
    exists: async ({ where }: { where: { email: string } }) => members.has(where.email),
    findOne: async ({ where }: { where: { email: string } }) => members.get(where.email) ?? null,
    create: (row: Partial<SpaceUser>) => ({ ...row, id: `su-${row.email}` }) as SpaceUser,
    save: async (row: SpaceUser) => {
      members.set(row.email, row);
      return row;
    },
  };
  const spacesService = {
    findPublishedBySlug: async () => space(options.allowSignup ?? false),
    spaceUrl: (slug: string) => `https://gaspo.test/s/${slug}`,
  };
  const usersService = {
    findById: async () =>
      options.user === null
        ? null
        : ({
            id: 'user-1',
            name: 'Matt',
            email: 'Matt@Example.com',
            isActive: true,
            ...options.user,
          } as User),
  };
  const delivery = {
    isDev: options.dev ?? false,
    findTeammate: async (_workspaceId: string, email: string) => options.teammates?.[email] ?? null,
    send: async (teammate: SlackTeammate | null, email: string) => {
      sent.push({ email, teammate });
      return teammate !== null;
    },
  };
  const jwtService = { signAsync: async () => 'space-session-jwt' };
  const configService = { get: () => 'secret' };

  const service = new SpacesAuthService(
    tokenRepository as never,
    spaceUserRepository as never,
    spacesService as never,
    usersService as never,
    delivery as never,
    jwtService as never,
    configService as never,
  );
  return { service, minted, sent, members };
}

test('a teammate gets the link by Slack DM, even when signup is closed', async () => {
  const { service, minted, sent } = harness({
    allowSignup: false,
    teammates: { 'matt@example.com': TEAMMATE },
  });

  const result = await service.requestLink('time-log', ' Matt@Example.com ');

  assert.deepEqual(result, { sent: true });
  assert.deepEqual(minted, ['matt@example.com']);
  assert.deepEqual(sent, [{ email: 'matt@example.com', teammate: TEAMMATE }]);
});

test('a stranger on a closed app gets the same answer, and nothing is minted or sent', async () => {
  const { service, minted, sent } = harness({ allowSignup: false });

  assert.deepEqual(await service.requestLink('time-log', 'stranger@example.com'), { sent: true });
  assert.deepEqual(minted, []);
  assert.deepEqual(sent, []);
});

test('in production a link that cannot be delivered is never minted', async () => {
  const { service, minted, sent } = harness({ allowSignup: true, members: ['old@example.com'] });

  assert.deepEqual(await service.requestLink('time-log', 'old@example.com'), { sent: true });
  assert.deepEqual(minted, []);
  assert.deepEqual(sent, []);
});

test('outside production the link comes back in the response', async () => {
  const { service, minted } = harness({ allowSignup: true, dev: true });

  const result = await service.requestLink('time-log', 'dev@example.com');

  assert.equal(result.sent, true);
  assert.match(result.devLink ?? '', /^https:\/\/gaspo\.test\/s\/time-log\?token=token-1\./);
  assert.deepEqual(minted, ['dev@example.com']);
});

test('a workspace member is signed straight in and recorded as an app member', async () => {
  const { service, members } = harness({ allowSignup: false });

  const session = await service.workspaceSession('time-log', 'ws-1', 'user-1');

  assert.equal(session.token, 'space-session-jwt');
  assert.equal(session.user.email, 'matt@example.com');
  assert.equal(members.get('matt@example.com')?.name, 'Matt');
});

test('a member of another workspace cannot tell the app exists', async () => {
  const { service } = harness({});

  await assert.rejects(
    service.workspaceSession('time-log', 'ws-other', 'user-1'),
    NotFoundException,
  );
});

test('a member without an email is sent to the Slack sign-in instead', async () => {
  const { service } = harness({ user: { email: null } });

  await assert.rejects(service.workspaceSession('time-log', 'ws-1', 'user-1'), ForbiddenException);
});
