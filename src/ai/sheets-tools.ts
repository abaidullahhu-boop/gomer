import type { ToolSpec } from './providers/provider.interface';

/**
 * Local (client-side) tools for Google Sheets export automation, executed by
 * AiService against {@link ExportsService} — the same dispatch mechanism as the
 * Meta Ads tools. Offered only when a Google Sheets account is connected.
 *
 * These write Gomer's OWN reporting data (verified ROAS, campaign performance,
 * rule-engine actions) with a fixed column layout, which is why they exist
 * alongside Pipedream's generic Google Sheets MCP actions: the layout is stable
 * across runs, a schedule can run one with no model in the loop, and repeat runs
 * append instead of duplicating. Use the generic Sheets actions for arbitrary
 * spreadsheet work; use these for recurring reports.
 */

/** Tool names, shared between the definitions and AiService's dispatcher. */
export const EXPORT_TO_SHEET = 'export_to_sheet';
export const CREATE_SCHEDULED_EXPORT = 'create_scheduled_export';
export const LIST_SCHEDULED_EXPORTS = 'list_scheduled_exports';
export const SET_SCHEDULED_EXPORT_ACTIVE = 'set_scheduled_export_active';
export const DELETE_SCHEDULED_EXPORT = 'delete_scheduled_export';
export const RUN_SCHEDULED_EXPORT_NOW = 'run_scheduled_export_now';

/** Shared description of what each dataset contains. */
const DATASET_DESCRIPTION =
  'Which data to write: "roas_snapshots" = verified ROAS runs (Meta spend vs actual Stripe ' +
  'revenue); "campaign_insights" = Meta campaign performance (spend, clicks, CTR, CPC, ' +
  'purchases, CPA, ROAS) and needs ad_account_id; "rule_actions" = what the automated rules ' +
  'alerted on, paused, or scaled.';

/** Destination properties, shared by the one-off and scheduled export tools. */
const DESTINATION_PROPERTIES = {
  spreadsheet_id: {
    type: 'string',
    description:
      'Existing spreadsheet to append to. Omit to create a new one. Prefer a remembered sheet ' +
      '(e.g. an "export_sheet_id" fact) over creating another spreadsheet each time.',
  },
  spreadsheet_title: {
    type: 'string',
    description: 'Title for the spreadsheet when one has to be created.',
  },
  sheet_title: {
    type: 'string',
    description:
      'Tab within the spreadsheet, created if missing. Defaults to a per-dataset name, e.g. ' +
      '"Verified ROAS". Keep one dataset per tab — the columns differ.',
  },
} as const;

const EXPORT_TO_SHEET_TOOL: ToolSpec = {
  name: EXPORT_TO_SHEET,
  description:
    "Export one of Gomer's reporting datasets to a Google Sheet NOW, with a fixed column " +
    'layout. Use for "put our ROAS history in a spreadsheet", "export last month\'s campaign ' +
    'numbers", or any one-off report request. Creates the spreadsheet when none is given and ' +
    'appends beneath existing rows otherwise. Returns the spreadsheet URL — always give it to ' +
    'the user. For a RECURRING report use create_scheduled_export instead. Returns JSON.',
  parameters: {
    type: 'object',
    properties: {
      dataset: {
        type: 'string',
        enum: ['roas_snapshots', 'campaign_insights', 'rule_actions'],
        description: DATASET_DESCRIPTION,
      },
      ad_account_id: {
        type: 'string',
        description:
          'Ad account for campaign_insights, from meta_ads_list_ad_accounts, e.g. "act_123".',
      },
      window_days: {
        type: 'number',
        description: 'How many days back to cover. Default 7.',
      },
      ...DESTINATION_PROPERTIES,
    },
    required: ['dataset'],
  },
};

const CREATE_SCHEDULED_EXPORT_TOOL: ToolSpec = {
  name: CREATE_SCHEDULED_EXPORT,
  description:
    'Set up a RECURRING export that writes a reporting dataset to a Google Sheet on a schedule — ' +
    'e.g. "every Monday at 8am put last week\'s campaign performance in our reporting sheet". ' +
    'Each run appends only what is new, so the sheet builds a history instead of repeating rows. ' +
    'Runs on its own with no conversation involved and posts a confirmation to Slack. Confirm ' +
    'the dataset, schedule, and destination with the user before calling. Reuse a remembered ' +
    'spreadsheet id where one exists, and remember the id of any sheet created here.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Short human name, e.g. "Weekly ROAS report".' },
      dataset: {
        type: 'string',
        enum: ['roas_snapshots', 'campaign_insights', 'rule_actions'],
        description: DATASET_DESCRIPTION,
      },
      cron_expression: {
        type: 'string',
        description: 'Standard 5-field cron for WHEN to run, e.g. "0 8 * * 1" for 8am Mondays.',
      },
      timezone: {
        type: 'string',
        description:
          'IANA timezone the cron runs in, e.g. "Asia/Karachi". Defaults to server time.',
      },
      ad_account_id: {
        type: 'string',
        description: 'Ad account for campaign_insights, e.g. "act_123".',
      },
      window_days: {
        type: 'number',
        description:
          'Lookback window each run covers, and the backfill on the first run. Default 7.',
      },
      slack_channel_id: {
        type: 'string',
        description: 'Channel/user id to post the "export finished" note to. Usually this channel.',
      },
      ...DESTINATION_PROPERTIES,
    },
    required: ['name', 'dataset', 'cron_expression'],
  },
};

const LIST_SCHEDULED_EXPORTS_TOOL: ToolSpec = {
  name: LIST_SCHEDULED_EXPORTS,
  description:
    "List this workspace's recurring Sheets exports: dataset, schedule, destination sheet, " +
    'active state, and how the last run went (rows written, or the error). Use for "what reports ' +
    'are running?", "did the weekly export work?", or to find an id to pause or delete. ' +
    'Returns JSON.',
  parameters: { type: 'object', properties: {} },
};

const SET_SCHEDULED_EXPORT_ACTIVE_TOOL: ToolSpec = {
  name: SET_SCHEDULED_EXPORT_ACTIVE,
  description:
    'Enable or disable a recurring export by id without deleting it. Get the id from ' +
    'list_scheduled_exports.',
  parameters: {
    type: 'object',
    properties: {
      export_id: { type: 'string', description: 'The export id to toggle.' },
      is_active: { type: 'boolean', description: 'true to enable, false to disable.' },
    },
    required: ['export_id', 'is_active'],
  },
};

const DELETE_SCHEDULED_EXPORT_TOOL: ToolSpec = {
  name: DELETE_SCHEDULED_EXPORT,
  description:
    'Permanently delete a recurring export by id. The spreadsheet itself is left untouched. ' +
    'Confirm which export with the user first. Get the id from list_scheduled_exports.',
  parameters: {
    type: 'object',
    properties: { export_id: { type: 'string', description: 'The export id to delete.' } },
    required: ['export_id'],
  },
};

const RUN_SCHEDULED_EXPORT_NOW_TOOL: ToolSpec = {
  name: RUN_SCHEDULED_EXPORT_NOW,
  description:
    'Run a recurring export immediately without waiting for its schedule (and without moving it) ' +
    '— use to test one after setting it up, or when the user wants the sheet refreshed now. ' +
    'Get the id from list_scheduled_exports. Returns JSON.',
  parameters: {
    type: 'object',
    properties: { export_id: { type: 'string', description: 'The export id to run.' } },
    required: ['export_id'],
  },
};

/** The export tool set, added only when Google Sheets is connected. */
export const SHEETS_TOOLS: ToolSpec[] = [
  EXPORT_TO_SHEET_TOOL,
  CREATE_SCHEDULED_EXPORT_TOOL,
  LIST_SCHEDULED_EXPORTS_TOOL,
  SET_SCHEDULED_EXPORT_ACTIVE_TOOL,
  DELETE_SCHEDULED_EXPORT_TOOL,
  RUN_SCHEDULED_EXPORT_NOW_TOOL,
];

/** Every export tool name, for the AiService dispatcher. */
export const SHEETS_TOOL_NAMES = new Set<string>([
  EXPORT_TO_SHEET,
  CREATE_SCHEDULED_EXPORT,
  LIST_SCHEDULED_EXPORTS,
  SET_SCHEDULED_EXPORT_ACTIVE,
  DELETE_SCHEDULED_EXPORT,
  RUN_SCHEDULED_EXPORT_NOW,
]);
