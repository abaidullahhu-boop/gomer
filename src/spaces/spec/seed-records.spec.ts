import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { AppSpec } from './app-spec';
import { MAX_SEED_RECORDS, prepareSeedRecords } from './seed-records';
import { validationReasons } from './validate-spec';

const gameplan: AppSpec = {
  name: 'Gameplan',
  entities: [
    {
      name: 'Phase',
      label: 'Phase',
      fields: [{ name: 'title', label: 'Title', type: 'string', required: true }],
    },
    {
      name: 'Task',
      label: 'Task',
      fields: [
        { name: 'title', label: 'Title', type: 'string', required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['To do', 'Done'] },
        { name: 'phase', label: 'Phase', type: 'reference', refEntity: 'Phase' },
        { name: 'hours', label: 'Hours', type: 'number' },
      ],
    },
  ],
  views: [{ type: 'table', title: 'Tasks', entity: 'Task' }],
  auth: { mode: 'magic-link', allowSignup: false },
};

/** The problems a rejected call reports, which is what the model gets to read. */
function reasonsFor(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    return validationReasons(error);
  }
  assert.fail('expected the rows to be rejected');
}

test('no records means an app with no rows, not an error', () => {
  assert.deepEqual(prepareSeedRecords(gameplan, undefined), []);
  assert.deepEqual(prepareSeedRecords(gameplan, {}), []);
});

test('rows are coerced to their field types and keep the order they were written in', () => {
  const seeds = prepareSeedRecords(gameplan, {
    Task: [
      { title: 'Open the ad account', status: 'To do', hours: '2' },
      { title: 'Launch the first campaign', status: 'Done' },
    ],
  });

  assert.deepEqual(
    seeds.map((s) => s.data),
    [
      { title: 'Open the ad account', status: 'To do', hours: 2 },
      { title: 'Launch the first campaign', status: 'Done' },
    ],
  );
  assert.equal(new Set(seeds.map((s) => s.id)).size, 2);
});

test('a reference names a row from the same call and is stored as its id', () => {
  const seeds = prepareSeedRecords(gameplan, {
    Task: [{ title: 'Write the hooks', phase: ' week 1: foundation ' }],
    Phase: [{ title: 'Week 1: Foundation' }],
  });

  const phase = seeds.find((s) => s.entityName === 'Phase');
  const task = seeds.find((s) => s.entityName === 'Task');
  assert.equal(task?.data.phase, phase?.id);
});

test('a reference can name a row already in the app', () => {
  const seeds = prepareSeedRecords(gameplan, { Task: [{ title: 'Review', phase: 'Launch' }] }, [
    { id: 'phase-existing', entityName: 'Phase', data: { title: 'Launch' } },
  ]);

  assert.equal(seeds[0].data.phase, 'phase-existing');
});

test('guessed field names are rejected, not saved as blank rows, and the real ones are listed', () => {
  const reasons = reasonsFor(() =>
    prepareSeedRecords(gameplan, { Task: [{ name: 'Open the ad account' }] }),
  );

  assert.deepEqual(reasons.slice(0, -1), ['records.Task[0]: unknown field "name"']);
  const [appFields] = reasons.slice(-1);
  assert.match(appFields, /^This app has Phase: title \(string, required\); Task: /);
  assert.match(appFields, /status \(select: To do \| Done\)/);
  assert.match(appFields, /phase \(reference to a Phase, by its name\)/);
});

test('every problem in the call is reported together', () => {
  const reasons = reasonsFor(() =>
    prepareSeedRecords(gameplan, {
      Milestone: [{ title: 'x' }],
      Task: [{ status: 'Blocked' }, { title: 'Ship', phase: 'Week 9' }],
    }),
  );

  assert.ok(reasons.includes('records.Milestone: no such entity'));
  assert.ok(reasons.includes('records.Task[0]: title is required'));
  assert.ok(reasons.some((r) => r.startsWith('records.Task[0]: status must be one of')));
  assert.ok(reasons.some((r) => /records\.Task\[1\]\.phase: no Phase named "Week 9"/.test(r)));
});

test('a row with no values is rejected even when no field is required', () => {
  const notes: AppSpec = {
    ...gameplan,
    entities: [
      { name: 'Note', label: 'Note', fields: [{ name: 'body', label: 'Body', type: 'text' }] },
    ],
  };

  assert.deepEqual(
    reasonsFor(() => prepareSeedRecords(notes, { Note: [{ body: '' }] })),
    ['records.Note[0] has no values', 'This app has Note: body (text)'],
  );
});

test('more rows than one call may add are refused', () => {
  const rows = Array.from({ length: MAX_SEED_RECORDS + 1 }, (_, i) => ({ title: `Phase ${i}` }));

  assert.throws(() => prepareSeedRecords(gameplan, { Phase: rows }), /at most 200/);
});
