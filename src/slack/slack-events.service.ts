import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../ai/ai.service';
import { UsersService } from '../users/users.service';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { SlackEventEnvelope, SlackMessageEvent } from './interfaces/slack-event.interface';
import { SlackService } from './slack.service';

/**
 * Emoji reacted onto the user's message while Gomer works, then removed once the
 * answer is posted. A bare Slack emoji name (no colons) — swap for a custom
 * workspace spinner (e.g. 'loading') if one is installed.
 */
const PROCESSING_REACTION = 'hourglass_flowing_sand';

/**
 * Turns inbound Slack messages into Gomer runs. An @-mention in a channel or a
 * DM to the bot is treated as a prompt: we resolve the sender to a workspace
 * member (so their connected apps are available), run it through {@link AiService},
 * and post the answer back in-thread. Processing is fire-and-forget — the
 * controller has already acked Slack — so all failures are logged, not thrown.
 */
@Injectable()
export class SlackEventsService {
  private readonly logger = new Logger(SlackEventsService.name);

  /** Recently handled Slack event ids, to drop duplicate deliveries/retries. */
  private readonly seenEventIds = new Set<string>();

  constructor(
    private readonly slackService: SlackService,
    private readonly workspacesService: WorkspacesService,
    private readonly usersService: UsersService,
    private readonly aiService: AiService,
  ) {}

  /** Handle an `event_callback` envelope. Safe to call without awaiting. */
  async handleEventCallback(envelope: SlackEventEnvelope): Promise<void> {
    const event = envelope.event;
    if (!event || !this.isHandledMessage(event)) return;

    if (envelope.event_id) {
      if (this.seenEventIds.has(envelope.event_id)) return;
      this.rememberEventId(envelope.event_id);
    }

    const teamId = envelope.team_id;
    const channel = event.channel;
    const prompt = this.cleanText(event.text ?? '');
    if (!teamId || !channel || !prompt) return;

    const workspace = await this.workspacesService.findBySlackTeamId(teamId);
    if (!workspace?.slackBotToken) {
      this.logger.warn(`No workspace/bot token for Slack team ${teamId}`);
      return;
    }
    const botToken = workspace.slackBotToken;
    // Reply in the same thread for mentions; DMs have no parent to thread under.
    const threadTs = event.thread_ts ?? event.ts;
    const messageTs = event.ts;

    // Signal "processing" by reacting to the user's own message rather than
    // posting a placeholder reply; the reaction is cleared once we answer.
    if (messageTs) {
      await this.slackService.addReaction(botToken, channel, messageTs, PROCESSING_REACTION);
    }

    try {
      const member = event.user
        ? await this.usersService.findBySlackIdentity(workspace.id, event.user)
        : null;

      const result = await this.aiService.run(workspace.id, member?.id ?? null, prompt, {
        sourceName: 'slack',
        // Resolved lazily — only the workspace-stats tool needs it, so we avoid
        // a users.list call on every ordinary message.
        fetchMemberCount: () => this.slackService.countMembers(botToken),
      });

      const answer = result.answer || "I couldn't come up with a response to that.";
      await this.slackService.postMessage(botToken, channel, answer, threadTs);
    } catch (error) {
      this.logger.error(
        `Failed to handle Slack message: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.slackService.postMessage(
        botToken,
        channel,
        '⚠️ Sorry, something went wrong handling that. Please try again.',
        threadTs,
      );
    } finally {
      // Clear the processing indicator whether we answered or errored.
      if (messageTs) {
        await this.slackService.removeReaction(botToken, channel, messageTs, PROCESSING_REACTION);
      }
    }
  }

  /** We act on app_mentions and direct messages, never on bot-authored posts. */
  private isHandledMessage(event: SlackMessageEvent): boolean {
    if (event.bot_id || event.subtype) return false;
    if (event.type === 'app_mention') return true;
    return event.type === 'message' && event.channel_type === 'im';
  }

  /** Strip Slack user mentions (e.g. the bot's own `<@U123>`) and trim. */
  private cleanText(text: string): string {
    return text.replace(/<@[^>]+>/g, '').trim();
  }

  private rememberEventId(eventId: string): void {
    this.seenEventIds.add(eventId);
    // Bound the set so it doesn't grow unbounded in a long-lived process.
    if (this.seenEventIds.size > 1000) {
      const oldest = this.seenEventIds.values().next().value;
      if (oldest) this.seenEventIds.delete(oldest);
    }
  }
}
