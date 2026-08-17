import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type Redis from 'ioredis';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimitOptions } from '../decorators/rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';

/** A Redis stand-in that counts INCRs per key, as the real client would. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const expiries: string[] = [];
  return {
    counts,
    expiries,
    client: {
      incr: (key: string) => {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return Promise.resolve(next);
      },
      expire: (key: string) => {
        expiries.push(key);
        return Promise.resolve(1);
      },
    } as unknown as Redis,
  };
}

/** A Reflector that always reports the same @RateLimit() metadata. */
function reflectorFor(options: RateLimitOptions | undefined): Reflector {
  return { getAllAndOverride: () => options } as unknown as Reflector;
}

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getClass: () => ({ name: 'TestController' }),
    getHandler: () => ({ name: 'testRoute' }),
  } as unknown as ExecutionContext;
}

const anonymous = { headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, ip: '10.0.0.1' };

test('allows requests up to the limit, then rejects with 429', async () => {
  const redis = fakeRedis();
  const guard = new RateLimitGuard(reflectorFor({ limit: 3, windowSeconds: 60 }), redis.client);
  const ctx = contextFor(anonymous);

  for (let i = 0; i < 3; i++) {
    assert.equal(await guard.canActivate(ctx), true, `request ${i + 1} should pass`);
  }
  await assert.rejects(() => guard.canActivate(ctx), HttpException);
});

test('sets the window expiry once, on the first request only', async () => {
  const redis = fakeRedis();
  const guard = new RateLimitGuard(reflectorFor({ limit: 5, windowSeconds: 60 }), redis.client);
  const ctx = contextFor(anonymous);

  await guard.canActivate(ctx);
  await guard.canActivate(ctx);
  assert.equal(redis.expiries.length, 1, 'a later hit must not extend the window');
});

test('buckets by the first x-forwarded-for hop, not the proxy address', async () => {
  const redis = fakeRedis();
  const guard = new RateLimitGuard(reflectorFor({ limit: 2, windowSeconds: 60 }), redis.client);

  await guard.canActivate(contextFor(anonymous));
  await guard.canActivate(
    contextFor({ headers: { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' }, ip: '10.0.0.1' }),
  );

  const keys = [...redis.counts.keys()];
  assert.equal(keys.length, 2, 'two different clients behind one proxy need separate buckets');
  assert.ok(keys.some((k) => k.endsWith('ip:203.0.113.7')));
  assert.ok(keys.some((k) => k.endsWith('ip:198.51.100.9')));
});

test('buckets an authenticated caller by user id', async () => {
  const redis = fakeRedis();
  const guard = new RateLimitGuard(reflectorFor({ limit: 2, windowSeconds: 60 }), redis.client);
  await guard.canActivate(contextFor({ ...anonymous, user: { userId: 'user-1' } }));
  assert.ok([...redis.counts.keys()][0]?.endsWith('user:user-1'));
});

test('skips routes with no @RateLimit() metadata', async () => {
  const redis = fakeRedis();
  const guard = new RateLimitGuard(reflectorFor(undefined), redis.client);
  assert.equal(await guard.canActivate(contextFor(anonymous)), true);
  assert.equal(redis.counts.size, 0, 'an unannotated route must not touch Redis');
});

test('fails open when Redis is unreachable', async () => {
  const broken = {
    incr: () => Promise.reject(new Error('ECONNREFUSED')),
    expire: () => Promise.resolve(1),
  } as unknown as Redis;
  const guard = new RateLimitGuard(reflectorFor({ limit: 1, windowSeconds: 60 }), broken);
  assert.equal(await guard.canActivate(contextFor(anonymous)), true);
});
