import { IsOptional, IsString } from 'class-validator';

/** Query parameters Slack appends when redirecting to the OAuth callback. */
export class SlackCallbackDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  error?: string;
}
