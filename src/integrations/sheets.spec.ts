import assert from 'node:assert/strict';
import test from 'node:test';
import { isProxyDomainRejection } from './sheets.service';

/**
 * This predicate decides whether a failed write may be retried on another
 * transport. It must match ONLY Pipedream's pre-forward domain rejection: any
 * other failure could have partially landed in the sheet, and retrying it would
 * duplicate rows.
 */

test('the domain rejection Pipedream actually returns is retryable', () => {
  // Verbatim from a live Connect proxy call (google account → sheets.googleapis.com).
  assert.equal(
    isProxyDomainRejection(new Error('Domain sheets.googleapis.com is not allowed for this app')),
    true,
  );
});

test('Google API failures are never retried — the request reached Google', () => {
  for (const message of [
    'Request had insufficient authentication scopes.',
    'Requested entity was not found.',
    'The caller does not have permission',
    'Google Sheets API error (HTTP 500)',
  ]) {
    assert.equal(isProxyDomainRejection(new Error(message)), false, message);
  }
});

test('a bare transport failure is not retried', () => {
  assert.equal(isProxyDomainRejection(new Error('fetch failed')), false);
  assert.equal(isProxyDomainRejection(undefined), false);
  assert.equal(isProxyDomainRejection('some string'), false);
});
