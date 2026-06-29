/**
 * Minimal typings for the slice of the Slack Events API we consume. Slack sends
 * far more fields than these; we type only what the chat handler reads.
 */

/** A single message-like event (app_mention or a DM message). */
export interface SlackMessageEvent {
  type: string;
  /** Present on bot-authored messages; used to ignore our own posts. */
  bot_id?: string;
  subtype?: string;
  user?: string;
  text?: string;
  channel?: string;
  /** "im" for direct messages, "channel"/"group" otherwise. */
  channel_type?: string;
  ts?: string;
  thread_ts?: string;
}

/** The outer envelope Slack POSTs to the events endpoint. */
export interface SlackEventEnvelope {
  type: 'url_verification' | 'event_callback' | string;
  /** Present on url_verification handshakes. */
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: SlackMessageEvent;
}
