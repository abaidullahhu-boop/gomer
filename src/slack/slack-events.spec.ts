import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationKeys } from './slack-events.service';

const DM = 'D0123';
const CHANNEL = 'C0456';

void test('two threads in one DM are separate conversations', () => {
  // The bug this exists for: both threads keyed by the DM channel, so a Google
  // Ads thread resumed after a Meta detour answered with the Meta budget.
  const ads = conversationKeys({ channel_type: 'im', ts: '3', thread_ts: '1' }, DM);
  const meta = conversationKeys({ channel_type: 'im', ts: '4', thread_ts: '2' }, DM);
  assert.equal(ads.memoryThreadId, '1');
  assert.equal(meta.memoryThreadId, '2');
  assert.notEqual(ads.memoryThreadId, meta.memoryThreadId);
});

void test('an unthreaded DM stays one rolling conversation', () => {
  const first = conversationKeys({ channel_type: 'im', ts: '1' }, DM);
  const second = conversationKeys({ channel_type: 'im', ts: '2' }, DM);
  assert.equal(first.memoryThreadId, DM);
  assert.equal(second.memoryThreadId, DM);
});

void test('an unthreaded DM names the thread our answer will open', () => {
  const { branchThreadId } = conversationKeys({ channel_type: 'im', ts: '1' }, DM);
  assert.equal(branchThreadId, '1');
});

void test('the branch key is where the follow-up actually lands', () => {
  // We answer the top-level DM in a thread under it; the user replies there.
  const parent = conversationKeys({ channel_type: 'im', ts: '1' }, DM);
  const reply = conversationKeys({ channel_type: 'im', ts: '2', thread_ts: '1' }, DM);
  assert.equal(parent.branchThreadId, reply.memoryThreadId);
});

void test('a threaded DM reply has nothing to branch into', () => {
  const { branchThreadId } = conversationKeys({ channel_type: 'im', ts: '2', thread_ts: '1' }, DM);
  assert.equal(branchThreadId, null);
});

void test('a channel mention is keyed by its thread and never mirrored', () => {
  const root = conversationKeys({ channel_type: 'channel', ts: '1' }, CHANNEL);
  const reply = conversationKeys({ channel_type: 'channel', ts: '2', thread_ts: '1' }, CHANNEL);
  assert.equal(root.memoryThreadId, '1');
  assert.equal(reply.memoryThreadId, '1');
  assert.equal(root.branchThreadId, null);
  assert.equal(reply.branchThreadId, null);
});

void test('an app_mention with no channel_type is keyed by its thread', () => {
  // app_mention events carry no channel_type, so the DM branch must not catch
  // them: keying those by channel would merge every thread in a busy channel.
  const { memoryThreadId, branchThreadId } = conversationKeys({ ts: '2', thread_ts: '1' }, CHANNEL);
  assert.equal(memoryThreadId, '1');
  assert.equal(branchThreadId, null);
});

void test('a message with no ts has no thread to branch into', () => {
  const { memoryThreadId, branchThreadId } = conversationKeys({ channel_type: 'im' }, DM);
  assert.equal(memoryThreadId, DM);
  assert.equal(branchThreadId, null);
});
