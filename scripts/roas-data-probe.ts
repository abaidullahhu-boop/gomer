/**
 * Probe: is there real data behind a verified-ROAS answer?
 *
 * `verify_roas` pairs Meta-reported ad spend with actual Stripe revenue over the
 * same window. Both sides have to be non-empty, and in the same currency, or the
 * answer degrades into caveats — "Meta returned no insight rows", a zero
 * revenue, or "ROAS was not computed across currencies". None of that is visible
 * until the tool runs, which is a bad thing to discover on camera.
 *
 * This reads both sides exactly the way RoasService does and reports what a
 * demo would actually get.
 *
 *   npm run probe:roas              # last 7 days
 *   PROBE_DAYS=30 npm run probe:roas
 *
 * Read-only: lists ad accounts, reads insights, lists charges. Writes nothing
 * and persists no snapshot.
 */
import 'dotenv/config';
import { PipedreamClient, ProjectEnvironment } from '@pipedream/sdk';
import { DataSource } from 'typeorm';
import { entities, Integration } from '../src/database/entities';

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';
const STRIPE_BASE = 'https://api.stripe.com/v1';
const DAYS = Number(process.env.PROBE_DAYS ?? 7);

/** YYYY-MM-DD, UTC, `daysAgo` days before today. */
function isoDay(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

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
  const repo = dataSource.getRepository(Integration);

  const since = isoDay(DAYS);
  const until = isoDay(0);
  console.log(`window: ${since} .. ${until}  (${DAYS} days, UTC)\n`);

  // ---- Spend side: Meta ------------------------------------------------
  const meta = await repo.findOne({
    where: { appSlug: 'meta_ads', isActive: true },
    order: { connectedAt: 'DESC' },
  });
  let spendCurrency: string | null = null;

  if (!meta?.accessToken) {
    console.log('META: no active connection with a stored token.');
  } else {
    const accounts = await getJson<{ data: Array<{ id: string; name?: string; account_currency?: string }> }>(
      `${GRAPH_BASE}/me/adaccounts?fields=name,account_currency&limit=25`,
      meta.accessToken,
    );
    const rows = accounts?.data ?? [];
    console.log(`META: ${rows.length} ad account(s)`);

    for (const acct of rows) {
      const url =
        `${GRAPH_BASE}/${acct.id}/insights` +
        `?level=account&fields=spend,account_currency,impressions,clicks` +
        `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
      const insights = await getJson<{ data: Array<Record<string, string>> }>(url, meta.accessToken);
      const data = insights?.data ?? [];
      const spend = data.reduce((s, r) => s + (Number(r.spend) || 0), 0);
      const cur = data.find((r) => r.account_currency)?.account_currency ?? acct.account_currency ?? '?';
      if (!spendCurrency && spend > 0) spendCurrency = cur;
      const verdict = data.length === 0 ? '  <-- NO INSIGHT ROWS' : spend === 0 ? '  <-- ZERO SPEND' : '';
      console.log(`  ${acct.id} ${acct.name ?? ''} : spend ${spend.toFixed(2)} ${cur}${verdict}`);
    }
  }

  // ---- Revenue side: Stripe (key lives in Pipedream) --------------------
  console.log();
  const stripeRow = await repo.findOne({
    where: { appSlug: 'stripe', isActive: true, provider: 'pipedream' },
    order: { connectedAt: 'DESC' },
  });

  if (!stripeRow?.externalAccountId) {
    console.log('STRIPE: no active pipedream connection with an account id.');
  } else {
    const client = new PipedreamClient({
      clientId: process.env.PIPEDREAM_CLIENT_ID!,
      clientSecret: process.env.PIPEDREAM_CLIENT_SECRET!,
      projectId: process.env.PIPEDREAM_PROJECT_ID!,
      projectEnvironment: (process.env.PIPEDREAM_ENVIRONMENT ?? 'development') as ProjectEnvironment,
    });
    const account = await client.accounts.retrieve(stripeRow.externalAccountId, {
      includeCredentials: true,
    });
    const creds = (account.credentials ?? {}) as Record<string, unknown>;
    const key = [creds.api_key, creds.apiKey, creds.oauthAccessToken].find(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );

    if (!key) {
      console.log('STRIPE: connected, but no api_key in the Pipedream credentials.');
    } else {
      const mode = key.startsWith('sk_live') || key.startsWith('rk_live') ? 'LIVE' : 'TEST';
      console.log(`STRIPE: key mode = ${mode}`);

      const q = new URLSearchParams({
        limit: '100',
        'created[gte]': String(Math.floor(new Date(`${since}T00:00:00Z`).getTime() / 1000)),
        'created[lte]': String(Math.floor(new Date(`${until}T23:59:59Z`).getTime() / 1000)),
      });
      const res = await fetch(`${STRIPE_BASE}/charges?${q}`, {
        headers: { authorization: `Bearer ${key}` },
      });
      const body = (await res.json()) as {
        data?: Array<{ amount: number; amount_refunded: number; currency: string; status: string; paid: boolean }>;
        has_more?: boolean;
        error?: { message?: string };
      };
      if (body.error) {
        console.log(`  Stripe error: ${body.error.message}`);
      } else {
        const totals = new Map<string, { net: number; n: number }>();
        for (const c of body.data ?? []) {
          if (c.status !== 'succeeded' || !c.paid) continue;
          const e = totals.get(c.currency) ?? { net: 0, n: 0 };
          e.net += (c.amount - c.amount_refunded) / 100;
          e.n += 1;
          totals.set(c.currency, e);
        }
        if (totals.size === 0) {
          console.log('  NO SUCCEEDED CHARGES in this window  <-- revenue would be 0');
        }
        for (const [cur, e] of totals) {
          const flag = spendCurrency && cur.toUpperCase() !== spendCurrency.toUpperCase()
            ? `  <-- CURRENCY MISMATCH vs spend (${spendCurrency})`
            : '';
          console.log(`  ${e.n} charge(s), net ${e.net.toFixed(2)} ${cur.toUpperCase()}${flag}`);
        }
        if (body.has_more) console.log('  (more than 100 charges; real run pages further)');
      }
    }
  }

  await dataSource.destroy();
}

/** GET a Graph URL, printing the error envelope rather than throwing. */
async function getJson<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok || (body as { error?: unknown }).error) {
    console.log(`  Meta error: ${body.error?.message ?? `HTTP ${res.status}`}`);
    return null;
  }
  return body;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
