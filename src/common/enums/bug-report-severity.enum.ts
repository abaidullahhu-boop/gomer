/**
 * How badly the reporter is blocked.
 *
 * Set by the person filing the report, so it is a claim rather than a
 * judgement — the owner re-reads it in triage. Kept as the reporter's own words
 * anyway: "I can't work" and "this is untidy" are the two ends of the queue,
 * and only they know which one they are.
 */
export enum BugReportSeverity {
  /** Cosmetic or a small annoyance; the work still gets done. */
  LOW = 'low',
  /** Something is wrong but there is a way around it. */
  MEDIUM = 'medium',
  /** A core flow is broken and there is no workaround. */
  HIGH = 'high',
  /** Nobody in the workspace can work, or data looks wrong. */
  CRITICAL = 'critical',
}
