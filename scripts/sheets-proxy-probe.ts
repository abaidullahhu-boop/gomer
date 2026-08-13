/**
 * Probe: does a Sheets call actually work through the Pipedream Connect proxy?
 *
 * The export automation routes every Google Sheets call through the proxy so
 * Pipedream owns the credential and its refresh. That path can only be trusted
 * once it has been exercised against a real connected account — the failure
 * modes (scopes, proxy availability, how a target-API error comes back) are
 * invisible from a unit test.
 *
 * Reads the connected account straight from the database, so it probes the same
 * account the running app would use.
 *
 *   npm run probe:sheets                 # uses the workspace's google_sheets account
 *   PROBE_APP_SLUG=google npm run probe:sheets
 *
 * Writes nothing by default: it creates no spreadsheet and only reads metadata.
 * Set PROBE_WRITE=1 to also create a throwaway spreadsheet and append a row —
 * which is the only way to prove the write scope is really granted.
 */
import 'dotenv/config';
import { PipedreamClient, ProjectEnvironment } from '@pipedream/sdk';
import { DataSource } from 'typeorm';
import { entities, Integration } from '../src/database/entities';

const APP_SLUG = process.env.PROBE_APP_SLUG ?? 'google_sheets';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function main(): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities,
  });
  await dataSource.initialize();

  const row = await dataSource.getRepository(Integration).findOne({
    where: { appSlug: APP_SLUG, isActive: true, provider: 'pipedream' },
    order: { connectedAt: 'DESC' },
  });
  if (!row?.externalAccountId) {
    throw new Error(`No active pipedream "${APP_SLUG}" connection with an account id was found.`);
  }

  // Team connections key by workspace id; private ones by the `u:` namespace —
  // the same mapping IntegrationsService.resolveExternalUserId applies.
  const externalUserId =
    row.accessLevel === 'private' ? `u:${row.userId}` : row.workspaceId;
  console.log(`account: ${APP_SLUG} (${row.accessLevel}) under external user ${externalUserId}`);

  const client = new PipedreamClient({
    clientId: process.env.PIPEDREAM_CLIENT_ID!,
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET!,
    projectId: process.env.PIPEDREAM_PROJECT_ID!,
    projectEnvironment: (process.env.PIPEDREAM_ENVIRONMENT ?? 'development') as ProjectEnvironment,
  });
  const target = { externalUserId, accountId: row.externalAccountId };

  // 1. Read: a bogus spreadsheet id. A 404 from Google proves the proxy reached
  //    the API authenticated; a 401/403 means the credential or scope is wrong.
  await step('GET (expect a Google 404 for a fake id)', () =>
    client.proxy.get({ ...target, url: `${SHEETS_BASE}/PROBE_NOT_A_REAL_ID` }),
  );

  if (process.env.PROBE_WRITE !== '1') {
    console.log('\nRead-only probe done. Set PROBE_WRITE=1 to prove the write scope.');
    await dataSource.destroy();
    return;
  }

  // 2. Write: create a spreadsheet, then append a row to it.
  const created = (await step('POST create spreadsheet', () =>
    client.proxy.post({
      ...target,
      url: SHEETS_BASE,
      body: {
        properties: { title: `Gomer proxy probe ${new Date().toISOString()}` },
        sheets: [{ properties: { title: 'Probe' } }],
      },
    }),
  )) as { spreadsheetId?: string; spreadsheetUrl?: string } | undefined;

  if (created?.spreadsheetId) {
    const range = encodeURIComponent("'Probe'!A1");
    await step('POST append row', () =>
      client.proxy.post({
        ...target,
        url:
          `${SHEETS_BASE}/${created.spreadsheetId}/values/${range}:append` +
          '?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS',
        body: { values: [['probe', new Date().toISOString()]] },
      }),
    );
    console.log(`\nsheet: ${created.spreadsheetUrl ?? created.spreadsheetId}`);
  }

  await dataSource.destroy();
}

/** Run one proxied call, printing whichever shape comes back — body or error. */
async function step(label: string, fn: () => Promise<unknown>): Promise<unknown> {
  console.log(`\n--- ${label}`);
  try {
    const result = await fn();
    console.log('ok ->', JSON.stringify(result).slice(0, 400));
    return result;
  } catch (error) {
    const err = error as { statusCode?: number; body?: unknown; message?: string };
    console.log(`threw -> status ${err.statusCode ?? '?'}: ${err.message}`);
    if (err.body) console.log('  body:', JSON.stringify(err.body).slice(0, 400));
    return undefined;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
