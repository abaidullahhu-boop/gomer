import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { IntegrationAccessLevel } from '../../database/entities';

/**
 * Sent by the frontend after the Pipedream Connect popup succeeds, carrying the
 * newly connected account id so the backend can fetch and persist it, plus the
 * access level and optional nickname chosen in the connect modal.
 */
export class ConfirmConnectionDto {
  @IsString()
  @IsNotEmpty()
  accountId!: string;

  @IsString()
  @IsNotEmpty()
  appSlug!: string;

  @IsIn(['team', 'private'])
  accessLevel!: IntegrationAccessLevel;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string;
}
