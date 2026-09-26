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
  const updates: Array<Partial<Space>> = [];
  const spaceRepository = {
    exists: async () => false,
    findOne: async () => existingSpace ?? null,
    create: (row: Partial<Space>) => ({ ...row }),
    save: async (row: Space) => {
      const space = { ...row, id: 'space-1' };
      savedSpaces.push(space);
      return space;
    },
    update: async (_id: string, patch: Partial<Space>) => {
      updates.push(patch);
    },
    createQueryBuilder: () => {
      const query = {
        addSelect: () => query,
        where: () => query,
        getOne: async () => existingSpace ?? null,
      };
      return query;
    },
    manager: { transaction: async (work: (m: typeof manager) => unknown) => work(manager) },
  };
  const recordRepository = { find: async () => [], manager };
  const service = new SpacesService(
    spaceRepository as never,
    recordRepository as never,
    {} as never,
    { get: () => 'https://gaspo.test' } as never,
  );
  return { service, savedSpaces, savedRecords, updates };
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

const PAGE = '<!doctype html><html><body><h1>From $0 to $4k/month</h1></body></html>';

function page(html = PAGE): Space {
  return {
    id: 'space-1',
    slug: 'ai-staff-gameplan',
    name: 'Gameplan',
    kind: 'page',
    html,
    spec,
  } as Space;
}

test('a page is saved as a page, closed to outsiders unless asked', async () => {
  const { service, savedSpaces } = harness();

  const saved = await service.createPage('ws-1', 'user-1', {
    name: 'AI Staff Gameplan',
    html: PAGE,
  });

  assert.equal(saved.slug, 'ai-staff-gameplan');
  assert.equal(savedSpaces[0].kind, 'page');
  assert.equal(savedSpaces[0].html, PAGE);
  assert.deepEqual(savedSpaces[0].spec, {
    name: 'AI Staff Gameplan',
    entities: [],
    views: [],
    auth: { mode: 'magic-link', allowSignup: false },
  });
});

test('a page can be fixed with a targeted edit instead of being rewritten', async () => {
  const { service, updates } = harness(page());

  const updated = await service.updatePage('ws-1', 'ai-staff-gameplan', {
    edits: [{ find: '$4k/month', replace: '$4k/month profit' }],
  });

  assert.equal(
    updated.html,
    '<!doctype html><html><body><h1>From $0 to $4k/month profit</h1></body></html>',
  );
  assert.equal(updates[0].html, updated.html);
});

test('a page change must be either the whole page or edits', async () => {
  const { service } = harness(page());

  await assert.rejects(
    service.updatePage('ws-1', 'ai-staff-gameplan', { html: PAGE, edits: [] }),
    /either html .* or edits/,
  );
});

test('app tools refuse a page, and page tools refuse an app, pointing at the right one', async () => {
  await assert.rejects(
    harness(page()).service.updateSpec('ws-1', 'ai-staff-gameplan', spec),
    /is a page, not an app\. Change it with update_page/,
  );
  await assert.rejects(
    harness(page()).service.addRecords('ws-1', 'ai-staff-gameplan', { Step: [{ title: 'x' }] }),
    /is a page, not an app/,
  );
  const app = { id: 'space-1', slug: 'meta-ads-gameplan', kind: 'app', spec } as Space;
  await assert.rejects(
    harness(app).service.updatePage('ws-1', 'meta-ads-gameplan', { html: PAGE }),
    /is an app, not a page/,
  );
});
