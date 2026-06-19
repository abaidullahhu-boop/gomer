/**
 * The declarative app spec a Space is built from. This is the entire contract
 * between Gomer (which emits a spec) and the runtime (which renders it). The
 * surface is deliberately small — CRUD forms, tables, and simple dashboards —
 * so a spec is safe to render generically without ever executing generated code.
 */

/** The data types a field may hold. */
export type FieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'select'
  | 'reference';

export interface FieldSpec {
  /** Machine name, unique within its entity (e.g. "hours"). */
  name: string;
  /** Human label shown in forms and tables (e.g. "Hours worked"). */
  label: string;
  type: FieldType;
  required?: boolean;
  /** Allowed values when `type` is `select`. */
  options?: string[];
  /** The entity `name` this field points at when `type` is `reference`. */
  refEntity?: string;
}

export interface EntitySpec {
  /** Machine name, unique within the spec (e.g. "TimeEntry"). */
  name: string;
  /** Human label, singular (e.g. "Time entry"). */
  label: string;
  fields: FieldSpec[];
}

export interface FormViewSpec {
  type: 'form';
  title: string;
  entity: string;
  /** Field names to include; omitted means every field on the entity. */
  fields?: string[];
}

export interface TableViewSpec {
  type: 'table';
  title: string;
  entity: string;
  /** Field names to show as columns; omitted means every field. */
  columns?: string[];
}

export type DashboardWidgetKind = 'count' | 'sum' | 'list';

export interface DashboardWidgetSpec {
  kind: DashboardWidgetKind;
  label: string;
  entity: string;
  /** The numeric field to sum when `kind` is `sum`. */
  field?: string;
}

export interface DashboardViewSpec {
  type: 'dashboard';
  title: string;
  widgets: DashboardWidgetSpec[];
}

export type ViewSpec = FormViewSpec | TableViewSpec | DashboardViewSpec;

export interface AuthSpec {
  /** MVP supports a single passwordless mode. */
  mode: 'magic-link';
  /** When true, any email may sign in; otherwise only invited members. */
  allowSignup: boolean;
}

export interface AppSpec {
  name: string;
  description?: string;
  entities: EntitySpec[];
  views: ViewSpec[];
  auth: AuthSpec;
}
