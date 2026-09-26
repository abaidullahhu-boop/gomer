import { Allow, IsString, Length } from 'class-validator';

/**
 * Body for saving one key of what a page remembers. `value` is any JSON the
 * page chose to store, checked for size in the service; `null` removes the key.
 */
export class PageStateDto {
  @IsString()
  @Length(1, 200)
  key!: string;

  @Allow()
  value!: unknown;
}
