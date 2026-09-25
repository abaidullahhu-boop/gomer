import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { Space, SpaceRecord } from '../database/entities';
import { SpacesService } from './spaces.service';

const spec = {
  name: 'Meta Ads Gameplan',
  entities: [
    {
      name: 'Step',
      label: 'Step',
      fields: [
        { name: 'title', label: 'Title', type: 'string', required: true },
        { name: 'week', label: 'Week', type: 'number' },
      ],
    },
  ],
  views: [{ type: 'table', title: 'Plan', entity: 'Step' }],
  auth: { mode: 'magic-link', allowSignup: false },
};

/** SpacesService over in-memory fakes, recording what it saved. */
function harness(existingSpace?: Space) {
  const savedSpaces: Space[] = [];
  const savedRecords: Array<Partial<SpaceRecord>> = [];
  const manager = {
    create: (_entity: unknown, row: object) => ({ ...row }),
    save: async (entity: unknown, rows?: unknown) => {
      if (entity === SpaceRecord) {
        savedRecords.push(...(rows as Array<Partial<SpaceRecord>>));
        return rows;
      }
      const space = { ...(entity as Space), id: 'space-1' };
      savedSpaces.push(space);
      return space;
    },
  };
  const spaceRepository = {
    exists: async () => false,
    findOne: async () => existingSpace ?? null,
    manager: { transaction: async (work: (m: typeof manager) => unknown) => work(manager) },
  };
  const recordRepository = { find: async () => [], manager };
  const service = new SpacesService(
    spaceRepository as never,
    recordRepository as never,
    {} as never,
    { get: () => 'https://gaspo.test' } as never,
  );
  return { service, savedSpaces, savedRecords };
}

test('a Space is built with its starting rows, in the order they were written', async () => {
  const { service, savedSpaces, savedRecords } = harness();

  const { space, added } = await service.createFromSpec('ws-1', 'user-1', spec, {
    Step: [{ title: 'Install the pixel', week: 1 }, { title: 'Launch a test campaign' }],
  });

  assert.equal(added, 2);
  assert.equal(space.slug, 'meta-ads-gameplan');
  assert.equal(savedSpaces.length, 1);
  assert.deepEqual(
    savedRecords.map((r) => [r.spaceId, r.entityName, r.data]),
    [
      ['space-1', 'Step', { title: 'Install the pixel', week: 1 }],
      ['space-1', 'Step', { title: 'Launch a test campaign' }],
    ],
  );
  // Listed newest first, so the first row written must be the newest.
  assert.ok(savedRecords[0].createdAt! > savedRecords[1].createdAt!);
});

test('a bad starting row stops the build before an empty app is saved', async () => {
  const { service, savedSpaces, savedRecords } = harness();

  await assert.rejects(
    service.createFromSpec('ws-1', 'user-1', spec, { Step: [{ name: 'Install the pixel' }] }),
    BadRequestException,
  );
  assert.equal(savedSpaces.length, 0);
  assert.equal(savedRecords.length, 0);
});

test('filling an existing app with nothing lists what it can hold', async () => {
  const { service } = harness({ id: 'space-1', slug: 'meta-ads-gameplan', spec } as Space);

  await assert.rejects(service.addRecords('ws-1', 'meta-ads-gameplan', {}), (error) => {
    assert.ok(error instanceof BadRequestException);
    assert.match(error.message, /records is empty\. This app has Step: title \(string, required\)/);
    return true;
  });
});

test('an existing empty app can be filled in', async () => {
  const { service, savedRecords } = harness({
    id: 'space-1',
    slug: 'meta-ads-gameplan',
    spec,
  } as Space);

  const { added } = await service.addRecords('ws-1', 'meta-ads-gameplan', {
    Step: [{ title: 'Install the pixel' }],
  });

  assert.equal(added, 1);
  assert.deepEqual(savedRecords[0].data, { title: 'Install the pixel' });
});
