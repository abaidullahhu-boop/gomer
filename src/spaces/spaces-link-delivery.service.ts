import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { buildSpaceSignInMessage } from '../slack/slack-messages';
import { SlackService } from '../slack/slack.service';
import { WorkspacesService } from '../workspaces/workspaces.service';

/** Someone on the Slack team that owns a Space, reachable by the workspace bot. */
export interface SlackTeammate {
  slackUserId: string;
  botToken: string;
}

/**
 * Delivers Space sign-in links. Gaspo has no email provider, so the one real
 * channel is a Slack DM from the workspace's bot, which reaches anyone on the
 * team that owns the Space. An address outside that team has nowhere to be
 * sent. Outside production the link is also logged, and the API hands it back
 * in its response so a developer can follow it without Slack.
 *
 * Adding email later (SES, Postmark, …) means a second transport in `send` for
 * addresses that are not teammates; nothing else in the feature changes.
 */
@Injectable()
export class SpacesLinkDeliveryService {
  private readonly logger = new Logger(SpacesLinkDeliveryService.name);

  constructor(
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** True outside production, where links may be logged and revealed. */
  get isDev(): boolean {
    return this.configService.get('app.nodeEnv', { infer: true }) !== 'production';
  }

  /**
   * The Slack teammate behind `email` in the Space's workspace, or null when
   * the workspace has no bot installed, the address is not an active person on
   * its Slack team, or Slack did not answer.
   */
  async findTeammate(workspaceId: string, email: string): Promise<SlackTeammate | null> {
    const workspace = await this.workspacesService.findById(workspaceId);
    if (!workspace?.slackBotToken) return null;
    const lookup = await this.slackService.lookupUserByEmail(workspace.slackBotToken, email);
    if (lookup.status !== 'found' || lookup.deleted || lookup.isBot) return null;
    return { slackUserId: lookup.id, botToken: workspace.slackBotToken };
  }

  /** Send a sign-in link. Returns whether it reached anyone. */
  async send(
    teammate: SlackTeammate | null,
    email: string,
    spaceName: string,
    link: string,
  ): Promise<boolean> {
    if (this.isDev) this.logger.log(`Sign-in link for ${email}: ${link}`);
    if (!teammate) return false;
    const message = buildSpaceSignInMessage(spaceName, link);
    const sent =
      (await this.slackService.deliver(teammate.botToken, teammate.slackUserId, message)) !== null;
    if (!sent) this.logger.warn(`Could not DM a sign-in link for Space "${spaceName}"`);
    return sent;
  }
}
