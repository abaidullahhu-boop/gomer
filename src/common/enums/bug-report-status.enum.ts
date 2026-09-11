/**
 * Where a reported bug sits in triage.
 *
 * Deliberately short. A longer pipeline (triaged, confirmed, in review…) is a
 * bug tracker, and this is an inbox — the value it adds over an email is that a
 * report arrives with the workspace, user and app state already attached, not
 * that it models a workflow.
 */
export enum BugReportStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  /** Not a bug, a duplicate, or not reproducible — closed without a fix. */
  DISMISSED = 'dismissed',
}
