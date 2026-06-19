import type Anthropic from '@anthropic-ai/sdk';

/**
 * Local (client-side) tools that let Gomer build Spaces — spec-driven web apps.
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
      'or { type:"dashboard", title, widgets:[{ kind:"count"|"sum"|"list", label, entity, field? }] }.',
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

export const CREATE_SPACE_TOOL: Anthropic.Beta.BetaToolUnion = {
  type: 'custom',
  name: 'create_space',
  description:
    'Build and deploy a new web app (a "Space") for the workspace from a declarative spec. ' +
    'Use this for CRUD/form/dashboard internal tools (time loggers, trackers, calendars). ' +
    'Returns the live URL. End-user login is always passwordless magic link.',
  input_schema: {
    type: 'object',
    properties: SPEC_PROPERTIES,
    required: ['name', 'entities', 'views', 'auth'],
  },
};

export const UPDATE_SPACE_TOOL: Anthropic.Beta.BetaToolUnion = {
  type: 'custom',
  name: 'update_space',
  description: "Replace an existing Space's spec. Provide the Space slug plus the full new spec.",
  input_schema: {
    type: 'object',
    properties: { slug: { type: 'string' }, ...SPEC_PROPERTIES },
    required: ['slug', 'name', 'entities', 'views', 'auth'],
  },
};

export const SPACE_TOOLS = [CREATE_SPACE_TOOL, UPDATE_SPACE_TOOL];
