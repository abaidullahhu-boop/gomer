/**
 * Canned proactive messages Gomer sends unprompted — the onboarding intro a new
 * member (or the installer) receives. Written in Slack mrkdwn (single-asterisk
 * bold, `_italics_`, `• ` bullets), not Markdown.
 */

/** A first name to greet by, falling back to a friendly default. */
function firstName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return 'there';
  return trimmed.split(/\s+/)[0];
}

/**
 * The intro DM Gomer sends when it first meets someone — on install (to the
 * installer) and when a new member joins the workspace. `isInstaller` adds a
 * line about the daily check-in that only the installing admin needs to know.
 */
export function buildWelcomeMessage(
  name: string | null | undefined,
  options: { isInstaller?: boolean } = {},
): string {
  const lines = [
    `Hi ${firstName(name)} :wave:, great to meet you. I'm *Gomer*, your new AI coworker. Here are three ways to work with me:`,
    '',
    ':speech_balloon: *DM me here* — just message me like a coworker. Research, analysis, reports, automation — anything.',
    ":mega: *@Gomer in any channel* — mention me in context and I'll jump in with the full thread as background.",
    ":electric_plug: *I connect to 3000+ tools* — Gmail, GitHub, Stripe, HubSpot, Google Ads, and more. Just tell me what you need and I'll figure out access.",
    '',
    'Try one now — just reply here:',
    '• _Check my Gmail for anything urgent this week and summarize it_',
    '• _Summarize the last week of activity in one of our channels_',
  ];

  if (options.isInstaller) {
    lines.push(
      '',
      "I'll also do a short daily check-in here to suggest ways I can help — tell me to dial it back anytime.",
    );
  }

  lines.push('', "Or just tell me what you need — I'll take it from there :rocket:");
  return lines.join('\n');
}

/** action_id values Slack sends back when an approval button is clicked. */
export const APPROVE_ACTION_ID = 'gomer_approve';
export const CANCEL_ACTION_ID = 'gomer_cancel';

/** A minimal subset of Slack Block Kit blocks we build. */
export type SlackBlock = Record<string, unknown>;

/**
 * The approval card shown under a reply when Gomer wants to take a gated write
 * action (e.g. a Meta Ads change). `text` is Gomer's mrkdwn description of what
 * it will do; `token` identifies the pending action for the button callback.
 */
export function buildApprovalBlocks(text: string, token: string, label: string): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    {
      type: 'actions',
      block_id: `approval:${token}`,
      elements: [
        {
          type: 'button',
          style: 'primary',
          text: { type: 'plain_text', text: `Approve: ${label}`, emoji: true },
          action_id: APPROVE_ACTION_ID,
          value: token,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel', emoji: true },
          action_id: CANCEL_ACTION_ID,
          value: token,
        },
      ],
    },
  ];
}

/** The card the approval message becomes once it's been resolved (buttons removed). */
export function buildResolvedBlocks(text: string, footer: string): SlackBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: footer }] },
  ];
}
