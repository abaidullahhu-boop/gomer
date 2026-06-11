import { UserRole } from '../enums';

/**
 * Claims encoded inside the access / refresh JWTs.
 */
export interface JwtPayload {
  /** User id (UUID). */
  sub: string;
  /** Workspace id the user belongs to (UUID). */
  workspaceId: string;
  /** Slack user id. */
  slackUserId: string;
  /** User role within the workspace. */
  role: UserRole;
}

/**
 * Shape attached to `request.user` after the JWT strategy validates a token.
 */
export interface AuthenticatedUser {
  userId: string;
  workspaceId: string;
  slackUserId: string;
  role: UserRole;
}
