import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AppSpec, EntitySpec, FieldSpec } from './app-spec';
import { isObject, validateRecordData, validationReasons } from './validate-spec';

/** The most rows one call may add, so a runaway plan cannot flood an app. */
export const MAX_SEED_RECORDS = 200;

/** A validated starting row. Its id is assigned up front so other rows can point at it. */
export interface SeedRecord {
  id: string;
  entityName: string;
  data: Record<string, unknown>;
}

/** A row already in the app, which a new row's reference field may name. */
export type ExistingRecord = SeedRecord;

/**
 * The field a row is known by: its entity's first string or text field. The
 * runtime labels rows the same way, so the name a reference is written with is
 * the name people see in the app.
 */
export function labelFieldOf(entity: EntitySpec): FieldSpec | undefined {
  return entity.fields.find((f) => f.type === 'string' || f.type === 'text');
}

/** One entity's fields spelled out for the model, e.g. "Task: title (string, required), …". */
function describeEntity(entity: EntitySpec): string {
  const fields = entity.fields.map((f) => {
    const type =
      f.type === 'select'
        ? `select: ${(f.options ?? []).join(' | ')}`
        : f.type === 'reference'
          ? `reference to a ${f.refEntity}, by its name`
          : f.type;
    return `${f.name} (${type}${f.required ? ', required' : ''})`;
  });
  return `${entity.name}: ${fields.join(', ')}`;
}

/** Every entity of an app spelled out, for an error the model has to act on. */
export function describeApp(spec: AppSpec): string {
  return spec.entities.map(describeEntity).join('; ');
}

/**
 * Validates model-written rows for a Space, given as `{ EntityName: [row, …] }`.
 *
 * Stricter than an end-user save: an unknown field is an error rather than
 * dropped, because a model that guessed the field names would otherwise fill
 * the app with blank rows. A reference field is written as the name of the row
 * it points at, either a row in this batch or one already in the app, and is
 * resolved to that row's id here. Every problem is collected and thrown
 * together, ending with the app's entities and fields spelled out, so the
 * model can fix the whole call without guessing again.
 */
export function prepareSeedRecords(
  spec: AppSpec,
  input: unknown,
  existing: ExistingRecord[] = [],
): SeedRecord[] {
  if (input === undefined || input === null) return [];
  if (!isObject(input)) {
    throw new BadRequestException(
      'records must map each entity name to a list of rows, e.g. { "Task": [{ ... }] }',
    );
  }

  const total = Object.values(input).reduce<number>(
    (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
  if (total > MAX_SEED_RECORDS) {
    throw new BadRequestException(
      `records holds ${total} rows; one call may add at most ${MAX_SEED_RECORDS}`,
    );
  }

  const errors: string[] = [];
  const seeds: Array<{ seed: SeedRecord; at: string }> = [];

  for (const [entityName, rows] of Object.entries(input)) {
    const entity = spec.entities.find((e) => e.name === entityName);
    if (!entity) {
      errors.push(`records.${entityName}: no such entity`);
      continue;
    }
    if (!Array.isArray(rows)) {
      errors.push(`records.${entityName} must be a list of rows`);
      continue;
    }
    const known = new Set(entity.fields.map((f) => f.name));
    rows.forEach((row: unknown, i) => {
      const at = `records.${entityName}[${i}]`;
      if (!isObject(row)) {
        errors.push(`${at} must be an object`);
        return;
      }
      const unknown = Object.keys(row).filter((key) => !known.has(key));
      if (unknown.length > 0) {
        const names = unknown.map((key) => `"${key}"`).join(', ');
        errors.push(`${at}: unknown field ${names}`);
        return;
      }
      try {
        const data = validateRecordData(entity, row);
        if (Object.keys(data).length === 0) {
          errors.push(`${at} has no values`);
          return;
        }
        seeds.push({ seed: { id: randomUUID(), entityName, data }, at });
      } catch (error) {
        const reasons = validationReasons(error);
        const fallback = error instanceof Error ? error.message : String(error);
        errors.push(...(reasons.length > 0 ? reasons : [fallback]).map((r) => `${at}: ${r}`));
      }
    });
  }

  resolveReferences(spec, seeds, existing, errors);

  if (errors.length > 0) {
    errors.push(`This app has ${describeApp(spec)}`);
    throw new BadRequestException({ message: 'Invalid starting records', errors });
  }
  return seeds.map(({ seed }) => seed);
}

/** Swap each reference field's row name for that row's id, in place. */
function resolveReferences(
  spec: AppSpec,
  seeds: Array<{ seed: SeedRecord; at: string }>,
  existing: ExistingRecord[],
  errors: string[],
): void {
  // Entity name -> lower-cased row name -> id. New rows go in first, so a name
  // this batch reuses points at the row just written.
  const byName = new Map<string, Map<string, string>>();
  for (const row of [...seeds.map(({ seed }) => seed), ...existing]) {
    const entity = spec.entities.find((e) => e.name === row.entityName);
    const labelField = entity && labelFieldOf(entity);
    const label = labelField ? row.data[labelField.name] : undefined;
    if (typeof label !== 'string' || label.trim() === '') continue;
    const names = byName.get(row.entityName) ?? new Map<string, string>();
    byName.set(row.entityName, names);
    const key = label.trim().toLowerCase();
    if (!names.has(key)) names.set(key, row.id);
  }

  for (const { seed, at } of seeds) {
    const entity = spec.entities.find((e) => e.name === seed.entityName);
    for (const field of entity?.fields ?? []) {
      const value = seed.data[field.name];
      if (field.type !== 'reference' || typeof value !== 'string') continue;
      const id = byName.get(field.refEntity ?? '')?.get(value.trim().toLowerCase());
      if (id) {
        seed.data[field.name] = id;
      } else {
        errors.push(
          `${at}.${field.name}: no ${field.refEntity} named "${value}". ` +
            `Give the name of a ${field.refEntity} added in this call or already in the app`,
        );
      }
    }
  }
}
