import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { ScheduledExport } from '../database/entities';
import { ExportsService } from './exports.service';

/**
 * Read-only view of the workspace's recurring Google Sheets exports. Schedules
 * are created conversationally, so this reports rather than edits: destination,
 * cadence, last run, rows written, and last error.
 */
@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  /** Every scheduled export for the workspace. */
  @Get()
  list(@CurrentUser('workspaceId') workspaceId: string): Promise<ScheduledExport[]> {
    return this.exportsService.list(workspaceId);
  }
}
