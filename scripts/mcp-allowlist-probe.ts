/**
 * Probe: does an `mcp_toolset` allowlist actually shrink the prompt?
 *
 * Server-side MCP hides the individual schemas from us, so the only way to know
 * whether restricting a toolset saves tokens — rather than merely gating what
 * the model may call — is to send the same request twice and compare what we
 * were billed for. Caching is deliberately off so both numbers land in
 * `input_tokens` and are directly comparable.
 *
 *   npm run probe:allowlist
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { PipedreamClient, ProjectEnvironment } from '@pipedream/sdk';

const MCP_BETA = 'mcp-client-2025-11-20';
const MCP_BASE_URL = 'https://remote.mcp.pipedream.net/v3';

const APP_SLUG = process.env.PROBE_APP_SLUG ?? 'google_ads';
/** The Pipedream external user id the app is connected under (a workspace id
 *  for a team connection). Team connections key by workspace. */
const EXTERNAL_USER_ID = process.env.PROBE_EXTERNAL_USER_ID ?? '';
/** The actions a router would plausibly keep for the question below. */
const ALLOWED = (
  process.env.PROBE_ALLOWED_TOOLS ??
  'google_ads-list-account-id-options,google_ads-list-customer-clients'
).split(',');

const SYSTEM =
  'You are Gomer, an AI assistant for a workspace. Use the available tools to answer.';
const PROMPT = 'List my Google Ads accounts.';

async function usageFor(
  client: Anthropic,
  serverUrl: string,
  token: string,
  toolset: Record<string, unknown>,
  maxTokens = 64,
): Promise<{ input: number; output: number; called: string[]; errored: string[] }> {
  const response = await client.beta.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: maxTokens,
    system: SYSTEM,
    messages: [{ role: 'user', content: PROMPT }],
    tools: [toolset as never],
    mcp_servers: [
      { type: 'url', url: serverUrl, name: `pipedream-probe-${APP_SLUG}`, authorization_token: token },
    ],
    betas: [MCP_BETA],
  });

  // Whether the allowlist merely hid the schemas or actually broke execution is
  // the thing worth knowing — a saving that costs the ability to call the tool
  // is not a saving.
  const called: string[] = [];
  const errored: string[] = [];
  for (const block of response.content) {
    if (block.type === 'mcp_tool_use') called.push(block.name);
    if (block.type === 'mcp_tool_result' && block.is_error) errored.push(block.tool_use_id);
  }
  return {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    called,
    errored,
  };
}

async function main(): Promise<void> {
  if (!EXTERNAL_USER_ID) {
    throw new Error('Set PROBE_EXTERNAL_USER_ID to the workspace id the app is connected under.');
  }

  const pipedream = new PipedreamClient({
    clientId: process.env.PIPEDREAM_CLIENT_ID!,
    clientSecret: process.env.PIPEDREAM_CLIENT_SECRET!,
    projectId: process.env.PIPEDREAM_PROJECT_ID!,
    projectEnvironment: (process.env.PIPEDREAM_ENVIRONMENT ?? 'production') as ProjectEnvironment,
  });
  const token = await pipedream.rawAccessToken;

  const params = new URLSearchParams({
    projectId: process.env.PIPEDREAM_PROJECT_ID!,
    environment: process.env.PIPEDREAM_ENVIRONMENT ?? 'production',
    externalUserId: EXTERNAL_USER_ID,
    app: APP_SLUG,
  });
  const serverUrl = `${MCP_BASE_URL}?${params.toString()}`;
  const name = `pipedream-probe-${APP_SLUG}`;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log(`app=${APP_SLUG} allowlist=[${ALLOWED.join(', ')}]\n`);

  const full = await usageFor(client, serverUrl, token, {
    type: 'mcp_toolset',
    mcp_server_name: name,
  });
  console.log(`every action:  input=${full.input} output=${full.output}`);

  let restricted: { input: number; output: number };
  try {
    restricted = await usageFor(client, serverUrl, token, {
      type: 'mcp_toolset',
      mcp_server_name: name,
      default_config: { enabled: false },
      configs: Object.fromEntries(ALLOWED.map((tool) => [tool, { enabled: true }])),
    });
  } catch (error) {
    console.error(
      `\nAllowlist REJECTED: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error('The API does not accept per-action config on this beta — do not build on it.');
    process.exit(1);
  }

  console.log(`allowlisted:   input=${restricted.input} output=${restricted.output}`);
  const saved = full.input - restricted.input;
  const pct = full.input ? ((saved / full.input) * 100).toFixed(1) : '0';
  console.log(`\nsaved ${saved} input tokens (${pct}%)`);
  console.log(
    saved > 1000
      ? 'Allowlist shrinks the prompt — action-level routing is worth building.'
      : 'Allowlist is accepted but does NOT shrink the prompt — it only gates execution.',
  );

  // A shrunken prompt is worthless if the surviving action can no longer run.
  const executed = await usageFor(
    client,
    serverUrl,
    token,
    {
      type: 'mcp_toolset',
      mcp_server_name: name,
      default_config: { enabled: false },
      configs: Object.fromEntries(ALLOWED.map((tool) => [tool, { enabled: true }])),
    },
    2048,
  );
  console.log(
    `\nallowlisted call: input=${executed.input} called=[${executed.called.join(', ') || 'none'}]` +
      ` errors=${executed.errored.length}`,
  );
  console.log(
    executed.called.length && !executed.errored.length
      ? 'An allowlisted action still executes — the saving costs no capability.'
      : 'WARNING: no successful allowlisted call — check before shipping.',
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
