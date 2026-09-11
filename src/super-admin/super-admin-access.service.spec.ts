import { ConfigService } from '@nestjs/config';
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AppConfig } from '../config/configuration';
import { SuperAdminAccessService } from './super-admin-access.service';

/** A ConfigService stub serving just the allowlist the service reads. */
function serviceWith(emails: string[]): SuperAdminAccessService {
  const stub = {
    get: () => ({ emails }),
  } as unknown as ConfigService<AppConfig, true>;
  return new SuperAdminAccessService(stub);
}

describe('SuperAdminAccessService', () => {
  test('admits an address on the allowlist', () => {
    const access = serviceWith(['owner@example.com']);
    assert.equal(access.isSuperAdmin('owner@example.com'), true);
  });

  test('matches regardless of case or surrounding whitespace', () => {
    // Slack reports whatever case the user typed into their profile, so a
    // capital letter must not lock the owner out of their own panel.
    const access = serviceWith(['owner@example.com']);
    assert.equal(access.isSuperAdmin('Owner@Example.COM'), true);
    assert.equal(access.isSuperAdmin('  owner@example.com  '), true);
  });

  test('refuses an address that is not listed', () => {
    const access = serviceWith(['owner@example.com']);
    assert.equal(access.isSuperAdmin('someone@example.com'), false);
  });

  test('refuses a user with no email', () => {
    // Slack withholds the address when users:read.email was never granted.
    // Absent identity must never be the way in.
    const access = serviceWith(['owner@example.com']);
    assert.equal(access.isSuperAdmin(null), false);
    assert.equal(access.isSuperAdmin(undefined), false);
    assert.equal(access.isSuperAdmin(''), false);
  });

  test('refuses everyone when no allowlist is configured', () => {
    // The default for every deployment except the owner's.
    const access = serviceWith([]);
    assert.equal(access.isSuperAdmin('owner@example.com'), false);
    assert.equal(access.isConfigured, false);
  });

  test('an empty configured entry does not admit a user with no email', () => {
    // A trailing comma in SUPER_ADMIN_EMAILS must not become a wildcard. The
    // loader filters blanks; this asserts the service does not depend on that.
    const access = serviceWith(['']);
    assert.equal(access.isSuperAdmin(''), false);
    assert.equal(access.isSuperAdmin(null), false);
  });
});
