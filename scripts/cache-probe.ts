/**
 * Probe: does prompt caching take with the request shape anthropic.provider.ts
 * now sends? Fires the same request twice and prints the usage breakdown.
 *
 *   npx ts-node <this file>
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { CACHE_TTL } from '../src/ai/providers/model-catalog';

const MCP_BETA = 'mcp-client-2025-11-20';
// Same shape the provider sends, TTL included — a probe that asks for a
// different cache than production is not measuring production.
const CACHE = { type: 'ephemeral' as const, ttl: CACHE_TTL };

// Stand-in for the real system prompt; padded past the 1024-token minimum.
const SYSTEM = `You are Gomer, an AI assistant for a workspace. You can take actions across the user's connected apps using the available tools. Prefer acting over describing: when a request maps to a tool, use it.\n\n${'Operational guidance for campaign management, budgets, and reporting. '.repeat(120)}`;

// Stand-in for the local toolset, so `tools` is non-trivial like the real one.
const tools = Array.from({ length: 12 }, (_, i) => ({
  type: 'custom' as const,
  name: `probe_tool_${i}`,
  description: `Probe tool ${i}. ${'Describes a campaign operation in detail. '.repeat(20)}`,
  input_schema: {
    type: 'object' as const,
    properties: {
      account_id: { type: 'string', description: 'Ad account id' },
      since: { type: 'string', description: 'ISO start date' },
      until: { type: 'string', description: 'ISO end date' },
    },
    required: ['account_id'],
  },
}));

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey });
  const model = process.env.AI_MODEL ?? 'claude-sonnet-5';
  console.log(`model: ${model}\n`);

  for (const label of ['call 1 (cold)', 'call 2 (should read cache)']) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 64,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM, cache_control: CACHE }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with OK.' }] }],
      tools,
      betas: [MCP_BETA],
    });
    const u = response.usage;
    // The per-TTL split confirms the breakpoint was actually stored at the TTL
    // we asked for: a write landing in the 5m bucket means the ttl never took,
    // and credits would then be charged at 2x for a cache that dies in minutes.
    const oneHour = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const fiveMin = u.cache_creation?.ephemeral_5m_input_tokens ?? 0;
    console.log(
      `${label.padEnd(28)} uncached=${u.input_tokens}  ` +
        `write=${u.cache_creation_input_tokens ?? 0} (1h=${oneHour} 5m=${fiveMin})  ` +
        `read=${u.cache_read_input_tokens ?? 0}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
