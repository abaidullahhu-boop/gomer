import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AiService } from '../ai/ai.service';
import { REDIS_CLIENT } from '../common/constants';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { APPROVE_ACTION_ID, CANCEL_ACTION_ID, buildResolvedBlocks } from './slack-messages';
import { SlackService } from './slack.service';

/** How long a pending approval waits for a button click before expiring. */
const APPROVAL_TTL_SECONDS = 900;
const APPROVAL_PREFIX = 'slack:approval:';

/** A gated write awaiting a Slack button approval, stashed in Redis by token. */
export interface PendingApproval {
  workspaceId: string;
  /** The member who asked — used to scope the Meta token and to gate approval. */
  requesterUserId: string | null;
  requesterSlackId: string;
  requesterName: string;
  teamId: string;
  channel: string;
  threadTs?: string;
  /** ts of the approval message, so it can be edited once resolved. */
  messageTs: string;
  toolName: string;
  input: Record<string, unknown>;
  label: string;
  /** Gomer's original description of the action, re-rendered on resolution. */
  answer: string;
}

/** The parts of a Slack `block_actions` interaction payload we act on. */
interface BlockActionsPayload {
  type?: string;
  user?: { id?: string; name?: string; username?: string };
  team?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
}

/**
 * Handles Slack interactive-component callbacks — specifically the Approve/Cancel
 * buttons on a gated action card. The pending action is held in Redis (single
 * use, TTL-bounded); Approve executes it via {@link AiService.executeMetaAdsAction}
 * and posts the result, Cancel discards it. Only the original requester may
 * approve, so a stray click can't spend money.
 */
@Injectable()
export class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
    private readonly aiService: AiService,
  ) {}

  /** Stash a pending approval under a fresh token and return it (for the button). */
  async storePending(record: PendingApproval): Promise<string> {
    const token = randomUUID();
    await this.redis.set(
      `${APPROVAL_PREFIX}${token}`,
      JSON.stringify(record),
      'EX',
      APPROVAL_TTL_SECONDS,
    );
    return token;
  }

  /**
   * Record the timestamp of the approval message once it's posted, so the
   * callback can edit that message in place when the action is resolved. The
   * token exists before the message is posted, so this patches it after.
   */
  async attachMessageTs(token: string, messageTs: string): Promise<void> {
    const key = `${APPROVAL_PREFIX}${token}`;
    const raw = await this.redis.get(key);
    if (!raw) return;
    const record = JSON.parse(raw) as PendingApproval;
    record.messageTs = messageTs;
    await this.redis.set(key, JSON.stringify(record), 'EX', APPROVAL_TTL_SECONDS);
  }

  /** Route an interaction payload. Safe to call without awaiting (fire-and-forget). */
  async handleInteraction(payload: BlockActionsPayload): Promise<void> {
    if (payload.type !== 'block_actions') return;
    const action = payload.actions?.[0];
    const token = action?.value;
    const actionId = action?.action_id;
    const responseUrl = payload.response_url;
    if (!token || !actionId) return;

    const raw = await this.redis.get(`${APPROVAL_PREFIX}${token}`);
    if (!raw) {
      if (responseUrl) {
        await this.slackService.respondEphemeral(
          responseUrl,
          'This approval has expired or was already handled.',
        );
      }
      return;
    }
    const pending = JSON.parse(raw) as PendingApproval;

    const workspace = await this.workspacesService.findBySlackTeamId(pending.teamId);
    const botToken = workspace?.slackBotToken;
    if (!botToken) {
      this.logger.warn(`No bot token for Slack team ${pending.teamId} on interaction`);
      return;
    }

    const clickerId = payload.user?.id ?? '';
    const clickerName = payload.user?.name || payload.user?.username || 'someone';

    if (actionId === CANCEL_ACTION_ID) {
      // Anyone can cancel, but only the requester's own cancel is expected.
      await this.redis.del(`${APPROVAL_PREFIX}${token}`);
      await this.slackService.updateMessage(
        botToken,
        pending.channel,
        pending.messageTs,
        pending.answer,
        buildResolvedBlocks(pending.answer, `:x: Cancelled by ${clickerName}`),
      );
      return;
    }

    if (actionId !== APPROVE_ACTION_ID) return;

    // Only the person who asked may approve — a guardrail on live spend.
    if (clickerId !== pending.requesterSlackId) {
      if (responseUrl) {
        await this.slackService.respondEphemeral(
          responseUrl,
          `Only ${pending.requesterName} can approve this action.`,
        );
      }
      return;
    }

    // Consume the token first so a double-click can't execute twice.
    await this.redis.del(`${APPROVAL_PREFIX}${token}`);
    await this.slackService.updateMessage(
      botToken,
      pending.channel,
      pending.messageTs,
      pending.answer,
      buildResolvedBlocks(
        pending.answer,
        `:white_check_mark: Approved by ${clickerName} — running…`,
      ),
    );

    const { ok, summary } = await this.aiService.executeMetaAdsAction(
      pending.workspaceId,
      pending.requesterUserId,
      pending.toolName,
      pending.input,
    );

    await this.slackService.postMessage(
      botToken,
      pending.channel,
      ok ? `:white_check_mark: ${summary}` : `:warning: ${summary}`,
      pending.threadTs,
    );
  }
}
