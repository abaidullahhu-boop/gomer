import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config/configuration';
import { CreditEventType } from '../common/enums';
import { IntegrationsService } from '../integrations/integrations.service';
import { MetaAdsService } from '../integrations/meta-ads.service';
import { ConversationTurn } from '../memory/messages.service';
import { WorkspaceMemoryService } from '../memory/workspace-memory.service';
import { PipedreamService } from '../integrations/pipedream.service';
import { SpacesService } from '../spaces/spaces.service';
import { UsageService } from '../usage/usage.service';
import { UsersService } from '../users/users.service';
import {
  META_ADS_CREATE_AD,
  META_ADS_CREATE_AD_CREATIVE,
  META_ADS_CREATE_AD_SET,
  META_ADS_CREATE_CAMPAIGN,
  META_ADS_DELETE_AD,
  META_ADS_DELETE_AD_SET,
  META_ADS_DELETE_CAMPAIGN,
  META_ADS_GET_INSIGHTS,
  META_ADS_LIST_AD_ACCOUNTS,
  META_ADS_LIST_AD_SETS,
  META_ADS_LIST_ADS,
  META_ADS_LIST_CAMPAIGNS,
  META_ADS_LIST_PAGES,
  META_ADS_SEARCH_INTERESTS,
  META_ADS_TOOL_NAMES,
  META_ADS_TOOLS,
  META_ADS_UPDATE_AD,
  META_ADS_UPDATE_AD_SET,
  META_ADS_UPDATE_CAMPAIGN,
  META_ADS_WRITE_TOOL_NAMES,
} from './meta-ads-tools';
import {
  MEMORY_FORGET_FACT,
  MEMORY_REMEMBER_FACT,
  MEMORY_TOOL_NAMES,
  MEMORY_TOOLS,
} from './memory-tools';
import { SPACE_TOOLS } from './space-tools';
import { GET_WORKSPACE_STATS, WORKSPACE_TOOLS } from './workspace-tools';

/** Beta flag enabling the remote MCP connector on the Messages API. */
const MCP_BETA = 'mcp-client-2025-11-20';

/**
 * Local (custom) tools AiService executes itself: building/updating Spaces and
 * reading workspace facts. Sent on every run alongside any connected-app MCP
 * toolsets, and kept as the sole tools when the MCP connector is dropped.
 */
const LOCAL_TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  ...SPACE_TOOLS,
  ...WORKSPACE_TOOLS,
  ...MEMORY_TOOLS,
];

const SYSTEM_PROMPT = `You are Gomer, an AI assistant for a workspace. You can take actions across the user's connected apps using the available tools. Prefer acting over describing: when a request maps to a tool, use it. When you lack a connected app needed for a request, say so plainly and name the app to connect. Before any action that creates, edits, deletes, or starts spending on a connected app — especially Meta Ads campaigns (creating, activating, changing budgets, or deleting) — state exactly what you will do and get the user's explicit confirmation first; never perform such actions speculatively.

You can also build "Spaces" — full web apps with their own database, passwordless (magic-link) login, and hosting — using the create_space tool. Spaces suit CRUD/form/dashboard internal tools (e.g. a time logger, lead tracker, or content calendar). Describe the app as entities (data types with typed fields) and views (forms, tables, dashboards). Never invent or share end-user passwords; logins are always magic links. After building a Space, give the user its link.

You can also answer questions about this workspace itself — how many members it has and which apps members have connected — with the get_workspace_stats tool. Use it instead of guessing or saying you have no way to know.

You have a durable workspace memory that persists across every conversation. When the user states a lasting fact, preference, target, or standing instruction (e.g. "our target ROAS is 3", "always report in EUR"), save it with remember_fact — silently, without announcing it. Saved facts appear in your context under "Workspace memory"; treat them as current truth. Update a fact by re-saving its key; delete a retracted one with forget_fact. Never save transient, one-off request details.

When the user asks what you can do — overall or about a specific connected app — give a structured, scannable answer rather than a one-liner: confirm which relevant app(s) are connected, name the specific account when a quick read-only tool call can tell you (e.g. list Meta ad accounts to name the account and currency), group the concrete capabilities into a few labelled sections, and finish with 2–3 example prompts the user could send. This capability-overview case is the one exception to the brevity rule below.

Your replies are delivered in Slack, so format for Slack's mrkdwn — not Markdown: use *single asterisks* for bold (never **double**, which Slack shows literally), _underscores_ for italics, and a leading "• " for bullets. Don't use # headings or [text](url) links; write links as <https://example.com|label>.

Be brief and lead with the answer. Put the direct response in the first sentence, then add only the detail the request actually needs. Prefer a few short sentences; use a short bulleted list only when giving steps or options. Don't restate the question, stack on caveats, or list the tools you have unless asked.`;

/** A tool the model invoked during a run, for surfacing what Gomer did. */
export interface AiAction {
  app: string;
  tool: string;
  isError: boolean;
}

/** A Space created during a run, surfaced so the chat can link to it. */
export interface AiSpace {
  slug: string;
  name: string;
  url: string;
}

/**
 * A write action the model wants to take that is gated behind explicit user
 * approval. In interactive (Slack button) mode the run stops when one is
 * proposed, returns it here, and the surface renders Approve/Cancel buttons —
 * the action is executed later via {@link AiService.executeMetaAdsAction}.
 */
export interface AiPendingAction {
  app: string;
  tool: string;
  /** Human label for the action, e.g. "Update campaign". */
  label: string;
  input: Record<string, unknown>;
}

export interface AiRunResult {
  answer: string;
  /** App slugs whose tools were made available for this run. */
  connectedApps: string[];
  actions: AiAction[];
  /** Spaces Gomer built during this run. */
  spaces: AiSpace[];
  /** A write awaiting the user's button approval, when in interactive mode. */
  pendingAction: AiPendingAction | null;
}

/** How a run gates write actions: soft `confirmed` flag vs. out-of-band buttons. */
export type ConfirmMode = 'inline' | 'buttons';

/** Readable labels for the gated Meta Ads write tools, shown on the approval card. */
const META_WRITE_LABELS: Record<string, string> = {
  [META_ADS_CREATE_CAMPAIGN]: 'Create campaign',
  [META_ADS_UPDATE_CAMPAIGN]: 'Update campaign',
  [META_ADS_DELETE_CAMPAIGN]: 'Delete campaign',
  [META_ADS_CREATE_AD_SET]: 'Create ad set',
  [META_ADS_UPDATE_AD_SET]: 'Update ad set',
  [META_ADS_DELETE_AD_SET]: 'Delete ad set',
  [META_ADS_CREATE_AD_CREATIVE]: 'Create ad creative',
  [META_ADS_CREATE_AD]: 'Create ad',
  [META_ADS_UPDATE_AD]: 'Update ad',
  [META_ADS_DELETE_AD]: 'Delete ad',
};

/**
 * Orchestrates Gomer's model calls. Connected integrations are exposed to
 * Claude as Pipedream remote-MCP servers (one per app), so the model can act on
 * a workspace's apps directly. The client is built lazily so the app boots
 * without an Anthropic key.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private client: Anthropic | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly integrationsService: IntegrationsService,
    private readonly pipedream: PipedreamService,
    private readonly metaAds: MetaAdsService,
    private readonly spacesService: SpacesService,
    private readonly usageService: UsageService,
    private readonly usersService: UsersService,
    private readonly workspaceMemory: WorkspaceMemoryService,
  ) {}

  getStatus(): { module: string; ready: boolean; provider: string } {
    const ai = this.configService.get('ai', { infer: true });
    return { module: 'ai', ready: Boolean(ai.anthropicApiKey), provider: 'anthropic' };
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const ai = this.configService.get('ai', { infer: true });
      if (!ai.anthropicApiKey) {
        throw new ServiceUnavailableException('AI is not configured (set ANTHROPIC_API_KEY)');
      }
      this.client = new Anthropic({ apiKey: ai.anthropicApiKey });
    }
    return this.client;
  }

  /**
   * Run a single prompt for a workspace, exposing its connected apps as tools,
   * and return Gomer's answer plus the actions it took.
   *
   * `options.model` overrides the workspace default (used by scheduled tasks
   * that pin a model); `options.taskId`/`options.sourceName` attribute the
   * metered usage to the originating scheduled task.
   */
  async run(
    workspaceId: string,
    userId: string | null,
    prompt: string,
    options: {
      model?: string | null;
      taskId?: string | null;
      sourceName?: string;
      /** Lazily resolves the workspace's total member count (e.g. Slack roster),
       * used by the workspace-stats tool. Optional — omitted off-Slack. */
      fetchMemberCount?: () => Promise<number | null>;
      /** How Meta Ads writes are confirmed: 'buttons' defers them to an
       * out-of-band approval (Slack), 'inline' (default) uses the soft flag. */
      confirmVia?: ConfirmMode;
      /** Prior turns of this conversation (oldest first), replayed ahead of the
       * prompt so the model has thread continuity. Omitted for fresh runs. */
      history?: ConversationTurn[];
    } = {},
  ): Promise<AiRunResult> {
    const confirmVia: ConfirmMode = options.confirmVia ?? 'inline';
    const ai = this.configService.get('ai', { infer: true });
    const model = options.model ?? ai.model;
    const client = this.getClient();

    // Only the accounts this member may use become tools: every team account
    // plus their own private ones. Pipedream apps live under a per-scope external
    // user (a private account is unreachable from another member's run); Meta
    // connections are their own OAuth grants, resolved separately below.
    const connected = (
      await this.integrationsService.findVisibleForUser(workspaceId, userId ?? '')
    ).filter((c) => c.isActive);
    const pipedreamConnected = connected.filter((c) => c.provider === 'pipedream');
    const teamSlugs = [
      ...new Set(pipedreamConnected.filter((c) => c.accessLevel === 'team').map((c) => c.appSlug)),
    ];
    const privateSlugs = userId
      ? [
          ...new Set(
            pipedreamConnected.filter((c) => c.accessLevel === 'private').map((c) => c.appSlug),
          ),
        ]
      : [];

    const pipedreamServers = [
      ...(teamSlugs.length ? this.pipedream.buildMcpServers(workspaceId, teamSlugs) : []),
      ...(privateSlugs.length && userId
        ? this.pipedream.buildMcpServers(
            PipedreamService.privateExternalUserId(userId),
            privateSlugs,
          )
        : []),
    ];
    // Pipedream shares one access token across its servers.
    const pipedreamToken = pipedreamServers.length ? await this.pipedream.getAccessToken() : null;
    const servers = pipedreamServers.map((server) => ({
      appSlug: server.appSlug,
      name: server.name,
      url: server.url,
      authorizationToken: pipedreamToken ?? undefined,
    }));

    // Meta Ads is NOT exposed as an MCP server: Meta's hosted Ads MCP is
    // allowlist-gated and rejects our token, which would 400 the whole request
    // (taking the Pipedream connectors down with it). Instead we serve Meta as
    // native local tools that call the Marketing API with the stored token.
    const hasMeta = connected.some((c) => c.provider === 'meta');
    const localTools: Anthropic.Beta.BetaToolUnion[] = [
      ...LOCAL_TOOLS,
      ...(hasMeta ? META_ADS_TOOLS : []),
    ];

    let appSlugs = [
      ...new Set([...servers.map((server) => server.appSlug), ...(hasMeta ? ['meta_ads'] : [])]),
    ];

    // Name the connected apps in the system prompt so the model can accurately
    // confirm what's usable right now (e.g. for a "what can you do?" answer)
    // instead of guessing. Meta stores no appName, so label it explicitly.
    const connectedAppNames = [
      ...new Set([
        ...connected.filter((c) => c.provider === 'pipedream').map((c) => c.appName ?? c.appSlug),
        ...(hasMeta ? ['Meta Ads'] : []),
      ]),
    ].filter(Boolean);
    let system = connectedAppNames.length
      ? `${SYSTEM_PROMPT}\n\nApps connected and usable right now: ${connectedAppNames.join(', ')}.`
      : SYSTEM_PROMPT;
    // Durable workspace facts ride along on every run so the model has standing
    // context (targets, preferences) without a tool call. Best-effort: null on
    // a read failure or an empty memory.
    const memoryBlock = await this.workspaceMemory.buildPromptBlock(workspaceId);
    if (memoryBlock) system += `\n\n${memoryBlock}`;
    // In button mode the platform gates Meta Ads writes with an out-of-band
    // approval, so the model must actually CALL the write tool (not ask in
    // prose) — calling it does not execute it; it triggers the approval buttons.
    if (confirmVia === 'buttons' && hasMeta) {
      system +=
        '\n\nFor Meta Ads write actions (create/update/delete a campaign, ad set, creative, or ' +
        'ad; changing budgets or status), do NOT ask for confirmation in your text. Instead call ' +
        'the appropriate tool directly with your best parameters. Calling it does not execute ' +
        'anything — the platform automatically pauses and shows the user Approve/Cancel buttons, ' +
        'and only runs the action if they approve. First gather any ids you need with read tools, ' +
        'then call the one write tool and, in one short line, state exactly what you are about to do.';
    }

    // Connected apps become server-side MCP toolsets; local tools (Spaces,
    // workspace stats, Meta Ads) we execute ourselves and feed results back.
    // Both are `let` because a dead MCP server makes Anthropic reject the whole
    // request, so we drop the connector and retry with only the local tools.
    let mcpServers = servers.map((server) => ({
      type: 'url' as const,
      url: server.url,
      name: server.name,
      authorization_token: server.authorizationToken,
    }));
    let tools: Anthropic.Beta.BetaToolUnion[] = [
      ...servers.map((server) => ({
        type: 'mcp_toolset' as const,
        mcp_server_name: server.name,
      })),
      ...localTools,
    ];
    // Whether connected apps were available for this run; on an MCP failure the
    // Pipedream toolsets drop but the Meta local tools survive.
    let appsAvailable = servers.length > 0 || hasMeta;

    // Prior turns (thread history) replay ahead of the new prompt, giving the
    // model conversation continuity; only final text turns are stored/replayed,
    // never tool_use blocks, so there are no dangling tool-result pairs.
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...(options.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
      { role: 'user' as const, content: prompt },
    ];
    const actions: AiAction[] = [];
    const spaces: AiSpace[] = [];
    // In button mode, the first Meta write the model proposes is captured here
    // (rather than executed) so the surface can request approval out of band.
    const pending: { current: AiPendingAction | null } = { current: null };
    let answer = '';
    let tokensUsed = 0;

    // Two reasons to loop: the MCP connector returns `pause_turn` when it hits
    // its per-turn iteration cap, and a local Spaces tool call returns
    // `tool_use` — in both cases we re-send the accumulated conversation.
    for (let i = 0; i < 6; i += 1) {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await this.create(client, model, system, messages, mcpServers, tools);
      } catch (error) {
        // A single unreachable Pipedream MCP server makes Anthropic 400 the whole
        // request, which would otherwise fail even prompts that need no app. Drop
        // the connector once and retry so the model can still answer locally.
        if (!mcpServers.length || !this.isMcpConnectionError(error)) throw error;
        this.logger.warn(
          'A connected-app MCP server was unreachable; retrying without connected apps',
        );
        mcpServers = [];
        tools = [...localTools];
        appSlugs = hasMeta ? ['meta_ads'] : [];
        appsAvailable = hasMeta;
        response = await this.create(client, model, system, messages, mcpServers, tools);
      }
      tokensUsed += response.usage.input_tokens + response.usage.output_tokens;

      const toolUses: Anthropic.Beta.BetaToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'text') {
          answer += block.text;
        } else if (block.type === 'mcp_tool_use') {
          actions.push({ app: block.server_name, tool: block.name, isError: false });
        } else if (block.type === 'mcp_tool_result') {
          const last = actions[actions.length - 1];
          if (last) last.isError = block.is_error ?? false;
        } else if (block.type === 'tool_use') {
          toolUses.push(block);
        }
      }

      if (response.stop_reason === 'tool_use' && toolUses.length) {
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const toolUse of toolUses) {
          const result = await this.runLocalTool(
            workspaceId,
            userId,
            toolUse,
            spaces,
            { confirmVia, pending },
            options.fetchMemberCount,
          );
          // Local tools run on our side, so (unlike MCP tools) they produce no
          // mcp_tool_use block — record the action here for the run's audit.
          actions.push({
            app: this.localToolApp(toolUse.name),
            tool: toolUse.name,
            isError: result.is_error ?? false,
          });
          results.push(result);
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }

      break;
    }

    await this.recordUsage(workspaceId, userId, model, tokensUsed, {
      taskId: options.taskId ?? null,
      sourceName: options.sourceName,
    });

    return {
      answer: answer.trim(),
      connectedApps: appsAvailable ? appSlugs : [],
      actions,
      spaces,
      pendingAction: pending.current,
    };
  }

  /**
   * Route a local (custom) tool call to its executor. These run on our side —
   * unlike the connected-app MCP tools, which Anthropic executes server-side —
   * and their results are fed back into the conversation.
   */
  /** The app label a local tool's action is attributed to in the run audit. */
  private localToolApp(toolName: string): string {
    if (META_ADS_TOOL_NAMES.has(toolName)) return 'meta_ads';
    if (toolName === GET_WORKSPACE_STATS) return 'workspace';
    if (MEMORY_TOOL_NAMES.has(toolName)) return 'memory';
    return 'spaces';
  }

  private runLocalTool(
    workspaceId: string,
    userId: string | null,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    spaces: AiSpace[],
    ctx: { confirmVia: ConfirmMode; pending: { current: AiPendingAction | null } },
    fetchMemberCount?: () => Promise<number | null>,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    if (toolUse.name === GET_WORKSPACE_STATS) {
      return this.runWorkspaceStatsTool(workspaceId, toolUse, fetchMemberCount);
    }
    if (META_ADS_TOOL_NAMES.has(toolUse.name)) {
      return this.runMetaAdsTool(workspaceId, userId, toolUse, ctx);
    }
    if (MEMORY_TOOL_NAMES.has(toolUse.name)) {
      return this.runMemoryTool(workspaceId, userId, toolUse);
    }
    return this.runSpaceTool(workspaceId, userId, toolUse, spaces);
  }

  /**
   * Execute a workspace-memory tool (remember/recall/forget a durable fact).
   * A validation or DB error becomes an error result the model can relay,
   * never a failed request.
   */
  private async runMemoryTool(
    workspaceId: string,
    userId: string | null,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    const input = (toolUse.input ?? {}) as Record<string, unknown>;
    try {
      if (toolUse.name === MEMORY_REMEMBER_FACT) {
        const fact = await this.workspaceMemory.remember(
          workspaceId,
          userId,
          String(input.key ?? ''),
          String(input.value ?? ''),
        );
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Remembered "${fact.key}".`,
        };
      }
      if (toolUse.name === MEMORY_FORGET_FACT) {
        const key = String(input.key ?? '');
        const existed = await this.workspaceMemory.forget(workspaceId, key);
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: existed ? `Forgot "${key}".` : `No fact named "${key}" was saved.`,
        };
      }
      // Remaining memory tool: recall_facts — the full unabridged list.
      const facts = await this.workspaceMemory.list(workspaceId);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(
          facts.map((fact) => ({
            key: fact.key,
            value: fact.value,
            updatedAt: fact.updatedAt.toISOString(),
          })),
        ),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Memory tool ${toolUse.name} failed: ${message}`);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Memory operation failed: ${message}`,
        is_error: true,
      };
    }
  }

  /**
   * Execute a Meta Ads tool against the Marketing API using the member's stored
   * Meta token. A missing connection or an API error becomes an error result the
   * model can relay, never a failed request.
   */
  private async runMetaAdsTool(
    workspaceId: string,
    userId: string | null,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    ctx: { confirmVia: ConfirmMode; pending: { current: AiPendingAction | null } },
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    const input = (toolUse.input ?? {}) as Record<string, unknown>;
    const isWrite = META_ADS_WRITE_TOOL_NAMES.has(toolUse.name);

    // In button mode, a write never runs inline: capture it (once) so the
    // surface can render Approve/Cancel buttons, then tell the model to describe
    // the action and stop. The real execution happens on approval, out of band.
    if (isWrite && ctx.confirmVia === 'buttons') {
      if (!ctx.pending.current) {
        ctx.pending.current = {
          app: 'meta_ads',
          tool: toolUse.name,
          label: META_WRITE_LABELS[toolUse.name] ?? toolUse.name,
          input,
        };
      }
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content:
          'Not executed yet — this change needs the user’s approval, which will be requested ' +
          'via Approve/Cancel buttons shown under your reply. In your reply, state exactly what ' +
          'you will do (account, campaign/ad set, budget, status) in one short paragraph, then ' +
          'stop. Do not call this tool again and do not claim it is done.',
      };
    }

    try {
      const token = await this.integrationsService.getMetaAccessToken(workspaceId, userId ?? '');
      if (!token) {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: 'No active Meta Ads connection is available for this workspace.',
          is_error: true,
        };
      }

      // Inline mode: write tools only run once the model sets `confirmed` after
      // the user has approved. Refuse otherwise — a non-error result so the model
      // asks the user and retries.
      if (isWrite && input.confirmed !== true) {
        return {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content:
            'Not executed: this changes a live ad account. Describe the exact action to the user, ' +
            'get their explicit confirmation, then call again with confirmed=true.',
        };
      }

      const result = await this.dispatchMetaAdsTool(token, toolUse.name, input);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Meta Ads tool ${toolUse.name} failed: ${message}`);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Meta Ads request failed: ${message}`,
        is_error: true,
      };
    }
  }

  /**
   * Execute a previously-proposed Meta Ads write after the user approved it via
   * buttons. Returns a short human summary (success or failure) for the surface
   * to post — the approval itself is the confirmation, so no `confirmed` flag.
   */
  async executeMetaAdsAction(
    workspaceId: string,
    userId: string | null,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<{ ok: boolean; summary: string }> {
    try {
      const token = await this.integrationsService.getMetaAccessToken(workspaceId, userId ?? '');
      if (!token) {
        return { ok: false, summary: 'No active Meta Ads connection is available.' };
      }
      const result = await this.dispatchMetaAdsTool(token, toolName, input);
      return { ok: true, summary: this.summarizeMetaWrite(toolName, result) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Meta Ads action ${toolName} failed: ${message}`);
      return { ok: false, summary: `Meta Ads request failed: ${message}` };
    }
  }

  /** A short, human confirmation line for a completed Meta Ads write. */
  private summarizeMetaWrite(toolName: string, result: unknown): string {
    const label = META_WRITE_LABELS[toolName] ?? toolName;
    const id =
      result && typeof result === 'object' && 'id' in result
        ? String((result as { id: unknown }).id)
        : null;
    if (toolName.includes('create') && id)
      return `Done — ${label.toLowerCase()} (id ${id}), paused.`;
    return `Done — ${label.toLowerCase()} completed.`;
  }

  /**
   * Dispatch a Meta Ads tool to its Marketing-API call. Pure execution — the
   * confirm/approval gating lives in the callers ({@link runMetaAdsTool} and
   * {@link executeMetaAdsAction}). Returns the raw API result; throws on failure.
   */
  private async dispatchMetaAdsTool(
    token: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    let result: unknown;
    {
      const toolUse = { name: toolName } as { name: string };
      if (toolUse.name === META_ADS_LIST_AD_ACCOUNTS) {
        result = await this.metaAds.listAdAccounts(token);
      } else if (toolUse.name === META_ADS_GET_INSIGHTS) {
        result = await this.metaAds.getInsights(token, {
          adAccountId: String(input.ad_account_id),
          level: input.level as 'account' | 'campaign' | 'adset' | 'ad' | undefined,
          datePreset: input.date_preset as string | undefined,
          since: input.since as string | undefined,
          until: input.until as string | undefined,
          fields: input.fields as string[] | undefined,
        });
      } else if (toolUse.name === META_ADS_LIST_CAMPAIGNS) {
        result = await this.metaAds.listCampaigns(token, {
          adAccountId: String(input.ad_account_id),
          effectiveStatus: input.effective_status as string[] | undefined,
        });
      } else if (toolUse.name === META_ADS_CREATE_CAMPAIGN) {
        result = await this.metaAds.createCampaign(token, {
          adAccountId: String(input.ad_account_id),
          name: String(input.name),
          objective: String(input.objective),
          dailyBudget: input.daily_budget as number | undefined,
        });
      } else if (toolUse.name === META_ADS_UPDATE_CAMPAIGN) {
        result = await this.metaAds.updateCampaign(token, {
          campaignId: String(input.campaign_id),
          name: input.name as string | undefined,
          status: input.status as 'ACTIVE' | 'PAUSED' | undefined,
          dailyBudget: input.daily_budget as number | undefined,
        });
      } else if (toolUse.name === META_ADS_DELETE_CAMPAIGN) {
        result = await this.metaAds.deleteCampaign(token, String(input.campaign_id));
      } else if (toolUse.name === META_ADS_LIST_AD_SETS) {
        result = await this.metaAds.listAdSets(token, String(input.campaign_id));
      } else if (toolUse.name === META_ADS_CREATE_AD_SET) {
        result = await this.metaAds.createAdSet(token, {
          adAccountId: String(input.ad_account_id),
          campaignId: String(input.campaign_id),
          name: String(input.name),
          optimizationGoal: String(input.optimization_goal),
          billingEvent: String(input.billing_event),
          targeting: (input.targeting ?? {}) as Record<string, unknown>,
          dailyBudget: input.daily_budget as number | undefined,
          startTime: input.start_time as string | undefined,
        });
      } else if (toolUse.name === META_ADS_UPDATE_AD_SET) {
        result = await this.metaAds.updateAdSet(token, {
          adSetId: String(input.ad_set_id),
          name: input.name as string | undefined,
          status: input.status as 'ACTIVE' | 'PAUSED' | undefined,
          dailyBudget: input.daily_budget as number | undefined,
        });
      } else if (toolUse.name === META_ADS_DELETE_AD_SET) {
        result = await this.metaAds.deleteAdSet(token, String(input.ad_set_id));
      } else if (toolUse.name === META_ADS_LIST_ADS) {
        result = await this.metaAds.listAds(token, String(input.ad_set_id));
      } else if (toolUse.name === META_ADS_CREATE_AD_CREATIVE) {
        result = await this.metaAds.createAdCreative(token, {
          adAccountId: String(input.ad_account_id),
          name: String(input.name),
          pageId: String(input.page_id),
          link: String(input.link),
          message: String(input.message),
          headline: input.headline as string | undefined,
          imageUrl: input.image_url as string | undefined,
          callToAction: input.call_to_action as string | undefined,
        });
      } else if (toolUse.name === META_ADS_CREATE_AD) {
        result = await this.metaAds.createAd(token, {
          adAccountId: String(input.ad_account_id),
          name: String(input.name),
          adSetId: String(input.ad_set_id),
          creativeId: String(input.creative_id),
        });
      } else if (toolUse.name === META_ADS_UPDATE_AD) {
        result = await this.metaAds.updateAd(token, {
          adId: String(input.ad_id),
          name: input.name as string | undefined,
          status: input.status as 'ACTIVE' | 'PAUSED' | undefined,
        });
      } else if (toolUse.name === META_ADS_DELETE_AD) {
        result = await this.metaAds.deleteAd(token, String(input.ad_id));
      } else if (toolUse.name === META_ADS_LIST_PAGES) {
        result = await this.metaAds.listPages(token);
      } else if (toolUse.name === META_ADS_SEARCH_INTERESTS) {
        result = await this.metaAds.searchInterests(token, String(input.query));
      } else {
        throw new Error(`Unknown Meta Ads tool: ${toolUse.name}`);
      }
    }
    return result;
  }

  /**
   * Produce a full workspace report — total members, sign-up adoption, and every
   * connected account with who connected it — from our own data (plus the Slack
   * roster when available). Read-only and best-effort: a query failure becomes an
   * error result the model can relay, never a failed request.
   */
  private async runWorkspaceStatsTool(
    workspaceId: string,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    fetchMemberCount?: () => Promise<number | null>,
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    try {
      const [signedUpMembers, integrations, totalMembers] = await Promise.all([
        this.usersService.countByWorkspace(workspaceId),
        this.integrationsService.getWorkspaceIntegrations(workspaceId),
        fetchMemberCount ? fetchMemberCount() : Promise.resolve(null),
      ]);

      const connectedPeople = new Set(
        integrations.map((row) => row.userName).filter((name): name is string => Boolean(name)),
      ).size;

      const payload = {
        members: {
          // Total members of the workspace (e.g. the full Slack roster); null if
          // we couldn't read it.
          total: totalMembers,
          // People who have a Gomer account (have interacted with / installed it).
          signedUp: signedUpMembers,
          notSignedUp: totalMembers != null ? Math.max(totalMembers - signedUpMembers, 0) : null,
        },
        connections: {
          accountCount: integrations.length,
          peopleConnected: connectedPeople,
          accounts: integrations.map((row) => ({
            person: row.userName,
            app: row.appName,
            label: row.label,
            scope: row.accessLevel,
            active: row.isActive,
          })),
        },
      };
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(payload),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Workspace stats tool failed: ${message}`);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Failed to read workspace stats: ${message}`,
        is_error: true,
      };
    }
  }

  /**
   * Execute a local Spaces tool call and return its tool_result. Creating a
   * Space validates the AI's spec before persisting; a bad spec becomes an error
   * result the model can read and correct, never a failed request.
   */
  private async runSpaceTool(
    workspaceId: string,
    userId: string | null,
    toolUse: Anthropic.Beta.BetaToolUseBlock,
    spaces: AiSpace[],
  ): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
    const input = (toolUse.input ?? {}) as Record<string, unknown>;
    try {
      let slug: string;
      let name: string;
      if (toolUse.name === 'update_space') {
        const { slug: target, ...spec } = input;
        const space = await this.spacesService.updateSpec(workspaceId, String(target), spec);
        slug = space.slug;
        name = space.name;
      } else {
        const space = await this.spacesService.createFromSpec(workspaceId, userId, input);
        slug = space.slug;
        name = space.name;
      }
      const url = this.spacesService.spaceUrl(slug);
      spaces.push({ slug, name, url });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Space "${name}" is live at ${url}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Space tool ${toolUse.name} failed: ${message}`);
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Failed to build the Space: ${message}`,
        is_error: true,
      };
    }
  }

  /**
   * Meter a completed run. Token spend is best-effort accounting — a failure to
   * persist it must never fail the user's request, so we swallow and log.
   */
  private async recordUsage(
    workspaceId: string,
    userId: string | null,
    model: string,
    tokensUsed: number,
    options: { taskId?: string | null; sourceName?: string } = {},
  ): Promise<void> {
    if (tokensUsed <= 0) return;
    try {
      await this.usageService.recordEvent({
        workspaceId,
        userId,
        taskId: options.taskId ?? null,
        type: options.taskId ? CreditEventType.SCHEDULED_TASK : CreditEventType.THREAD,
        model,
        tokensUsed,
        sourceName: options.sourceName ?? 'ai.run',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to record AI usage: ${message}`);
    }
  }

  /**
   * Whether a failed model call was Anthropic rejecting the request because it
   * couldn't reach a remote MCP server (the Pipedream connector being down or
   * unresponsive), as opposed to a genuine bad request. Such failures are worth
   * retrying without the connector; others are not.
   */
  private isMcpConnectionError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('MCP server');
  }

  private async create(
    client: Anthropic,
    model: string,
    system: string,
    messages: Anthropic.Beta.BetaMessageParam[],
    mcpServers: Array<{ type: 'url'; url: string; name: string; authorization_token?: string }>,
    tools: Anthropic.Beta.BetaToolUnion[],
  ): Promise<Anthropic.Beta.BetaMessage> {
    try {
      return await client.beta.messages.create({
        model,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        system,
        messages,
        ...(tools.length ? { tools } : {}),
        ...(mcpServers.length ? { mcp_servers: mcpServers } : {}),
        betas: [MCP_BETA],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Anthropic request failed: ${message}`);
      throw new ServiceUnavailableException(`AI request failed: ${message}`);
    }
  }
}
