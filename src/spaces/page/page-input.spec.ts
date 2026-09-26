import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { validationReasons } from '../spec/validate-spec';
import {
  applyPageEdits,
  MAX_PAGE_CHARS,
  MAX_STATE_VALUE_CHARS,
  validatePageInput,
  validatePageStateEntry,
} from './page-input';

const PAGE = '<!doctype html><html><body><h1>From $0 to $4k</h1><p>Phase 1</p></body></html>';

test('a page needs a name and a whole HTML document', () => {
  assert.deepEqual(validatePageInput({ name: ' Gameplan ', html: PAGE }), {
    name: 'Gameplan',
    description: null,
    html: PAGE,
    allowSignup: false,
  });
  assert.throws(() => validatePageInput({ html: PAGE }), /name is required/);
  assert.throws(() => validatePageInput({ name: 'x', html: '' }), /whole page/);
  assert.throws(() => validatePageInput({ name: 'x', html: 'just some words' }), /HTML document/);
});

test('a page over the size limit is refused with its size, so the model can cut it down', () => {
  const html = `<p>${'x'.repeat(MAX_PAGE_CHARS)}</p>`;
  assert.throws(() => validatePageInput({ name: 'x', html }), /at most 300000/);
});

test('edits apply in order, and literally, even when the replacement looks like a pattern', () => {
  const html = applyPageEdits(PAGE, [
    { find: 'From $0 to $4k', replace: 'From $0 to $4k/month' },
    { find: '<p>Phase 1</p>', replace: '<p>Phase 1: $& hand-sell</p>' },
  ]);

  assert.match(html, /<h1>From \$0 to \$4k\/month<\/h1>/);
  assert.match(html, /<p>Phase 1: \$& hand-sell<\/p>/);
});

test('an edit that matches nowhere or more than once changes nothing and says which', () => {
  const page = '<p>Step</p><p>Step</p><h1>Title</h1>';
  let reasons: string[] = [];
  try {
    applyPageEdits(page, [
      { find: '<h1>Title</h1>', replace: '<h1>New</h1>' },
      { find: '<p>Step</p>', replace: '<p>Done</p>' },
      { find: 'missing', replace: 'x' },
    ]);
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    reasons = validationReasons(error);
  }

  assert.deepEqual(reasons, [
    'edits[1].find appears 2 times. Include more of the surrounding text',
    'edits[2].find does not appear in the page. Copy it exactly from get_page',
  ]);
});

test('a saved value is JSON within the limit, and a key is required', () => {
  assert.deepEqual(validatePageStateEntry('phase-1-done', true), {
    key: 'phase-1-done',
    json: 'true',
  });
  assert.equal(validatePageStateEntry('gone', null).json, 'null');
  assert.throws(() => validatePageStateEntry('', 1), /key must be/);
  assert.throws(
    () => validatePageStateEntry('big', 'x'.repeat(MAX_STATE_VALUE_CHARS)),
    /at most 100000/,
  );
});
