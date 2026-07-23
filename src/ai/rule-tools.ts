import type { ToolSpec } from './providers/provider.interface';

/**
 * Local (client-side) tools for the automated rule engine, executed by
 * AiService against {@link RulesService} — the same dispatch mechanism as the
 * Meta Ads tools. Offered only when a Meta Ads account is connected. Creating a
 * rule that pauses or scales is itself a consequential change, so the model must
 * confirm the rule's terms and guardrails with the user before calling
 * create_ad_rule.
 */

/** Tool names, shared between the definitions and AiService's dispatcher. */
export const CREATE_AD_RULE = 'create_ad_rule';
export const LIST_AD_RULES = 'list_ad_rules';
export const SET_AD_RULE_ACTIVE = 'set_ad_rule_active';
export const DELETE_AD_RULE = 'delete_ad_rule';

const CREATE_AD_RULE_TOOL: ToolSpec = {
  name: CREATE_AD_RULE,
  description:
    'Create an automated rule that checks a Meta Ads metric on a schedule and, when it breaches, ' +
    'ALERTS, PAUSES, or SCALES the affected campaigns/ad sets — e.g. "every night at 2am pause any ' +
    'campaign whose CPA over the last 3 days is above 40", or "each morning raise budgets 15% on ' +
    'ad sets with ROAS above 4". Pausing and scaling run autonomously within guardrails ' +
    '(maxScalePct caps each budget change; maxActionsPerRun and dailyActionCap cap how many ' +
    'entities are touched), and every action is reported to Slack afterwards. Because a pause/scale ' +
    'rule changes a live ad account on its own, describe the full rule — metric, threshold, window, ' +
    'action, schedule, and guardrails — and get explicit confirmation BEFORE calling. Use the ad ' +
    'account id from meta_ads_list_ad_accounts.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short human name, e.g. "Overnight CPA pause".' },
      ad_account_id: { type: 'string', description: 'Target ad account, e.g. "act_123".' },
      scope: {
        type: 'string',
        enum: ['account', 'campaign', 'adset'],
        description:
          'What the metric is read at and what gets acted on. account can only ALERT (you cannot ' +
          'pause/scale an account); pause/scale need campaign or adset.',
      },
      metric: {
        type: 'string',
        enum: ['spend', 'cpa', 'roas', 'verified_roas', 'ctr', 'cpc'],
        description:
          'Metric to test. roas is Meta-reported; verified_roas reconciles Meta spend with actual ' +
          'Stripe revenue (account scope only, alert only). cpa is cost per purchase.',
      },
      comparator: {
        type: 'string',
        enum: ['gt', 'gte', 'lt', 'lte'],
        description: 'How the metric compares to the threshold (gt = greater than, etc.).',
      },
      threshold: { type: 'number', description: 'The number the metric is compared against.' },
      window_days: {
        type: 'number',
        description: 'Lookback window in days the metric is measured over. Default 3.',
      },
      action: {
        type: 'string',
        enum: ['alert', 'pause', 'scale'],
        description: 'What a breach does. pause is reversible; scale changes the daily budget.',
      },
      scale_pct: {
        type: 'number',
        description:
          'For scale: percent change to the daily budget (e.g. -20 or 15). Required for scale.',
      },
      cron_expression: {
        type: 'string',
        description: 'Standard 5-field cron for WHEN to evaluate, e.g. "0 2 * * *" for 2am daily.',
      },
      timezone: {
        type: 'string',
        description:
          'IANA timezone the cron runs in, e.g. "Asia/Karachi". Defaults to server time.',
      },
      slack_channel_id: {
        type: 'string',
        description: 'Channel/user id to post alerts and action reports to. Usually this channel.',
      },
      auto_execute: {
        type: 'boolean',
        description:
          'If false, a pause/scale rule only ALERTS instead of acting (a dry run). Default true.',
      },
      max_scale_pct: {
        type: 'number',
        description:
          "Guardrail: hard cap on a single scale action's magnitude, percent. Default 25.",
      },
      max_actions_per_run: {
        type: 'number',
        description: 'Guardrail: most entities acted on in one evaluation. Default 10.',
      },
      daily_action_cap: {
        type: 'number',
        description: 'Guardrail: most actions in a rolling 24h across runs. Default 25.',
      },
    },
    required: [
      'name',
      'ad_account_id',
      'scope',
      'metric',
      'comparator',
      'threshold',
      'action',
      'cron_expression',
    ],
  },
};

const LIST_AD_RULES_TOOL: ToolSpec = {
  name: LIST_AD_RULES,
  description:
    "List this workspace's automated ad rules with their conditions, actions, guardrails, " +
    'schedule, and active state. Use for "what rules are running?" or to find a rule id to ' +
    'pause or delete. Returns JSON.',
  parameters: { type: 'object', properties: {} },
};

const SET_AD_RULE_ACTIVE_TOOL: ToolSpec = {
  name: SET_AD_RULE_ACTIVE,
  description:
    'Enable or disable an automated ad rule by id without deleting it. Use to pause a rule ("stop ' +
    'the overnight pausing for now") or resume it. Get the id from list_ad_rules.',
  parameters: {
    type: 'object',
    properties: {
      rule_id: { type: 'string', description: 'The rule id to toggle.' },
      is_active: { type: 'boolean', description: 'true to enable, false to disable.' },
    },
    required: ['rule_id', 'is_active'],
  },
};

const DELETE_AD_RULE_TOOL: ToolSpec = {
  name: DELETE_AD_RULE,
  description:
    'Permanently delete an automated ad rule by id. Confirm which rule with the user first. Get ' +
    'the id from list_ad_rules.',
  parameters: {
    type: 'object',
    properties: { rule_id: { type: 'string', description: 'The rule id to delete.' } },
    required: ['rule_id'],
  },
};

/** The rule-engine tool set, added only when a Meta Ads account is connected. */
export const RULE_TOOLS: ToolSpec[] = [
  CREATE_AD_RULE_TOOL,
  LIST_AD_RULES_TOOL,
  SET_AD_RULE_ACTIVE_TOOL,
  DELETE_AD_RULE_TOOL,
];

/** Every rule tool name, for the AiService dispatcher. */
export const RULE_TOOL_NAMES = new Set<string>([
  CREATE_AD_RULE,
  LIST_AD_RULES,
  SET_AD_RULE_ACTIVE,
  DELETE_AD_RULE,
]);
