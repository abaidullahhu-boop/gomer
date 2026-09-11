import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { BugReportStatus } from '../../common/enums';

/** A triage change made from the owner panel. Both fields are independent. */
export class UpdateBugReportDto {
  @IsOptional()
  @IsEnum(BugReportStatus)
  status?: BugReportStatus;

  /**
   * Explicitly nullable: clearing a note is a real edit, and `@IsOptional()`
   * alone would reject `null` while accepting the field's absence — making the
   * note write-once from the UI's point of view.
   */
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  resolutionNote?: string | null;
}
