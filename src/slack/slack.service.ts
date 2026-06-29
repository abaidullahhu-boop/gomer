import * as crypto from 'crypto';
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
 * Wrapper over the Slack Web API: the OAuth install/exchange flow, request
 * signature verification for the Events API, and posting bot messages.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Verify a Slack request signature (v0 scheme) over the raw request body.
   * Rejects requests older than 5 minutes to blunt replay attacks. Returns
   * false (rather than throwing) so the caller decides the HTTP response.
   */
  verifySignature(
    signature: string | undefined,
    timestamp: string | undefined,
    rawBody: Buffer,
  ): boolean {
    const { signingSecret } = this.configService.get('slack', { infer: true });
    if (!signingSecret || !signature || !timestamp) return false;

    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 60 * 5) return false;

    const base = `v0:${timestamp}:${rawBody.toString('utf8')}`;
    const expected = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');

    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    return (
      expectedBuf.length === actualBuf.length && crypto.timingSafeEqual(expectedBuf, actualBuf)
    );
  }

  /**
   * Post a message to a Slack channel (or DM) as the workspace's bot. Threads
   * the reply when a parent timestamp is given. Best-effort: logs and returns
   * the new message timestamp (so it can be edited later) or null on failure.
   */
  async postMessage(
    botToken: string,
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<string | null> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ ok: boolean; ts?: string; error?: string }>(
          `${SLACK_API_BASE_URL}/chat.postMessage`,
          { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) },
          {
            headers: {
              Authorization: `Bearer ${botToken}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
          },
        ),
      );
      if (!response.data.ok) {
        this.logger.warn(`chat.postMessage failed: ${response.data.error ?? 'unknown_error'}`);
        return null;
      }
      return response.data.ts ?? null;
    } catch (error) {
      this.logger.warn(
        `chat.postMessage error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Edit an existing bot message in place (chat.update). Used to swap a
   * "thinking…" placeholder for the final answer. Best-effort: logs and returns
   * false on failure rather than throwing.
   */
  async updateMessage(
    botToken: string,
    channel: string,
    ts: string,
    text: string,
  ): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ ok: boolean; error?: string }>(
          `${SLACK_API_BASE_URL}/chat.update`,
          { channel, ts, text },
          {
            headers: {
              Authorization: `Bearer ${botToken}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
          },
        ),
      );
      if (!response.data.ok) {
        this.logger.warn(`chat.update failed: ${response.data.error ?? 'unknown_error'}`);
      }
      return response.data.ok;
    } catch (error) {
      this.logger.warn(
        `chat.update error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Add an emoji reaction to a message (reactions.add) — used as a lightweight
   * "processing" indicator on the user's own message instead of a placeholder
   * reply. `name` is the bare emoji name (no colons). Best-effort: logs and
   * returns false on failure (e.g. `already_reacted`, missing reactions:write).
   */
  addReaction(botToken: string, channel: string, timestamp: string, name: string): Promise<boolean> {
    return this.react('reactions.add', botToken, channel, timestamp, name);
  }

  /** Remove a previously added reaction (reactions.remove). Best-effort. */
  removeReaction(
    botToken: string,
    channel: string,
    timestamp: string,
    name: string,
  ): Promise<boolean> {
    return this.react('reactions.remove', botToken, channel, timestamp, name);
  }

  private async react(
    method: 'reactions.add' | 'reactions.remove',
    botToken: string,
    channel: string,
    timestamp: string,
    name: string,
  ): Promise<boolean> {
    try {
      const response = await firstValueFrom(
        this.httpService.post<{ ok: boolean; error?: string }>(
          `${SLACK_API_BASE_URL}/${method}`,
          { channel, timestamp, name },
          {
            headers: {
              Authorization: `Bearer ${botToken}`,
              'Content-Type': 'application/json; charset=utf-8',
            },
          },
        ),
      );
      // `already_reacted` / `no_reaction` are benign races, not real failures.
      if (!response.data.ok && !['already_reacted', 'no_reaction'].includes(response.data.error ?? '')) {
        this.logger.warn(`${method} failed: ${response.data.error ?? 'unknown_error'}`);
      }
      return response.data.ok;
    } catch (error) {
      this.logger.warn(
        `${method} error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  /**
   * Count the human members of the Slack workspace (users.list), excluding bots,
   * Slackbot, and deactivated accounts. Paginates through every page. Needs the
   * `users:read` scope. Best-effort: returns null on failure so callers degrade.
   */
  async countMembers(botToken: string): Promise<number | null> {
    try {
      let cursor: string | undefined;
      let count = 0;
      do {
        const response = await firstValueFrom(
          this.httpService.get<{
            ok: boolean;
            error?: string;
            members?: Array<{ id?: string; is_bot?: boolean; deleted?: boolean }>;
            response_metadata?: { next_cursor?: string };
          }>(`${SLACK_API_BASE_URL}/users.list`, {
            params: { limit: 200, ...(cursor ? { cursor } : {}) },
            headers: { Authorization: `Bearer ${botToken}` },
          }),
        );
        if (!response.data.ok) {
          this.logger.warn(`users.list failed: ${response.data.error ?? 'unknown_error'}`);
          return null;
        }
        for (const member of response.data.members ?? []) {
          if (member.is_bot || member.deleted || member.id === 'USLACKBOT') continue;
          count += 1;
        }
        cursor = response.data.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return count;
    } catch (error) {
      this.logger.warn(
        `users.list error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

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
