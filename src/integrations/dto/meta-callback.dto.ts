import { IsOptional, IsString } from 'class-validator';

/**
 * Query Meta appends when redirecting the browser back after consent. On success
 * `code` and `state` are present; on denial/error Meta sends `error` instead.
 */
export class MetaCallbackDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  error?: string;
}
