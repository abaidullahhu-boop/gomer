import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAppSpec, validateRecordData } from './validate-spec';
import { EntitySpec } from './app-spec';

const validSpec = {
  name: 'Time Logger',
  entities: [
    {
      name: 'Project',
      label: 'Project',
      fields: [{ name: 'name', label: 'Name', type: 'string', required: true }],
    },
    {
      name: 'TimeEntry',
      label: 'Time entry',
      fields: [
        { name: 'project', label: 'Project', type: 'reference', refEntity: 'Project' },
        { name: 'hours', label: 'Hours', type: 'number', required: true },
      ],
    },
  ],
  views: [
    { type: 'form', title: 'Log time', entity: 'TimeEntry' },
    {
      type: 'dashboard',
      title: 'Overview',
      widgets: [{ kind: 'sum', label: 'Total', entity: 'TimeEntry', field: 'hours' }],
    },
  ],
  auth: { mode: 'magic-link', allowSignup: true },
};

test('accepts a well-formed spec', () => {
  assert.doesNotThrow(() => validateAppSpec(validSpec));
});

test('rejects non-object input', () => {
  assert.throws(() => validateAppSpec(null));
});

test('rejects a spec with no entities', () => {
  assert.throws(() => validateAppSpec({ ...validSpec, entities: [] }));
});

test('rejects a view referencing an unknown entity', () => {
  assert.throws(() =>
    validateAppSpec({ ...validSpec, views: [{ type: 'table', title: 'X', entity: 'Ghost' }] }),
  );
});

test('rejects a select field without options', () => {
  assert.throws(() =>
    validateAppSpec({
      ...validSpec,
      entities: [{ name: 'A', label: 'A', fields: [{ name: 'f', label: 'F', type: 'select' }] }],
      views: [{ type: 'table', title: 'T', entity: 'A' }],
    }),
  );
});

test('rejects an unsupported auth mode', () => {
  assert.throws(() =>
    validateAppSpec({ ...validSpec, auth: { mode: 'password', allowSignup: true } }),
  );
});

const projectEntity: EntitySpec = {
  name: 'Project',
  label: 'Project',
  fields: [
    { name: 'name', label: 'Name', type: 'string', required: true },
    { name: 'budget', label: 'Budget', type: 'number' },
  ],
};

test('validateRecordData enforces required fields', () => {
  assert.throws(() => validateRecordData(projectEntity, {}));
});

test('validateRecordData coerces numbers and drops unknown keys', () => {
  const clean = validateRecordData(projectEntity, { name: 'X', budget: '100', bogus: 'nope' });
  assert.equal(clean.budget, 100);
  assert.equal('bogus' in clean, false);
});
