import assert from 'node:assert/strict';
import test from 'node:test';
import type Redis from 'ioredis';
import { AttachedAppsService } from './attached-apps.service';

/** The two commands the service uses, backed by a plain map. */
function fakeRedis(seed: Record<string, string> = {}): Redis {
  const store = new Map(Object.entries(seed));
  return {
    get: (key: string) => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    },
  } as unknown as Redis;
}

/** A Redis that is down, to prove neither read nor write can fail a run. */
function brokenRedis(): Redis {
  return {
    get: () => Promise.reject(new Error('connection refused')),
    set: () => Promise.reject(new Error('connection refused')),
  } as unknown as Redis;
}

const WORKSPACE = 'ws-1';
const THREAD = '1712345678.0001';

void test('a fresh conversation has nothing attached', async () => {
  const service = new AttachedAppsService(fakeRedis());
  assert.deepEqual(await service.get(WORKSPACE, THREAD), {});
});

void test('merge returns the union of past and present actions', async () => {
  const service = new AttachedAppsService(fakeRedis());
  await service.merge(WORKSPACE, THREAD, { google_ads: ['list-campaigns'] });
  const merged = await service.merge(WORKSPACE, THREAD, { google_ads: ['list-budgets'] });
  assert.deepEqual(merged, { google_ads: ['list-budgets', 'list-campaigns'] });
});

void test('merge keeps an app attached on a turn that did not ask for it', async () => {
  const service = new AttachedAppsService(fakeRedis());
  await service.merge(WORKSPACE, THREAD, { google_ads: ['list-campaigns'] });
  // The follow-up routed to Gmail only; Google Ads must not silently drop out,
  // or the answer comes from the transcript instead of live data.
  const merged = await service.merge(WORKSPACE, THREAD, { gmail: ['send-email'] });
  assert.deepEqual(Object.keys(merged).sort(), ['gmail', 'google_ads']);
});

void test('merge sorts, so a settled conversation renders a cacheable prefix', async () => {
  const service = new AttachedAppsService(fakeRedis());
  const merged = await service.merge(WORKSPACE, THREAD, { google_ads: ['b', 'a', 'c'] });
  assert.deepEqual(merged.google_ads, ['a', 'b', 'c']);
});

void test('an empty list means expose everything and absorbs any subset', async () => {
  const service = new AttachedAppsService(fakeRedis());
  await service.merge(WORKSPACE, THREAD, { gmail: [] });
  const merged = await service.merge(WORKSPACE, THREAD, { gmail: ['send-email'] });
  assert.deepEqual(merged.gmail, []);
});

void test('a narrowed app is not widened to everything by a later turn', async () => {
  const service = new AttachedAppsService(fakeRedis());
  await service.merge(WORKSPACE, THREAD, { google_ads: ['list-campaigns'] });
  const merged = await service.merge(WORKSPACE, THREAD, { google_ads: [] });
  assert.deepEqual(merged.google_ads, []);
});

void test('the per-app action union is capped so a long thread cannot drift back to everything', async () => {
  const service = new AttachedAppsService(fakeRedis());
  const many = Array.from({ length: 40 }, (_, i) => `action-${String(i).padStart(2, '0')}`);
  const merged = await service.merge(WORKSPACE, THREAD, { google_ads: many });
  assert.equal(merged.google_ads.length, 24);
});

void test('conversations do not leak into each other', async () => {
  const service = new AttachedAppsService(fakeRedis());
  await service.merge(WORKSPACE, THREAD, { google_ads: ['list-campaigns'] });
  assert.deepEqual(await service.get(WORKSPACE, 'other-thread'), {});
  assert.deepEqual(await service.get('ws-2', THREAD), {});
});

void test('a Redis failure costs a re-route, never the run', async () => {
  const service = new AttachedAppsService(brokenRedis());
  assert.deepEqual(await service.get(WORKSPACE, THREAD), {});
  const merged = await service.merge(WORKSPACE, THREAD, { google_ads: ['list-campaigns'] });
  assert.deepEqual(merged, { google_ads: ['list-campaigns'] });
});

void test('replace hands a branching conversation exactly what it was given', async () => {
  const service = new AttachedAppsService(fakeRedis());
  await service.merge(WORKSPACE, THREAD, { google_ads: ['list-campaigns'], gmail: [] });
  // The branch inherits only what its parent turn sent, not everything the
  // parent has accumulated — and does not union with whatever was there before.
  await service.replace(WORKSPACE, 'branch', { google_ads: ['list-campaigns'] });
  await service.replace(WORKSPACE, 'branch', { meta_ads: ['list-adaccounts'] });
  assert.deepEqual(await service.get(WORKSPACE, 'branch'), { meta_ads: ['list-adaccounts'] });
  assert.deepEqual(Object.keys(await service.get(WORKSPACE, THREAD)).sort(), [
    'gmail',
    'google_ads',
  ]);
});

void test('a Redis failure during replace never fails the run', async () => {
  const service = new AttachedAppsService(brokenRedis());
  await service.replace(WORKSPACE, 'branch', { google_ads: ['list-campaigns'] });
});

void test('a corrupt record is treated as nothing attached', async () => {
  const service = new AttachedAppsService(fakeRedis({ 'ai:attached:ws-1:1712345678.0001': '{' }));
  assert.deepEqual(await service.get(WORKSPACE, THREAD), {});
});
