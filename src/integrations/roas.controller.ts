import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators';
import { RoasSnapshot } from '../database/entities';
import { RoasService } from './roas.service';

/**
 * Read-only history of verified-ROAS checks — ad spend paired with the revenue
 * Stripe actually collected. Snapshots are produced by asking the assistant to
 * verify ROAS; this lists what it has recorded so the history can be read
 * without re-running the calculation.
 */
@ApiTags('roas')
@Controller('roas')
export class RoasController {
  constructor(private readonly roasService: RoasService) {}

  /** Verified-ROAS snapshots for the workspace, newest first. */
  @Get('snapshots')
  snapshots(
    @CurrentUser('workspaceId') workspaceId: string,
    @Query('limit') limit?: string,
  ): Promise<RoasSnapshot[]> {
    const take = Math.min(Math.max(Number(limit) || 20, 1), 200);
    return this.roasService.listSnapshots(workspaceId, take);
  }
}
