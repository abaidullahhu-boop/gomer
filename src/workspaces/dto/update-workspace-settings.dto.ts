import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { PERSONALITY_TONES } from '../../ai/personality';

/** Matches the character counter the settings page shows. */
const MAX_INSTRUCTIONS = 4000;

/**
 * Body for `PATCH /workspaces/me`. Every field is optional so the settings page
 * can save one section at a time; `null` clears a value.
 *
 * `defaultModel` is checked against the live catalog in the controller rather
 * than here, since the set of models depends on runtime configuration.
 */
export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(128)
  defaultModel?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(PERSONALITY_TONES)
  personalityTone?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_INSTRUCTIONS)
  workspaceInstructions?: string | null;
}
