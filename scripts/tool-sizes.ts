/**
 * Token-count each local tool group, so it is obvious which ones are worth
 * trimming. Uses Anthropic's own count_tokens endpoint — never an estimator,
 * which is wrong for Claude by a wide margin.
 *
 *   npm run tool:sizes
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { ToolSpec } from '../src/ai/providers/provider.interface';
import { META_ADS_TOOLS } from '../src/ai/meta-ads-tools';
import { RULE_TOOLS } from '../src/ai/rule-tools';
import { ROAS_TOOLS } from '../src/ai/roas-tools';
import { MEMORY_TOOLS } from '../src/ai/memory-tools';
import { SPACE_TOOLS } from '../src/ai/space-tools';
import { WORKSPACE_TOOLS } from '../src/ai/workspace-tools';

const GROUPS: Array<[string, ToolSpec[]]> = [
  ['meta_ads', META_ADS_TOOLS],
  ['rules', RULE_TOOLS],
  ['roas', ROAS_TOOLS],
  ['memory', MEMORY_TOOLS],
  ['spaces', SPACE_TOOLS],
  ['workspace', WORKSPACE_TOOLS],
];

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey });
  const model = process.env.AI_MODEL ?? 'claude-sonnet-5';

  const count = async (tools: ToolSpec[]): Promise<number> => {
    const response = await client.messages.countTokens({
      model,
      messages: [{ role: 'user', content: 'x' }],
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters as Anthropic.Tool['input_schema'],
      })),
    });
    return response.input_tokens;
  };

  // Everything the count shares regardless of tools, so per-group numbers are
  // the tools alone rather than tools plus a fixed envelope.
  const floor = await count([]);
  let total = 0;

  console.log(`model: ${model}\n`);
  for (const [name, tools] of GROUPS) {
    const tokens = (await count(tools)) - floor;
    total += tokens;
    console.log(
      `  ${name.padEnd(12)} ${String(tools.length).padStart(3)} tools  ` +
        `${String(tokens).padStart(6)} tokens  ` +
        `${String(Math.round(tokens / tools.length)).padStart(5)} each`,
    );
  }
  console.log(`\n  ${'TOTAL'.padEnd(12)} ${String(total).padStart(21)} tokens`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
