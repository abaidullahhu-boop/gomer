import { HttpService } from '@nestjs/axios';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { SLACK_API_BASE_URL, SLACK_OAUTH_AUTHORIZE_URL } from '../common/constants';
import { AppConfig } from '../config/configuration';
import {
  SlackIdentity,
  SlackOAuthAccessResponse,
  SlackUserInfoResponse,
} from './interfaces/slack-oauth.interface';

/**
 * Thin wrapper over the Slack Web API used by the OAuth flow. Other Slack
 * features (events, messaging) will be added to this module in later phases.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /** Builds the Slack OAuth "Add to Slack" authorize URL. */
  buildInstallUrl(state: string): string {
    const slack = this.configService.get('slack', { infer: true });
    const params = new URLSearchParams({
      client_id: slack.clientId,
      scope: slack.scopes,
      redirect_uri: slack.redirectUri,
      state,
    });
    return `${SLACK_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
  }

  /**
   * Exchanges an OAuth code for tokens and resolves the full Slack identity
   * (team + authenticating user profile).
   */
  async exchangeCodeForIdentity(code: string): Promise<SlackIdentity> {
    const slack = this.configService.get('slack', { infer: true });

    const tokenResponse = await firstValueFrom(
      this.httpService.post<SlackOAuthAccessResponse>(
        `${SLACK_API_BASE_URL}/oauth.v2.access`,
        new URLSearchParams({
          client_id: slack.clientId,
          client_secret: slack.clientSecret,
          code,
          redirect_uri: slack.redirectUri,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      ),
    );

    const data = tokenResponse.data;
    if (!data.ok || !data.team || !data.authed_user) {
      this.logger.error(`Slack oauth.v2.access failed: ${data.error ?? 'unknown_error'}`);
      throw new InternalServerErrorException('Slack OAuth exchange failed');
    }

    const botToken = data.access_token ?? null;
    const profile = await this.fetchUserProfile(data.authed_user.id, botToken);

    return {
      slackTeamId: data.team.id,
      teamName: data.team.name,
      slackUserId: data.authed_user.id,
      name: profile.name,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      botToken,
    };
  }

  private async fetchUserProfile(
    slackUserId: string,
    botToken: string | null,
  ): Promise<{ name: string; email: string | null; avatarUrl: string | null }> {
    // Without a bot token we cannot call users.info; fall back to the id.
    if (!botToken) {
      return { name: slackUserId, email: null, avatarUrl: null };
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<SlackUserInfoResponse>(`${SLACK_API_BASE_URL}/users.info`, {
          params: { user: slackUserId },
          headers: { Authorization: `Bearer ${botToken}` },
        }),
      );

      const user = response.data.user;
      if (!response.data.ok || !user) {
        return { name: slackUserId, email: null, avatarUrl: null };
      }

      const profile = user.profile ?? {};
      return {
        name:
          profile.display_name || profile.real_name || user.real_name || user.name || slackUserId,
        email: profile.email ?? null,
        avatarUrl: profile.image_512 ?? profile.image_192 ?? null,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to fetch Slack profile for ${slackUserId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { name: slackUserId, email: null, avatarUrl: null };
    }
  }
}
