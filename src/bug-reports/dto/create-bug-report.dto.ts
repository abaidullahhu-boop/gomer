import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { BugReportSeverity } from '../../common/enums';

/**
 * What the dashboard's report form sends.
 *
 * `workspaceId`, the reporter and the user agent are deliberately absent: they
 * are taken from the session and the request on the server. A client that can
 * name its own workspace on a write is a client that can file reports into
 * someone else's tenant.
 */
export class CreateBugReportDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  /**
   * A floor of ten characters, because "it's broken" costs a round trip to
   * answer and the form says so before it refuses.
   */
  @IsString()
  @MinLength(10)
  @MaxLength(10_000)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  stepsToReproduce?: string;

  @IsOptional()
  @IsEnum(BugReportSeverity)
  severity?: BugReportSeverity;

  /** The dashboard route the reporter was on; filled in by the form. */
  @IsOptional()
  @IsString()
  @MaxLength(512)
  pageUrl?: string;
}
