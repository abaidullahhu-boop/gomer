/**
 * Show what the app router decides, for a batch of prompts, without running a
 * full agent turn. The router only reasons over app slugs, so the servers here
 * are stubs built from the workspace's real connections — no Pipedream token
 * and no MCP round-trip needed.
 *
 *   npm run probe:route                        # built-in prompt set
 *   npm run probe:route -- "your own prompt"   # just this one
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AnthropicProvider } from '../src/ai/providers/anthropic.provider';
import { ToolRouterService } from '../src/ai/providers/tool-router.service';
import { RemoteMcpServer, ToolSpec } from '../src/ai/providers/provider.interface';
import { Integration } from '../src/database/entities/integration.entity';
import { META_ADS_TOOLS } from '../src/ai/meta-ads-tools';
import { RULE_TOOLS } from '../src/ai/rule-tools';
import { ROAS_TOOLS } from '../src/ai/roas-tools';
import { MEMORY_TOOLS } from '../src/ai/memory-tools';
import { SPACE_TOOLS } from '../src/ai/space-tools';
import { WORKSPACE_TOOLS } from '../src/ai/workspace-tools';

/** The toolset a Meta-connected workspace runs with, as ai.service assembles it. */
const LOCAL_TOOLS: ToolSpec[] = [
  ...SPACE_TOOLS,
  ...WORKSPACE_TOOLS,
  ...MEMORY_TOOLS,
  ...META_ADS_TOOLS,
  ...ROAS_TOOLS,
  ...RULE_TOOLS,
];

/** Each should route to the apps named in the comment — or to none at all. */
const PROMPTS = [
  'what were my top campaigns by spend last week?', // none — Meta is local
  'pause my worst performing campaign', // none
  "what's our real ROAS?", // none
  'hello', // none
  'what can you do?', // none
  "export last week's campaign report to a spreadsheet", // sheets
  'post a summary of yesterday’s ad spend to #marketing', // slack
];

async function main(): Promise<void> {
  const custom = process.argv.slice(2);
  const context = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  try {
    const integrations = await context
      .get(DataSource, { strict: false })
      .getRepository(Integration)
      .find({ where: { provider: 'pipedream', isActive: true } });

    const slugs = [...new Set(integrations.map((row) => row.appSlug))].sort();
    if (slugs.length < 2) {
      console.log(`Only ${slugs.length} connected app(s) — the router always no-ops below 2.`);
      return;
    }
    const servers: RemoteMcpServer[] = slugs.map((slug) => ({
      appSlug: slug,
      name: slug,
      url: `https://mcp.pipedream.net/${slug}`,
    }));

    const router = context.get(ToolRouterService, { strict: false });
    const provider = context.get(AnthropicProvider, { strict: false });
    const model = process.env.AI_MODEL ?? 'claude-sonnet-5';

    console.log(`model: ${model}`);
    console.log(`connected apps (${slugs.length}): ${slugs.join(', ')}\n`);

    for (const prompt of custom.length ? custom : PROMPTS) {
      const selected = await router.selectRelevantServers(
        provider,
        model,
        prompt,
        servers,
        LOCAL_TOOLS,
      );
      const verdict =
        selected === null
          ? 'ALL (fell back)'
          : selected.length === 0
            ? 'none'
            : selected.map((server) => server.appSlug).join(', ');
      console.log(`  ${verdict.padEnd(28)} ← ${prompt}`);
    }
  } finally {
    await context.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
