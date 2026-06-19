import { BadRequestException } from '@nestjs/common';
import { AppSpec, DashboardWidgetSpec, EntitySpec, FieldSpec, FieldType } from './app-spec';

const FIELD_TYPES: FieldType[] = [
  'string',
  'text',
  'number',
  'date',
  'datetime',
  'boolean',
  'select',
  'reference',
];

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates an untrusted (model-produced) value into a well-formed {@link AppSpec}.
 * Collects every problem and throws a single BadRequestException so a bad spec
 * is rejected before it is ever persisted or rendered. Returns the same value
 * narrowed to AppSpec when valid.
 */
export function validateAppSpec(input: unknown): AppSpec {
  const errors: string[] = [];

  if (!isObject(input)) {
    throw new BadRequestException('spec must be an object');
  }

  if (typeof input.name !== 'string' || input.name.trim() === '') {
    errors.push('spec.name is required');
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    errors.push('spec.description must be a string');
  }

  const entities = input.entities;
  const entityNames = new Set<string>();
  if (!Array.isArray(entities) || entities.length === 0) {
    errors.push('spec.entities must be a non-empty array');
  } else {
    entities.forEach((entity, i) => validateEntity(entity, i, entityNames, errors));
  }

  const views = input.views;
  if (!Array.isArray(views) || views.length === 0) {
    errors.push('spec.views must be a non-empty array');
  } else {
    views.forEach((view, i) => validateView(view, i, entityNames, errors));
  }

  const auth = input.auth;
  if (!isObject(auth)) {
    errors.push('spec.auth is required');
  } else {
    if (auth.mode !== 'magic-link') {
      errors.push("spec.auth.mode must be 'magic-link'");
    }
    if (typeof auth.allowSignup !== 'boolean') {
      errors.push('spec.auth.allowSignup must be a boolean');
    }
  }

  if (errors.length > 0) {
    throw new BadRequestException({ message: 'Invalid app spec', errors });
  }

  return input as unknown as AppSpec;
}

function validateEntity(
  entity: unknown,
  index: number,
  entityNames: Set<string>,
  errors: string[],
): void {
  const at = `spec.entities[${index}]`;
  if (!isObject(entity)) {
    errors.push(`${at} must be an object`);
    return;
  }
  if (typeof entity.name !== 'string' || !NAME_RE.test(entity.name)) {
    errors.push(`${at}.name must be an identifier (letters, digits, underscore)`);
  } else if (entityNames.has(entity.name)) {
    errors.push(`${at}.name "${entity.name}" is duplicated`);
  } else {
    entityNames.add(entity.name);
  }
  if (typeof entity.label !== 'string' || entity.label.trim() === '') {
    errors.push(`${at}.label is required`);
  }

  const fields = entity.fields;
  const fieldNames = new Set<string>();
  if (!Array.isArray(fields) || fields.length === 0) {
    errors.push(`${at}.fields must be a non-empty array`);
  } else {
    fields.forEach((field, i) => validateField(field, `${at}.fields[${i}]`, fieldNames, errors));
  }
}

function validateField(
  field: unknown,
  at: string,
  fieldNames: Set<string>,
  errors: string[],
): void {
  if (!isObject(field)) {
    errors.push(`${at} must be an object`);
    return;
  }
  if (typeof field.name !== 'string' || !NAME_RE.test(field.name)) {
    errors.push(`${at}.name must be an identifier`);
  } else if (fieldNames.has(field.name)) {
    errors.push(`${at}.name "${field.name}" is duplicated`);
  } else {
    fieldNames.add(field.name);
  }
  if (typeof field.label !== 'string' || field.label.trim() === '') {
    errors.push(`${at}.label is required`);
  }
  if (!FIELD_TYPES.includes(field.type as FieldType)) {
    errors.push(`${at}.type must be one of: ${FIELD_TYPES.join(', ')}`);
  }
  if (field.type === 'select') {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      errors.push(`${at}.options is required for select fields`);
    }
  }
  if (field.type === 'reference' && typeof field.refEntity !== 'string') {
    errors.push(`${at}.refEntity is required for reference fields`);
  }
  if (field.required !== undefined && typeof field.required !== 'boolean') {
    errors.push(`${at}.required must be a boolean`);
  }
}

function validateView(
  view: unknown,
  index: number,
  entityNames: Set<string>,
  errors: string[],
): void {
  const at = `spec.views[${index}]`;
  if (!isObject(view)) {
    errors.push(`${at} must be an object`);
    return;
  }
  if (typeof view.title !== 'string' || view.title.trim() === '') {
    errors.push(`${at}.title is required`);
  }
  if (view.type === 'form' || view.type === 'table') {
    if (typeof view.entity !== 'string' || !entityNames.has(view.entity)) {
      errors.push(`${at}.entity must reference a defined entity`);
    }
  } else if (view.type === 'dashboard') {
    const widgets = view.widgets;
    if (!Array.isArray(widgets) || widgets.length === 0) {
      errors.push(`${at}.widgets must be a non-empty array`);
    } else {
      widgets.forEach((widget, i) =>
        validateWidget(widget, `${at}.widgets[${i}]`, entityNames, errors),
      );
    }
  } else {
    errors.push(`${at}.type must be 'form', 'table', or 'dashboard'`);
  }
}

function validateWidget(
  widget: unknown,
  at: string,
  entityNames: Set<string>,
  errors: string[],
): void {
  if (!isObject(widget)) {
    errors.push(`${at} must be an object`);
    return;
  }
  const kinds: DashboardWidgetSpec['kind'][] = ['count', 'sum', 'list'];
  if (!kinds.includes(widget.kind as DashboardWidgetSpec['kind'])) {
    errors.push(`${at}.kind must be one of: ${kinds.join(', ')}`);
  }
  if (typeof widget.label !== 'string' || widget.label.trim() === '') {
    errors.push(`${at}.label is required`);
  }
  if (typeof widget.entity !== 'string' || !entityNames.has(widget.entity)) {
    errors.push(`${at}.entity must reference a defined entity`);
  }
  if (widget.kind === 'sum' && typeof widget.field !== 'string') {
    errors.push(`${at}.field is required for sum widgets`);
  }
}

/**
 * Coerces and validates an end-user record payload against an entity's fields,
 * returning a clean object holding only known fields. Unknown keys are dropped
 * and required fields are enforced, so callers can trust what reaches the store.
 */
export function validateRecordData(entity: EntitySpec, data: unknown): Record<string, unknown> {
  if (!isObject(data)) {
    throw new BadRequestException('record data must be an object');
  }
  const errors: string[] = [];
  const clean: Record<string, unknown> = {};

  for (const field of entity.fields) {
    const raw = data[field.name];
    if (raw === undefined || raw === null || raw === '') {
      if (field.required) errors.push(`${field.name} is required`);
      continue;
    }
    const coerced = coerceFieldValue(field, raw, errors);
    if (coerced !== undefined) clean[field.name] = coerced;
  }

  if (errors.length > 0) {
    throw new BadRequestException({ message: 'Invalid record', errors });
  }
  return clean;
}

function coerceFieldValue(field: FieldSpec, raw: unknown, errors: string[]): unknown {
  switch (field.type) {
    case 'number': {
      const num = typeof raw === 'number' ? raw : Number(raw);
      if (Number.isNaN(num)) {
        errors.push(`${field.name} must be a number`);
        return undefined;
      }
      return num;
    }
    case 'boolean':
      return Boolean(raw);
    case 'select':
      if (!field.options?.includes(String(raw))) {
        errors.push(`${field.name} must be one of: ${(field.options ?? []).join(', ')}`);
        return undefined;
      }
      return String(raw);
    case 'date':
    case 'datetime':
    case 'string':
    case 'text':
    case 'reference':
    default:
      return String(raw);
  }
}
