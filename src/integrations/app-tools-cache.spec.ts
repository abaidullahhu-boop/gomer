import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegrationsService } from './integrations.service';
import { AppTool } from './pipedream.service';

const TOOLS: AppTool[] = [{ key: 'a', name: 'Action A' }];
const FRESHER: AppTool[] = [{ key: 'b', name: 'Action B' }];

const DAY_MS = 24 * 60 * 60 * 1000;

/** An in-memory stand-in for the Redis client, recording what was written. */
function fakeRedis(seed?: { tools: AppTool[]; fetchedAt: number }) {
  const store = new Map<string, string>();
  if (seed) store.set('pd:tools:github', JSON.stringify(seed));
  return {
    store,
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
  };
}

/** A Pipedream stub that either answers with tools or fails. */
function fakePipedream(result: AppTool[] | Error) {
  let calls = 0;
  return {
    calls: () => calls,
    listAppTools: () => {
      calls += 1;
      return result instanceof Error ? Promise.reject(result) : Promise.resolve({ tools: result });
    },
  };
}

/**
 * Build the service with only the collaborators listAppTools touches. The rest
 * of the constructor is irrelevant here and is deliberately not stood up.
 */
function build(redis: ReturnType<typeof fakeRedis>, pipedream: ReturnType<typeof fakePipedream>) {
  return new IntegrationsService(null as never, pipedream as never, null as never, redis as never);
}

void test('a fresh cache entry is served without calling Pipedream', async () => {
  const redis = fakeRedis({ tools: TOOLS, fetchedAt: Date.now() });
  const pipedream = fakePipedream(FRESHER);

  const result = await build(redis, pipedream).listAppTools('github');

  assert.deepEqual(result.tools, TOOLS);
  assert.equal(pipedream.calls(), 0, 'fresh cache must not hit Pipedream');
});

void test('a stale entry is refetched and the cache is rewritten', async () => {
  const redis = fakeRedis({ tools: TOOLS, fetchedAt: Date.now() - 2 * DAY_MS });
  const pipedream = fakePipedream(FRESHER);

  const result = await build(redis, pipedream).listAppTools('github');

  assert.deepEqual(result.tools, FRESHER);
  assert.equal(pipedream.calls(), 1);
  const written = JSON.parse(redis.store.get('pd:tools:github') as string) as {
    tools: AppTool[];
  };
  assert.deepEqual(written.tools, FRESHER, 'refetched list must be cached');
});

void test('a stale entry is served when Pipedream fails', async () => {
  const redis = fakeRedis({ tools: TOOLS, fetchedAt: Date.now() - 2 * DAY_MS });
  const pipedream = fakePipedream(new Error('Pipedream is unreachable'));

  const result = await build(redis, pipedream).listAppTools('github');

  assert.deepEqual(result.tools, TOOLS, 'stale beats an error card');
  assert.equal(pipedream.calls(), 1);
});

void test('a cold cache surfaces the Pipedream failure', async () => {
  const redis = fakeRedis();
  const pipedream = fakePipedream(new Error('Pipedream is unreachable'));

  await assert.rejects(() => build(redis, pipedream).listAppTools('github'), /unreachable/);
});

void test('meta_ads is served locally and never touches Pipedream or the cache', async () => {
  const redis = fakeRedis();
  const pipedream = fakePipedream(FRESHER);

  const result = await build(redis, pipedream).listAppTools('meta_ads');

  assert.ok(result.tools.length > 0, 'native Meta tools should be listed');
  assert.equal(pipedream.calls(), 0);
  assert.equal(redis.store.size, 0);
});
