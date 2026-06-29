import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Body for creating a scheduled task. The cron expression is validated in the service. */
export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  @MinLength(1)
  prompt!: string;

  /** Standard 5-field cron expression, e.g. "0 9 * * *" for 9am daily. */
  @IsString()
  @MaxLength(128)
  cronExpression!: string;

  /** IANA timezone the cron is interpreted in, e.g. "Asia/Karachi". */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** Model id to pin for this task's runs; omit for the workspace default. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  /** When true, the task runs once at its next occurrence and then deactivates. */
  @IsOptional()
  @IsBoolean()
  oneTime?: boolean;
}
