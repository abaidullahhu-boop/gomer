import assert from 'node:assert/strict';
import test from 'node:test';
import { proxyErrorMessage } from './pipedream.service';

/**
 * Every Connect proxy failure reaches a user through this function — a Slack
 * "export failed" notice, or a scheduled export's stored `lastError`. Left
 * unextracted, the SDK hands over a "Status code: N / Body: {…}" blob, so the
 * two body shapes below are pinned to what live proxy calls actually returned.
 */

test("a target API's error envelope yields its message (observed: Stripe)", () => {
  const error = {
    statusCode: 400,
    body: {
      error: {
        code: 'api_key_expired',
        message: 'Expired API Key provided: rk_test_***4ueVAv',
        type: 'invalid_request_error',
      },
    },
  };
  assert.equal(proxyErrorMessage(error), 'Expired API Key provided: rk_test_***4ueVAv');
});

test("Pipedream's own rejection is a bare string (observed: domain allowlist)", () => {
  const error = {
    statusCode: 400,
    body: { error: 'Domain sheets.googleapis.com is not allowed for this app' },
  };
  assert.equal(
    proxyErrorMessage(error),
    'Domain sheets.googleapis.com is not allowed for this app',
  );
});

test("Google's envelope matches the same shape as Stripe's", () => {
  const error = {
    body: { error: { code: 403, message: 'Request had insufficient authentication scopes.' } },
  };
  assert.equal(proxyErrorMessage(error), 'Request had insufficient authentication scopes.');
});

test('an unrecognised failure yields null so the original error survives', () => {
  assert.equal(proxyErrorMessage(new Error('fetch failed')), null);
  assert.equal(proxyErrorMessage({ body: 'not an object' }), null);
  assert.equal(proxyErrorMessage({ body: { error: { code: 500 } } }), null);
  assert.equal(proxyErrorMessage({ body: {} }), null);
  assert.equal(proxyErrorMessage(undefined), null);
});
