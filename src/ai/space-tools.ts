import type { ToolSpec } from './providers/provider.interface';

/**
 * Local (client-side) tools that let Gaspo build Spaces: spec-driven web apps,
 * and pages it writes as whole HTML documents. Unlike the Pipedream MCP tools
 * (executed server-side by the connector), these are executed by AiService
 * against SpacesService and their results fed back.
 *
 * The input schema mirrors the AppSpec contract; the backend re-validates every
 * spec before persisting, so this schema is a guide for the model, not the gate.
 */

const FIELD_TYPES = [
  'string',
  'text',
  'number',
  'date',
  'datetime',
  'boolean',
  'select',
  'reference',
];

const SPEC_PROPERTIES = {
  name: { type: 'string', description: 'The app name, shown to end-users.' },
  description: { type: 'string' },
  entities: {
    type: 'array',
    description: 'The data types the app stores.',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Identifier, e.g. "TimeEntry".' },
        label: { type: 'string', description: 'Human label, e.g. "Time entry".' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              label: { type: 'string' },
              type: { type: 'string', enum: FIELD_TYPES },
              required: { type: 'boolean' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Allowed values when type is "select".',
              },
              refEntity: {
                type: 'string',
                description: 'Target entity name when type is "reference".',
              },
            },
            required: ['name', 'label', 'type'],
          },
        },
      },
      required: ['name', 'label', 'fields'],
    },
  },
  views: {
    type: 'array',
    description:
      'Screens: { type:"form", title, entity, fields? }, { type:"table", title, entity, columns? }, ' +
      'or { type:"dashboard", title, widgets:[{ kind:"count"|"sum"|"list", label, entity, field? }] }. ' +
      'A table lists rows and lets people change select and yes/no values in place (e.g. ticking ' +
      'a step from "To do" to "Done"); other values cannot be edited once saved. A form only adds ' +
      'new rows, so never title one as an update or edit screen.',
    items: { type: 'object' },
  },
  auth: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['magic-link'] },
      allowSignup: {
        type: 'boolean',
        description: 'If true any email may sign in; otherwise only invited members.',
      },
    },
    required: ['mode', 'allowSignup'],
  },
} as const;

const RECORDS_PROPERTY = {
  type: 'object',
  description:
    'Rows to put in the app, keyed by entity name: { "Task": [{ "title": "Set up the ad account", ' +
    '"status": "To do" }, ...] }. Use it for the content the user asked for (the steps of a plan, ' +
    "checklist items, a content calendar's posts) so the app opens filled in. List rows in the " +
    "order they should read. Use the entity's field names exactly; dates as YYYY-MM-DD. A " +
    "reference field takes the name of the row it points at (the value of that entity's first " +
    'text field), not an id. At most 200 rows per call.',
  additionalProperties: { type: 'array', items: { type: 'object' } },
} as const;

export const CREATE_SPACE_TOOL: ToolSpec = {
  name: 'create_space',
  description:
    'Build and deploy a new web app (a "Space") for the workspace from a declarative spec, ' +
    'optionally filled with starting rows. ' +
    'Use this for CRUD/form/dashboard internal tools (time loggers, trackers, calendars). ' +
    'Returns the live URL. End-user login is always passwordless magic link.',
  parameters: {
    type: 'object',
    properties: { ...SPEC_PROPERTIES, records: RECORDS_PROPERTY },
    required: ['name', 'entities', 'views', 'auth'],
  },
};

export const UPDATE_SPACE_TOOL: ToolSpec = {
  name: 'update_space',
  description: "Replace an existing Space's spec. Provide the Space slug plus the full new spec.",
  parameters: {
    type: 'object',
    properties: { slug: { type: 'string' }, ...SPEC_PROPERTIES },
    required: ['slug', 'name', 'entities', 'views', 'auth'],
  },
};

export const ADD_SPACE_RECORDS_TOOL: ToolSpec = {
  name: 'add_space_records',
  description:
    'Add rows to an existing Space, e.g. to fill in an app that was built empty. Provide the ' +
    "Space slug (the last part of its URL) and the rows. If you do not know the app's entities " +
    'and field names, a rejected call lists them.',
  parameters: {
    type: 'object',
    properties: { slug: { type: 'string' }, records: RECORDS_PROPERTY },
    required: ['slug', 'records'],
  },
};

export const CREATE_PAGE_TOOL: ToolSpec = {
  name: 'create_page',
  description:
    'Build and publish a designed web page for the workspace: a plan or gameplan, strategy, ' +
    'report, calculator, or a dashboard that presents analysis. People read it and use it, and ' +
    'it should look like a polished Claude artifact, not a form. You write the whole page as ' +
    'one HTML document. Returns the live URL, private to this team.\n\n' +
    'How to write it:\n' +
    '- One complete, self-contained HTML document with inline <style> and <script>. Scripts ' +
    'and stylesheets may load only from cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, ' +
    'esm.sh or cdn.tailwindcss.com, and fonts from Google Fonts. The page cannot make network ' +
    'requests (fetch is blocked), so put every figure and table in the page itself.\n' +
    '- Design it like a well-made product page: a hero that states the outcome, three or four ' +
    'headline stat cards, a sticky section nav, then sections that each open with a one-line ' +
    'point. Use cards, tables, step flows, callouts and charts (Chart.js) wherever they carry ' +
    'information. Neutral colours with one accent, generous spacing, a centred column about ' +
    '1100px wide, and a clear type scale. It must work at phone width with nothing wider than ' +
    'the screen: stack grids, put wide tables in a sideways-scrolling wrapper, and let the ' +
    'section nav scroll sideways.\n' +
    "- Write it with an expert's substance, not a generic outline: specific numbers, targets, " +
    'thresholds and examples throughout, and the decisions a reader has to make.\n' +
    '- If it has a calculator or model, compute every figure from the default inputs as the page ' +
    'loads and recalculate on every change. Never ship placeholders like "–" or empty tables.\n' +
    '- Ground it in this workspace: when a connected app holds relevant numbers (e.g. Meta Ads ' +
    'spend and cost per result), fetch them first and use them, and say which figures are ' +
    'measured and which are assumptions.\n' +
    '- Checkboxes are remembered for the whole team automatically; give each a stable id. To ' +
    'remember anything else (e.g. calculator inputs), call window.gaspo.state.get(key) and ' +
    'window.gaspo.state.set(key, value); localStorage also works and is saved the same way.\n' +
    '- Keep it under 60 KB.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The page title, shown to people who open it.' },
      description: { type: 'string', description: 'One line on what the page is for.' },
      html: { type: 'string', description: 'The whole page as one HTML document.' },
      allowSignup: {
        type: 'boolean',
        description: 'If true anyone with the link may sign in; by default only this team can.',
      },
    },
    required: ['name', 'html'],
  },
};

export const UPDATE_PAGE_TOOL: ToolSpec = {
  name: 'update_page',
  description:
    'Change a page built with create_page. For a targeted fix, pass edits: exact find/replace ' +
    'pairs applied in order, each find copied from the current page (read it with get_page) and ' +
    'matching exactly once. To rework it, pass html: the whole new document. The rules for ' +
    'writing a page in create_page still apply.',
  parameters: {
    type: 'object',
    properties: {
      slug: { type: 'string', description: 'The last part of the page URL.' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: { find: { type: 'string' }, replace: { type: 'string' } },
          required: ['find', 'replace'],
        },
      },
      html: { type: 'string', description: 'The whole new page, replacing the old one.' },
      name: { type: 'string', description: 'A new title, if it should change.' },
    },
    required: ['slug'],
  },
};

export const GET_PAGE_TOOL: ToolSpec = {
  name: 'get_page',
  description:
    'Read the current HTML of a page built with create_page, before changing it with ' +
    'update_page. Give the slug: the last part of the page URL.',
  parameters: {
    type: 'object',
    properties: { slug: { type: 'string' } },
    required: ['slug'],
  },
};

export const SPACE_TOOLS = [
  CREATE_SPACE_TOOL,
  UPDATE_SPACE_TOOL,
  ADD_SPACE_RECORDS_TOOL,
  CREATE_PAGE_TOOL,
  UPDATE_PAGE_TOOL,
  GET_PAGE_TOOL,
];
