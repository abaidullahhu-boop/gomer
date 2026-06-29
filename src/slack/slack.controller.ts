import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { Public } from '../common/decorators';
import { SlackEventEnvelope } from './interfaces/slack-event.interface';
import { SlackEventsService } from './slack-events.service';
import { SlackService } from './slack.service';

@ApiTags('slack')
@Controller('slack')
export class SlackController {
  constructor(
    private readonly slackService: SlackService,
    private readonly slackEventsService: SlackEventsService,
  ) {}

  /** Liveness probe for the Slack integration surface. */
  @Public()
  @Get('status')
  status(): { module: string; ready: boolean } {
    return { module: 'slack', ready: true };
  }

  /**
   * Slack Events API webhook. Handles the one-time URL verification handshake
   * and inbound messages (app mentions + DMs). We verify the request signature,
   * ack within Slack's 3s window, and run the AI asynchronously.
   */
  @Public()
  @Post('events')
  @HttpCode(HttpStatus.OK)
  handleEvents(@Req() req: RawBodyRequest<Request>): { challenge?: string } | { ok: true } {
    const rawBody = req.rawBody;
    if (!rawBody) {
      throw new BadRequestException('Missing request body');
    }

    const signature = req.header('x-slack-signature');
    const timestamp = req.header('x-slack-request-timestamp');
    if (!this.slackService.verifySignature(signature, timestamp, rawBody)) {
      throw new UnauthorizedException('Invalid Slack signature');
    }

    const envelope = req.body as SlackEventEnvelope;

    // URL verification handshake — echo the challenge back synchronously.
    if (envelope.type === 'url_verification') {
      return { challenge: envelope.challenge };
    }

    if (envelope.type === 'event_callback') {
      // Don't block the ack on the AI run; Slack retries if we're slow.
      void this.slackEventsService.handleEventCallback(envelope);
    }

    return { ok: true };
  }
}
