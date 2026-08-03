import assert from 'node:assert/strict';
import test from 'node:test';
import { ToolRouterService } from './tool-router.service';
import {
  LlmProvider,
  ProviderRequest,
  ProviderResponse,
  RemoteMcpServer,
  ToolSpec,
} from './provider.interface';

const SERVERS: RemoteMcpServer[] = [
  { appSlug: 'google_sheets', name: 'google_sheets', url: 'https://mcp/sheets' },
  { appSlug: 'slack', name: 'slack', url: 'https://mcp/slack' },
  { appSlug: 'notion', name: 'notion', url: 'https://mcp/notion' },
];

/** A provider that answers the router with whatever `text` is given. */
function stubProvider(text: string | Error): LlmProvider {
  return {
    id: 'stub',
    isConfigured: () => true,
    create: (): Promise<ProviderResponse> => {
      if (text instanceof Error) return Promise.reject(text);
      return Promise.resolve({
        text,
        toolCalls: [],
        remoteActivity: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'end',
        raw: null,
      });
    },
  };
}

async function select(
  answer: string | Error,
  servers: RemoteMcpServer[] = SERVERS,
): Promise<RemoteMcpServer[] | null> {
  return new ToolRouterService().selectRelevantServers(
    stubProvider(answer),
    'claude-sonnet-5',
    'export last week to a spreadsheet',
    servers,
  );
}

void test('selectRelevantServers keeps only the named apps', async () => {
  const selected = await select('["google_sheets"]');
  assert.deepEqual(selected?.map((server) => server.appSlug), ['google_sheets']);
});

void test('selectRelevantServers preserves input order so the prefix stays cacheable', async () => {
  const selected = await select('["notion", "google_sheets"]');
  assert.deepEqual(selected?.map((server) => server.appSlug), ['google_sheets', 'notion']);
});

void test('selectRelevantServers trusts an explicit empty answer', async () => {
  assert.deepEqual(await select('[]'), []);
});

void test('selectRelevantServers tolerates a code fence around the array', async () => {
  const selected = await select('```json\n["slack"]\n```');
  assert.deepEqual(selected?.map((server) => server.appSlug), ['slack']);
});

void test('selectRelevantServers falls back when every name is hallucinated', async () => {
  assert.equal(await select('["salesforce"]'), null);
});

void test('selectRelevantServers falls back on an unparseable answer', async () => {
  assert.equal(await select('I think you should use Google Sheets.'), null);
});

void test('selectRelevantServers falls back when the provider fails', async () => {
  assert.equal(await select(new Error('503')), null);
});

void test('selectRelevantServers skips routing for a single server', async () => {
  assert.equal(await select('["google_sheets"]', SERVERS.slice(0, 1)), null);
});

void test('selectRelevantServers tells the router which tools are built in', async () => {
  // Without this the router cannot tell that a request is already covered
  // locally, and attaches whichever connected app looks topically closest.
  const localTools: ToolSpec[] = [
    { name: 'meta_ads_list_campaigns', description: 'List Meta campaigns', parameters: {} },
    { name: 'verify_roas', description: 'Verify ROAS', parameters: {} },
  ];
  let seen: ProviderRequest | null = null;
  const provider: LlmProvider = {
    id: 'stub',
    isConfigured: () => true,
    create: (request: ProviderRequest): Promise<ProviderResponse> => {
      seen = request;
      return Promise.resolve({
        text: '[]',
        toolCalls: [],
        remoteActivity: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        stopReason: 'end',
        raw: null,
      });
    },
  };

  await new ToolRouterService().selectRelevantServers(
    provider,
    'claude-sonnet-5',
    'what were my top campaigns by spend?',
    SERVERS,
    localTools,
  );

  const sent = (seen as ProviderRequest | null)?.messages[0];
  const content = sent && sent.role === 'user' ? sent.content : '';
  assert.match(content, /meta_ads_list_campaigns/);
  assert.match(content, /verify_roas/);
});
