import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserRole } from '../../common/enums';
import { AppConfig } from '../../config/configuration';
import { JwtStrategy } from './jwt.strategy';

/** A ConfigService stub that only has to answer the one key the strategy reads. */
const configStub = {
  get: () => 'test-secret',
} as unknown as ConfigService<AppConfig, true>;

const strategy = new JwtStrategy(configStub);

const workspacePayload = {
  sub: 'a3f1c2d4-0000-4000-8000-000000000001',
  workspaceId: 'a3f1c2d4-0000-4000-8000-000000000002',
  slackUserId: 'U123',
  role: UserRole.ADMIN,
};

test('accepts a well-formed workspace access token', () => {
  assert.deepEqual(strategy.validate(workspacePayload), {
    userId: workspacePayload.sub,
    workspaceId: workspacePayload.workspaceId,
    slackUserId: 'U123',
    role: UserRole.ADMIN,
  });
});

test('rejects a Space end-user session presented to the workspace API', () => {
  // Signed with the same jwt.secret, so the signature check passes; only the
  // claim shape distinguishes it from a member's access token.
  const spaceSession = {
    sub: 'a3f1c2d4-0000-4000-8000-000000000003',
    spaceId: 'a3f1c2d4-0000-4000-8000-000000000004',
    email: 'visitor@example.com',
    scope: 'space',
  };
  assert.throws(
    () => strategy.validate(spaceSession as never),
    UnauthorizedException,
    'a space-scoped token must not authenticate a workspace request',
  );
});

test('rejects a token with no workspace claim', () => {
  assert.throws(
    () => strategy.validate({ ...workspacePayload, workspaceId: undefined } as never),
    UnauthorizedException,
  );
});

test('rejects a token carrying an unknown role', () => {
  assert.throws(
    () => strategy.validate({ ...workspacePayload, role: 'superadmin' } as never),
    UnauthorizedException,
  );
});
