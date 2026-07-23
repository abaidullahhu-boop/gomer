import type { ToolSpec } from './providers/provider.interface';

/**
 * Local (client-side) tools for Gomer's durable workspace memory, executed by
 * AiService against {@link WorkspaceMemoryService} — the same dispatch mechanism
 * as the Spaces and workspace-stats tools. Saved facts persist across every
 * conversation in the workspace and are injected into each run's system prompt.
 */

/** Tool names, shared between the definitions and AiService's dispatcher. */
export const MEMORY_REMEMBER_FACT = 'remember_fact';
export const MEMORY_RECALL_FACTS = 'recall_facts';
export const MEMORY_FORGET_FACT = 'forget_fact';

const REMEMBER_FACT_TOOL: ToolSpec = {
  name: MEMORY_REMEMBER_FACT,
  description:
    'Save (or overwrite) a durable workspace fact so it is remembered in every future ' +
    'conversation. Use when the user states a lasting preference, target, or standing ' +
    'instruction — e.g. "our target ROAS is 3", "always report spend in EUR", "the KIVOVA ' +
    'account is the main one". Do NOT save one-off request details or anything transient. ' +
    'Pick a short, stable snake_case key (e.g. "target_roas") so later updates overwrite ' +
    'rather than duplicate; check the "Workspace memory" list in your context for an ' +
    'existing key first.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Short, stable snake_case identifier for the fact, e.g. "target_roas".',
      },
      value: {
        type: 'string',
        description: 'The fact itself, concise and self-contained (max ~2000 chars).',
      },
    },
    required: ['key', 'value'],
  },
};

const RECALL_FACTS_TOOL: ToolSpec = {
  name: MEMORY_RECALL_FACTS,
  description:
    'List every saved workspace fact with its key, value, and when it was last updated. The ' +
    'current facts are already in your context under "Workspace memory"; call this only when ' +
    'you need the full unabridged list (e.g. the user asks "what do you remember?") or exact ' +
    'keys to update or forget. Returns JSON.',
  parameters: { type: 'object', properties: {} },
};

const FORGET_FACT_TOOL: ToolSpec = {
  name: MEMORY_FORGET_FACT,
  description:
    'Delete a saved workspace fact by its key. Use when the user retracts or invalidates ' +
    'something previously remembered ("forget the ROAS target", "that account is closed"). ' +
    'To change a fact, prefer remember_fact with the same key instead.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The exact key of the fact to delete.' },
    },
    required: ['key'],
  },
};

/** The memory tool set, sent on every run. */
export const MEMORY_TOOLS: ToolSpec[] = [REMEMBER_FACT_TOOL, RECALL_FACTS_TOOL, FORGET_FACT_TOOL];

/** Every memory tool name, for the AiService dispatcher. */
export const MEMORY_TOOL_NAMES = new Set<string>([
  MEMORY_REMEMBER_FACT,
  MEMORY_RECALL_FACTS,
  MEMORY_FORGET_FACT,
]);
