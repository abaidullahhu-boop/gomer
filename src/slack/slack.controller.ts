import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators';
import { ApiTags } from '@nestjs/swagger';

/**
 * Placeholder Slack controller. Slack event subscriptions, slash commands and
 * interactive payloads will be handled here in later phases.
 */
@ApiTags('slack')
@Controller('slack')
export class SlackController {
  /** Liveness probe for the Slack integration surface. */
  @Public()
  @Get('status')
  status(): { module: string; ready: boolean } {
    return { module: 'slack', ready: true };
  }
}
