# Handoff — multi-model support (Gomer)

Written 2026-07-22. Picks up a session that ran out of context.
Plan file: `/home/abaid/.claude/plans/bubbly-strolling-robin.md`

---

## Why this work exists

The workspace's Anthropic key is **out of credits**, so every AI run fails. Gomer was
hard-wired to one key and one model (`AI_MODEL` env var) with no way to switch without
a redeploy. The goal: a workspace admin picks a model in Settings → it persists, drives
interactive and scheduled runs, is billed at its own rate, and keeps working with
connected Pipedream apps regardless of which provider serves it.

Three gaps had to close: the settings UI was a mock (state never left `useState`), the
backend never read `workspace.defaultModel`, and the runtime was Anthropic-shaped end
to end (server-side MCP connector, `input_schema` tools, Anthropic block types).

## What is built

**Everything in the plan is implemented.** All code is uncommitted on `main` in both
repos. Nothing has been committed or pushed.

### Backend — `/home/abaid/gomer.ai`

New `src/ai/providers/`:

| File | Role |
|---|---|
| `provider.interface.ts` | Neutral contract: `ProviderMessage`, `ToolSpec`, `ToolCall`, `ToolResult`, `ProviderRequest`, `ProviderStopReason`, `McpConnectionError`, `LlmProvider` |
| `model-catalog.ts` | Single source of truth: 7 Anthropic models + gateway models parsed from config JSON; `CREDIT_MARGIN = 5`; `creditRates()`; `buildCatalog()` |
| `anthropic.provider.ts` | The original `create()` body verbatim — MCP beta `mcp-client-2025-11-20`, `thinking:{type:'adaptive'}`, `max_tokens: 8000` |
| `gateway.provider.ts` | OpenAI-compatible client against `baseURL`/`apiKey` from config |
| `mcp-bridge.service.ts` | Client-side MCP for non-Anthropic providers |

Modified: `ai.service.ts` (heavily — provider resolution, personalization, `listModels()`),
`ai.module.ts`, `ai.controller.ts` (`GET /ai/models`), all six `*-tools.ts` files
(mechanical: `input_schema` → `parameters`, drop `type:'custom'`), `configuration.ts`,
`usage.service.ts`, `credit-event.entity.ts`, `workspaces.{service,controller}.ts`,
`.env.example`.

New: `src/ai/personality.ts`, `src/workspaces/dto/update-workspace-settings.dto.ts`,
`src/database/migrations/1729000000000-CreditEventTokenSplit.ts` (**already run**).

### Frontend — `/home/abaid/gomer.ai-FE`

`lib/api.ts` (`fetchModels`, `updateWorkspaceSettings`, `ApiModel`),
`data/models.ts` (hardcoded array deleted), `settings/ModelCard.tsx`,
`settings/ProviderIcon.tsx`, `settings/PersonalizationSection.tsx`,
`routes/dashboard/settings/general.tsx`, `lib/task-models.ts`, `routes/dashboard/tasks.tsx`.

---

## Key design decisions (don't re-litigate these)

**Two adapters, not one per vendor.** `anthropic` (native) and `gateway` (any
OpenAI-compatible `/v1/chat/completions`). OmniRoute needs *zero* bespoke code — it is
`AI_GATEWAY_BASE_URL`. Same adapter serves OpenRouter, raw OpenAI, anything else.

**Anthropic keeps server-side MCP; the gateway gets the client-side bridge.** The
Anthropic path works today including the unreachable-server retry. Rewriting it onto the
bridge is regression risk for no user-visible gain. Two tool paths is a deliberate cost.

**`ProviderMessage.raw` exists on purpose.** Anthropic rejects edited thinking blocks and
its MCP blocks have no neutral equivalent, so assistant turns replay byte-identical.

**Gateway models are config-declared, not hardcoded.** Inventing model ids → 404s;
inventing prices → mis-billing. `supportsTools` defaults to **false** — Gomer is 100%
tool-driven, so a model that ignores tool calls fails every single request. Never flip it
to `true` on a vendor claim; tool-test first.

**`ai.service.ts` keeps a private `LocalToolResult`** so ~40 existing return sites in the
local tool executors didn't need editing. `runTool()` converts once.

**`src/ai/personality.ts` exists to break a circular import** (workspaces DTO →
ai.service → WorkspacesService). Decorators evaluate at class-definition time and would
have seen `undefined`. Do not move those constants back.

**MCP SDK import path is `@modelcontextprotocol/sdk/client/index.js`** — with the `.js`.
This took several attempts. The package's `typesVersions` maps `*` → `./dist/esm/*` while
its `exports` map has a `require` condition; only the `.js` form satisfies both TS
(node10 resolution) and Node. `dist/cjs/...` → TS2307; bare `.../client/index` typechecks
but `require()` throws MODULE_NOT_FOUND.

**Pricing changed.** Old rates marked Opus up ~5× but Sonnet only ~1.7×. New per-model
rates keep Opus at ~5 blended but **raise Sonnet 5 (~1 → ~3) and Haiku (~0.25 → ~1)**.
Worth telling the user before this ships.

**Migration backfills `inputTokens = tokensUsed`** — the cheaper side, so no past run is
retroactively over-billed.

---

## Verification status

**Done, all clean:** backend `tsc` clean · `npm run build` exit 0 · `npm run lint` exit 0
· FE `tsc` clean · FE build OK · app boots with `AiModule dependencies initialized` and
`Mapped {/workspaces/me, PATCH}` (no circular-dependency error) · migration ran · catalog
credit math verified against `dist/` (opus 2.5/12.5, fable 5/25, sonnet 1.5/7.5, haiku 0.5/2.5).

**NOT verified — state this plainly, do not imply otherwise:**

- **No live model call on the Anthropic path.** That key is still out of credits.
- **The MCP bridge has never connected to a real Pipedream server.**
- Bridge-failure fallback, settings persistence round-trip, and pinned-model-survives-
  default-change are all untested.
- No full Gomer run has completed on a gateway model — only the raw provider call below.

**Verified 2026-07-22 (gateway path only):** the OpenAI SDK, configured exactly as
`GatewayProvider` configures it, made a live call to OmniRoute with a tool array and got
back `finish_reason: tool_calls`, a well-formed `tool_calls` entry, and a real `usage`
object (`prompt_tokens`/`completion_tokens`) — so response parsing and token accounting in
`gateway.provider.ts` work against a real server. Tool *execution* was not exercised.

**Gotcha worth knowing:** OmniRoute streams SSE when `stream` is omitted from a raw curl,
which makes hand-testing with curl look like an empty response. The OpenAI SDK sends
`stream: false` explicitly and gets clean JSON, so `GatewayProvider` is unaffected — but
debug with the SDK, not curl.

---

## Current state of the OmniRoute effort

**OmniRoute is running.** Version is now **v3.8.48** (the earlier `v16.2.10` note is
stale — different build). `http://localhost:20128/v1/models` returns **99 models**. It
accepts requests with **no auth**, so `AI_GATEWAY_API_KEY` just needs any non-empty
placeholder — the OpenAI SDK requires the field to be set.

**Most advertised models are not actually reachable.** The dashboard shows *"No providers
connected yet"*, and that is real: `aug/*`, `tllm/*`, and `ddgw/*` return a **200 with an
empty SSE stream** (`tokens-in=0`, `tokens-out=0`, straight to `[DONE]`). Only two
families answer — `oc/*` (opencode) and `auto/*` (combo). The handoff's original
candidates (`aug/claude-sonnet-4.6`, `aug/gemini-3.1-pro`) are dead until those providers
are connected in the OmniRoute UI.

Catalog by owner:

| Owner | Count | Examples |
|---|---|---|
| `combo` | 36 | `auto/best-coding`, `auto/best-reasoning`, `auto/pro-coding` |
| `theoldllm` | 26 | `tllm/GPT_5_4`, `tllm/gemini_3_pro`, `tllm/CLAUDE_4_6_OPUS` |
| `auggie` | 15 | `aug/claude-sonnet-4.6`, `aug/claude-opus-4.6`, `aug/gemini-3.1-pro`, `aug/gpt-5.5-high` |
| `opencode` | 8 | `oc/deepseek-v4-flash-free`, `oc/minimax-m3-free` |
| `duckduckgo-web` | 6 | `ddgw/gpt-4o-mini`, `ddgw/claude-3-5-haiku-20241022` |
| `veoaifree-web` | 6 | video models — irrelevant to Gomer |
| `chipotle`, `mimocode` | 2 | `pepper/pepper-1`, `mcode/mimo-auto` |

The models advertise `capabilities.tool_calling: true`. **Treat that as a claim, not a
fact** — these are free/scraped backends. See next steps.

### Node version trap (still live)

`nvm alias default` is still **Node 20**, where a stale, broken `omniroute` 3.6.5 sits
(~1.5 GB). A *new* terminal drops to Node 20, where `omniroute` crashes with
`s.util.markAsUncloneable is not a function` (undici 8.8.0 needs Node ≥22.19). Fix:

```bash
nvm alias default 22
nvm exec 20 npm uninstall -g omniroute   # reclaim 1.5 GB
```

---

## Next steps

1. ~~**Tool-test candidate gateway models.**~~ **DONE 2026-07-22.** Sent a real
   `tools:[{type:'function'}]` request to each candidate and checked for a genuine
   `tool_calls` array rather than prose:

   | Model | Result |
   |---|---|
   | `auto/best-coding` | ✅ real `tool_calls` |
   | `auto/best-reasoning` | ✅ real `tool_calls` |
   | `auto/best-fast` | ✅ real `tool_calls` |
   | `oc/deepseek-v4-flash-free` | ✅ real `tool_calls` |
   | `oc/minimax-m3-free` | ❌ no tool call, empty content — **excluded** |
   | `aug/*`, `tllm/*`, `ddgw/*` | ❌ empty stream, provider not connected — **excluded** |

   Note `auto/*` are combo *routers* — the backing model varies per request (one run
   reported `model: big-pickle`). Fine for testing, questionable for production billing.

2. ~~**Populate `/home/abaid/gomer.ai/.env`.**~~ **DONE 2026-07-22.** Lines 54, 55, 68 now
   set to `http://localhost:20128/v1`, `local`, and the four verified models above. API
   restarted; `GET /ai/models` returns **11 models (7 anthropic + 4 gateway), all
   `available: true`**.

   **Gateway prices are set to 0**, because these backends are genuinely free — so runs on
   them bill **0 credits**. That is honest for a local dev gateway but must be revisited
   before anything like this ships.

3. **Run the real end-to-end test** the plan calls for: switch the workspace default to a
   gateway model, then run a prompt requiring a connected Pipedream app. The tool must
   fire **through the bridge**, and `actions[]` must match what the Anthropic path
   produces. *(Deferred to the user in the browser — it mutates live campaign data, so it
   was not run unattended. API on :3000, SPA on :5173.)*

4. **Then commit.** Nothing is committed yet; both repos are dirty on `main`. Branch first.

## Out of scope / known follow-ups

- **Production OmniRoute is blocked on infra.** It stores encrypted provider keys on the
  local filesystem; DO App Platform containers have ephemeral disks, so keys vanish on
  every redeploy. Production needs a Droplet with a persistent volume, or OpenRouter.
- Streaming responses (both providers support SSE; the loop is request/response).
- Per-model rate limits and automatic provider failover.

## Open thread

The user's message "omini route vs anthropic whats the difference and" trailed off
mid-sentence. They were asked what else to compare (cost, reliability, or behaviour in
Gomer) and never answered.

## Untracked but unrelated

`gomer-development-requirements.pdf` at the repo root is not part of this work.
