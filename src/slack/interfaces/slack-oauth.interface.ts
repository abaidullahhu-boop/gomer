/** Subset of the Slack `oauth.v2.access` response we rely on. */
export interface SlackOAuthAccessResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id: string; name: string };
  authed_user?: {
    id: string;
    scope?: string;
    access_token?: string;
    token_type?: string;
  };
}

/** Subset of the Slack `users.info` response we rely on. */
export interface SlackUserInfoResponse {
  ok: boolean;
  error?: string;
  user?: {
    id: string;
    name?: string;
    real_name?: string;
    profile?: {
      real_name?: string;
      display_name?: string;
      email?: string;
      image_192?: string;
      image_512?: string;
    };
  };
}

/** Normalized Slack identity used by the auth flow. */
export interface SlackIdentity {
  slackTeamId: string;
  teamName: string;
  slackUserId: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  botToken: string | null;
}
