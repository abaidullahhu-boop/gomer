import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { IntegrationAccessLevel } from '../../database/entities';

/**
 * Partial update to a connected account from its configure screen: rename the
 * account label, change who may use it, or enable/disable it. Every field is
 * optional so the UI can save one tab at a time.
 */
export class UpdateIntegrationDto {
  /** Member-set label; empty string clears it back to the account's own name. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string;

  @IsOptional()
  @IsIn(['team', 'private'])
  accessLevel?: IntegrationAccessLevel;

  /** Whether Gomer may use this connection in runs. */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
