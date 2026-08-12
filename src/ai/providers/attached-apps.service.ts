import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/constants';

/** Redis key prefix for a conversation's attached apps, keyed by workspace+thread. */
const ATTACHED_PREFIX = 'ai:attached:';

/**
 * How long a conversation's attachment survives. Long enough to cover the gaps
 * between messages in a real Slack thread, short enough that a thread picked up
 * the next day starts from a fresh routing decision rather than yesterday's.
 */
const ATTACHED_TTL_SECONDS = 2 * 60 * 60;

/**
 * Ceiling on how many actions one app accumulates within a conversation. The
 * union only grows, so without a cap a long thread would drift back toward
 * sending the app's whole catalogue — the thing this exists to avoid.
 *
 * At the ceiling the oldest actions are dropped, never the incoming ones: the
 * turn's own selection is what the current message needs, and evicting that
 * would fail the request it was chosen for.
 */
const MAX_ACTIONS_PER_APP = 24;

/**
 * What a conversation has attached: MCP server name to the actions exposed for
 * it. Keyed by server rather than app because one app connected under both a
 * team and a private account is two servers over different data.
 */
export type AttachedApps = Record<string, string[]>;

/**
 * Remembers which apps a conversation already attached, so a follow-up turn
 * reuses them instead of re-deciding from scratch.
 *
 * This exists for two reasons, one of them expensive. Routing per message made
 * an app blink in and out across a thread: a question that pulled in Google Ads
 * was followed by one that did not, and the follow-up answered from what was
 * already in the transcript rather than from live data — confidently, and
 * without any signal that it had stopped looking. Re-attaching also re-paid the
 * cache write every time, and a cache write is 1.25x the input rate against 0.1x
 * for a read, so the churn — not the token count — was most of the bill.
 *
 * Attachment is therefore append-only within a conversation: what a thread has
 * used once stays available, and the prefix converges to something stable that
 * subsequent turns read from cache.
 *
 * Append-only is what lets the caller keep routing an attached app's actions
 * every turn. Each turn contributes what the current message needs, the record
 * accumulates, and nothing a previous turn relied on is ever taken away — so
 * re-routing is safe, and a thread's later messages are not confined to the
 * capabilities its first one happened to ask for.
 */
@Injectable()
export class AttachedAppsService {
  private readonly logger = new Logger(AttachedAppsService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(workspaceId: string, conversationId: string): string {
    return `${ATTACHED_PREFIX}${workspaceId}:${conversationId}`;
  }

  /**
   * What this conversation has attached so far. Empty for a fresh thread, and
   * empty on any Redis failure — a lost record costs a re-route, never a run.
   */
  async get(workspaceId: string, conversationId: string): Promise<AttachedApps> {
    try {
      const raw = await this.redis.get(this.key(workspaceId, conversationId));
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as AttachedApps) : {};
    } catch (error) {
      this.logger.warn(
        `Could not read attached apps for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {};
    }
  }

  /**
   * Merge this turn's attachment into the conversation's record and return the
   * union, which is what the run should actually send.
   *
   * New actions are appended rather than sorted in. A conversation that has
   * settled renders byte-identical every turn either way, but while it is still
   * growing, appending leaves the existing prefix intact and only the tail is
   * new — where sorting would insert into the middle and invalidate everything
   * after it. An app the caller marks as "everything" (no action list) stays
   * that way — narrowing it later would drop tools mid-conversation.
   */
  async merge(
    workspaceId: string,
    conversationId: string,
    attaching: AttachedApps,
  ): Promise<AttachedApps> {
    const previous = await this.get(workspaceId, conversationId);
    const merged: AttachedApps = { ...previous };

    for (const [appSlug, actions] of Object.entries(attaching)) {
      const before = merged[appSlug];
      // An empty list is the "expose everything" marker; it absorbs any subset.
      if (before?.length === 0 || actions.length === 0) {
        merged[appSlug] = [];
        continue;
      }
      const union = [...new Set([...(before ?? []), ...actions])];
      // Keep the tail: the newest actions are this turn's, and dropping those
      // would break the message that asked for them.
      merged[appSlug] = union.slice(-MAX_ACTIONS_PER_APP);
    }

    await this.write(workspaceId, conversationId, merged);
    return merged;
  }

  /**
   * Set a conversation's record outright, without unioning it with what is
   * already there.
   *
   * Used to hand a conversation's attachment to one branching off it — a Slack
   * thread opening under a message answered in the channel above it. The branch
   * starts from exactly what that turn sent rather than from everything the
   * parent conversation has accumulated, so a topic the branch never mentioned
   * does not follow it in.
   */
  async replace(workspaceId: string, conversationId: string, apps: AttachedApps): Promise<void> {
    await this.write(workspaceId, conversationId, apps);
  }

  private async write(
    workspaceId: string,
    conversationId: string,
    apps: AttachedApps,
  ): Promise<void> {
    try {
      await this.redis.set(
        this.key(workspaceId, conversationId),
        JSON.stringify(apps),
        'EX',
        ATTACHED_TTL_SECONDS,
      );
    } catch (error) {
      // A failed write only means the next turn re-routes; never fail the run.
      this.logger.warn(
        `Could not persist attached apps for ${conversationId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
