import type Anthropic from '@anthropic-ai/sdk';

/**
 * Local (client-side) tools that answer questions about the workspace itself,
 * rather than acting on a connected app. Executed by AiService against the
 * workspace's own data (members, integrations) and the results fed back to the
 * model — the same mechanism as the Spaces tools.
 */

/** Tool name, shared between the definition and AiService's dispatcher. */
export const GET_WORKSPACE_STATS = 'get_workspace_stats';

export const GET_WORKSPACE_STATS_TOOL: Anthropic.Beta.BetaToolUnion = {
  type: 'custom',
  name: GET_WORKSPACE_STATS,
  description:
    'Get a full report of THIS workspace: total members, how many have signed up to Gomer vs not, ' +
    'and every connected app account with who connected it and its label. Use this for questions like ' +
    '"how many members are in this workspace?", "who has connected what?", or "how many people have ' +
    'attached their Slack?". This reads workspace data directly; it is not a connected-app integration.\n' +
    'Present the result clearly: a short member summary first (total, signed up, not signed up), then the ' +
    'connected accounts grouped or tabulated by person → app → label (use a Slack code block for alignment ' +
    'when there are several). Flag any account where active is false as needing attention, note when total ' +
    'members is null (roster unavailable), and offer to help reach members who have not signed up. Returns ' +
    'JSON; if there are no connections, say so plainly.',
  input_schema: { type: 'object', properties: {} },
};

export const WORKSPACE_TOOLS = [GET_WORKSPACE_STATS_TOOL];
