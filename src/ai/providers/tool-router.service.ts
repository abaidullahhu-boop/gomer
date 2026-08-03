import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, RemoteMcpServer, ToolSpec } from './provider.interface';

/**
 * Below this many bridged tools, routing is skipped: the prompt savings do not
 * justify an extra provider round-trip, and sending them all is cheap enough.
 */
const ROUTE_THRESHOLD = 20;

/**
 * Below this many connected servers there is nothing to route: with one server
 * the choice is send-it-or-fail, and the round-trip costs more than it saves.
 */
const SERVER_ROUTE_THRESHOLD = 1;

/**
 * Hard ceiling on how many tool descriptions go into the router prompt. A
 * pathological workspace with hundreds of tools would otherwise make the router
 * call itself expensive; the candidate list is already app-fair (round-robin),
 * so a cap still spans every connected app.
 */
const MAX_CANDIDATES_IN_PROMPT = 200;

/** Only the first slice of a tool description is needed to judge relevance. */
const DESCRIPTION_PREVIEW_CHARS = 160;

const ROUTER_SYSTEM_PROMPT =
  'You are a tool selector. You are given a user request and a list of available ' +
  'tools, each as "name: description". Return the tools that could plausibly be ' +
  'needed to fulfil the request, as a JSON array of tool names and nothing else.\n\n' +
  'Bias hard toward recall: a missing tool makes the task fail outright, while an ' +
  'extra tool only costs a little prompt space. Include a tool if there is any ' +
  'reasonable chance it helps, including tools needed to gather ids or context ' +
  'before the main action. Only return an empty array if the request plainly needs ' +
  'no tool at all (e.g. a greeting or a general question). Respond with the JSON ' +
  'array only — no prose, no code fences.';

const SERVER_ROUTER_SYSTEM_PROMPT =
  'You are an app selector. You are given a user request, the built-in tools the ' +
  'assistant already has, and a list of apps the workspace has connected, each as ' +
  '"id (name)". Return the connected apps the request actually needs, as a JSON ' +
  'array of app ids and nothing else.\n\n' +
  'Built-in tools take precedence. If a built-in tool can serve the request, no ' +
  'connected app is needed for it. Do not select an app merely because it is ' +
  'topically related to something a built-in tool already covers — select it only ' +
  'when the request clearly needs that specific app, such as when the user names ' +
  'it or asks for data only that app holds.\n\n' +
  'This matters most when a connected app overlaps a built-in tool: a request ' +
  'about ads, campaigns, spend, or return on ad spend is served by the built-in ' +
  'tools unless the user names a different platform. Resolve that ambiguity in ' +
  'favour of the built-in and return no app — a user who meant the connected app ' +
  'will say so.\n\n' +
  'Attaching an app costs tens of thousands of tokens, so an unnecessary one is ' +
  'expensive — but an app the task genuinely needs is worth far more than it ' +
  'costs. When the request plainly needs one, include it, along with any app ' +
  'needed to gather ids or context first. Return an empty array when no connected ' +
  'app is needed. Respond with the JSON array only — no prose, no code fences.';

/**
 * Picks which bridged tools are worth sending for a given message.
 *
 * Gomer sends every tool schema on every turn, so a workspace with many
 * connected apps spends tens of thousands of tokens describing tools the current
 * message will never touch. A cheap pre-pass — the model sees only tool *names*
 * and short descriptions, not their full schemas — narrows that to the relevant
 * few before the real run.
 *
 * This never fails a run: any error, timeout, or unparseable answer returns null,
 * and the caller falls back to sending the unfiltered (capped) toolset.
 */
@Injectable()
export class ToolRouterService {
  private readonly logger = new Logger(ToolRouterService.name);

  /**
   * Returns the subset of `candidates` worth sending, or null to mean "could not
   * decide — send them all". Null covers both the skip-when-few case and any
   * failure, so the caller treats them identically.
   */
  async selectRelevant(
    provider: LlmProvider,
    model: string,
    message: string,
    candidates: ToolSpec[],
  ): Promise<ToolSpec[] | null> {
    if (candidates.length <= ROUTE_THRESHOLD) return null;

    const considered = candidates.slice(0, MAX_CANDIDATES_IN_PROMPT);
    const catalog = considered
      .map((tool) => `- ${tool.name}: ${this.previewDescription(tool.description)}`)
      .join('\n');

    let text: string;
    try {
      const response = await provider.create({
        model,
        system: ROUTER_SYSTEM_PROMPT,
        // No tools: the candidates are described as text so the router prompt
        // stays small. Handing them over as real tools would recreate the very
        // bloat this exists to remove.
        tools: [],
        mcpServers: [],
        // A one-shot classification needs no extended thinking, and only the
        // gateway path routes anyway — where this flag is ignored.
        capabilities: { adaptiveThinking: false },
        messages: [
          {
            role: 'user',
            content: `Request:\n${message}\n\nAvailable tools:\n${catalog}\n\nReturn the JSON array of relevant tool names.`,
          },
        ],
      });
      text = response.text;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Tool routing failed, sending unfiltered toolset: ${detail}`);
      return null;
    }

    const names = this.parseNames(text);
    if (!names) {
      this.logger.warn('Tool router returned an unparseable answer; sending unfiltered toolset');
      return null;
    }

    // Keep only names that are real candidates — the model can hallucinate one —
    // preserving the app-fair order the candidates already came in.
    const wanted = new Set(names);
    const selected = considered.filter((tool) => wanted.has(tool.name));

    // An empty selection is ambiguous: a correct "nothing applies" and a wrong
    // "the model dropped everything" look identical, and the second fails a real
    // task. Falling back to unfiltered costs tokens but never capability.
    if (!selected.length) return null;

    this.logger.log(`Tool router kept ${selected.length}/${candidates.length} tools for this run`);
    return selected;
  }

  /**
   * The same idea as {@link selectRelevant}, one level up: which connected apps
   * to attach at all.
   *
   * On the server-side MCP path we never see individual tool schemas — the
   * provider fetches them itself — so there is nothing to filter tool by tool.
   * Dropping a whole server is the only lever, and it is a large one: each app's
   * schemas are tens of thousands of tokens that ride on every turn of the run.
   *
   * Selection preserves the caller's order, so two messages that pick the same
   * apps render a byte-identical prefix and can share a prompt cache entry.
   *
   * Returns null to mean "send them all", exactly as {@link selectRelevant} does.
   */
  async selectRelevantServers(
    provider: LlmProvider,
    model: string,
    message: string,
    servers: RemoteMcpServer[],
    localTools: ToolSpec[] = [],
  ): Promise<RemoteMcpServer[] | null> {
    if (servers.length <= SERVER_ROUTE_THRESHOLD) return null;

    const catalog = servers
      .map((server) => `- ${server.appSlug} (${this.humanise(server.appSlug)})`)
      .join('\n');
    // Names only. They are self-describing (`meta_ads_list_campaigns`,
    // `verify_roas`), and full descriptions would cost more than the decision
    // they inform. Without this the router cannot tell that a request about
    // campaigns or ROAS is already covered, and reflexively attaches whichever
    // connected app looks topically closest — the expensive mistake here.
    const builtIn = localTools.map((tool) => tool.name).join(', ');

    let text: string;
    try {
      const response = await provider.create({
        model,
        system: SERVER_ROUTER_SYSTEM_PROMPT,
        // Deliberately no tools and no servers: attaching the very connectors we
        // are deciding about would cost the tokens this exists to save.
        tools: [],
        mcpServers: [],
        capabilities: { adaptiveThinking: false },
        messages: [
          {
            role: 'user',
            content:
              `Request:\n${message}\n\n` +
              (builtIn ? `Built-in tools (no app needed for these):\n${builtIn}\n\n` : '') +
              `Connected apps:\n${catalog}\n\n` +
              `Return the JSON array of app ids this request needs.`,
          },
        ],
      });
      text = response.text;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`App routing failed, attaching every connected app: ${detail}`);
      return null;
    }

    const slugs = this.parseNames(text);
    if (!slugs) {
      this.logger.warn('App router returned an unparseable answer; attaching every connected app');
      return null;
    }

    // Unlike tool routing, an explicitly empty answer is trusted rather than
    // treated as a failure. It is both the most common case and the most
    // valuable one: anything Gomer answers with local tools alone (most Meta Ads
    // work) needs no connector, and attaching none is the largest saving there
    // is. The prompt asks for `[]` in exactly this case, which is what separates
    // it from a reply we simply could not read.
    if (!slugs.length) {
      this.logger.log(`App router attached none of ${servers.length} connected apps for this run`);
      return [];
    }

    const wanted = new Set(slugs);
    const selected = servers.filter((server) => wanted.has(server.appSlug));

    // Every name came back hallucinated, so there is no way to tell what was
    // meant. Falling back costs tokens but never capability.
    if (!selected.length) return null;

    this.logger.log(
      `App router kept ${selected.length}/${servers.length} connected apps for this run` +
        ` (${selected.map((server) => server.appSlug).join(', ')})`,
    );
    return selected;
  }

  /** `google_sheets` → `google sheets`, so the model has a plain-English hint. */
  private humanise(slug: string): string {
    return slug.replace(/[_-]+/g, ' ').trim();
  }

  private previewDescription(description: string): string {
    const flat = description.replace(/\s+/g, ' ').trim();
    return flat.length > DESCRIPTION_PREVIEW_CHARS
      ? `${flat.slice(0, DESCRIPTION_PREVIEW_CHARS)}…`
      : flat;
  }

  /**
   * Pull a JSON string array out of the model's reply. Tolerates a stray code
   * fence or surrounding prose by locating the first bracketed array; returns
   * null when nothing array-shaped is found.
   */
  private parseNames(text: string): string[] | null {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) return null;
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (!Array.isArray(parsed)) return null;
      return parsed.filter((item): item is string => typeof item === 'string');
    } catch {
      return null;
    }
  }
}
