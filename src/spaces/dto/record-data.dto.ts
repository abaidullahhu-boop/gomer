import { IsObject } from 'class-validator';

/**
 * Body for creating/updating a Space record. The contents are entity-specific
 * and validated against the Space's spec in the service (not by class-validator),
 * so `data` is accepted as an opaque object here.
 */
export class RecordDataDto {
  @IsObject()
  data!: Record<string, unknown>;
}
