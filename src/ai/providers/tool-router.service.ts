import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, ToolSpec } from './provider.interface';

/**
 * Below this many bridged tools, routing is skipped: the prompt savings do not
 * justify an extra provider round-trip, and sending them all is cheap enough.
 */
const ROUTE_THRESHOLD = 20;

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
