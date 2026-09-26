import type { ToolSpec } from './providers/provider.interface';

/**
 * Local (client-side) tools that let Gaspo build Spaces — spec-driven web apps.
 * Unlike the Pipedream MCP tools (executed server-side by the connector), these
 * are executed by AiService against SpacesService and their results fed back.
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

export const SPACE_TOOLS = [CREATE_SPACE_TOOL, UPDATE_SPACE_TOOL, ADD_SPACE_RECORDS_TOOL];
