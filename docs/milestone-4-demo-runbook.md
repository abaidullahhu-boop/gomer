# Milestone 4 — Automation & Memory: demo runbook

Milestone 4 (Week 4) has four deliverables. Three were already built and running
in production; the fourth — **Google Sheets export automation** — is new in this
branch. This runbook is the sign-off script: it proves all four from Slack.

| Deliverable | Where it lives |
|---|---|
| Stripe ROAS verification layer | `stripe.service.ts`, `roas.service.ts`, `roas_snapshots` |
| Google Sheets export automation | `sheets.service.ts` (via Pipedream Connect proxy), `src/exports/`, `scheduled_exports` |
| Automated rule engine | `src/rules/`, `ad_rules` + `ad_rule_actions` |
| Workspace memory layer | `src/memory/`, `workspace_memory` |

Everything below runs against **production**
(`gomer-7i3jm.ondigitalocean.app`), which is where the Slack app points.

---

## Step 0 — Deploy first (do not skip)

The Sheets export is new code **and a new table**. The schema migration
(`ScheduledExports1730000000000`) runs automatically as the `migrate` PRE_DEPLOY
job, so pushing is enough — but the export tools do not exist until it lands.

```sh
git push origin main          # deploy_on_push is on for main
```

Wait for the deployment to go ACTIVE (~4-6 min), then confirm the running commit
matches your HEAD before recording anything:

```sh
npm run deployed                 # prints e.g. "ACTIVE a1b2c3d"
git rev-parse --short HEAD       # must match
```

**Gate:** do not start recording until those two hashes match.

---

## Step 1 — Connect Google Sheets

Dashboard → **Integrations** → search **Google Sheets** → **Connect**.

> **Set it to Team (shared), not Private.** A private connection is visible only
> to the member who made it, and the Slack account you demo from is a different
> member — a private connection would leave Gomer answering "Google Sheets isn't
> connected" on camera. Same scoping trap as the Gmail incident.

**Grant write access on the Google consent screen.** A read-only grant fails at
the first write with `Request had insufficient authentication scopes`. If that
happens, revoke at myaccount.google.com/permissions and reconnect.

Meta Ads and Stripe should already be connected from the Milestone 3 demo. The
campaign-performance export needs Meta; the verified-ROAS export needs both.

### Verify the proxy before you record

Sheets calls go through the **Pipedream Connect proxy**, so Pipedream holds the
Google credential and refreshes it — we never store a Google token. Pipedream
allowlists proxy destinations **per app**, and that is worth confirming once for
`google_sheets` before filming:

```sh
npm run probe:sheets              # read-only: proves the proxy reaches Google
PROBE_WRITE=1 npm run probe:sheets   # also creates a throwaway sheet
```

A Google `404` for the fake id is the **good** result — it means the proxy
forwarded an authenticated request. `Domain sheets.googleapis.com is not allowed
for this app` means Pipedream will not proxy to Sheets for this app; the export
then falls back to calling Google directly with the stored token, which still
works but is the path we would rather not be on. (Measured: the `google` app is
rejected for that domain, so do not substitute it for `google_sheets`.)

---

## Step 2 — Drive it from Slack

**Start a brand-new thread.** An old thread carries conversation memory of
earlier campaigns and Gomer will reference things that no longer exist.

Send these one at a time, waiting for each reply:

| # | Message | What it proves |
|---|---|---|
| 1 | `our target ROAS is 3` | **Memory write.** Saved silently as a durable fact — no "I've noted that" theatre. |
| 2 | `what's our real ROAS for the last 7 days?` | **Stripe verification.** Meta spend paired with actual Stripe revenue, compared against the target from message 1, with the blended-revenue caveat stated. |
| 3 | `export our verified ROAS history to a spreadsheet` | **The headline.** Creates the sheet, writes headers + rows, returns a link. Open it on camera. |
| 4 | `every Monday at 8am put last week's campaign performance in that same sheet` | Recurring export created. Gomer should confirm the terms first and reuse the spreadsheet from message 3 rather than making a second one. |
| 5 | `run that export now` | Runs it off-schedule so the new tab appears live instead of waiting until Monday. |
| 6 | `what reports are running?` | Lists the schedule, destination, last run, and row count. |
| 7 | `every night at 2am pause any campaign whose CPA over the last 3 days is above 40` | **Rule engine.** Gomer states metric/threshold/window/action/schedule/guardrails and asks for confirmation. |
| 8 | `yes` | Rule created. |

### Two things to avoid on camera

- **Don't demo a Google Ads write.** Approval gating is Meta-only
  (`META_ADS_WRITE_TOOL_NAMES` in `ai.service.ts`) — unchanged from Milestone 3.
- **Don't ask for an export in a thread where Sheets isn't connected.** The tools
  are only offered when the workspace has a Google Sheets connection, so Gomer
  will correctly say it can't — accurate, but not the shot you want.

---

## Step 3 — Show the spreadsheet

Open the link from message 3. Two tabs, each with its own header row:

- **Verified ROAS** — Verified At, Ad Account, window, Meta Spend, Stripe
  Revenue, Verified ROAS, Purchases, Verified CPA, Caveats.
- **Campaign Performance** — Exported At, window, Campaign, Spend, Impressions,
  Clicks, CTR, CPC, Purchases, CPA, Meta ROAS.

Numbers land as numbers, not text, so they sort and chart in Sheets directly.

The point worth making out loud: **run it again and it appends, it doesn't
duplicate.** Each scheduled run resumes from the newest row it already wrote, so
the sheet accumulates a history instead of repeating one.

---

## Step 4 — Verify after recording

In the production logs, per exported message you want to see the export tool
dispatched locally (not as an MCP round-trip):

```
Sheets export tool export_to_sheet ...       # only on failure — silence is success
Export <id> (<name>) failed: ...             # likewise
```

Then check the row persisted correctly:

```sql
SELECT name, dataset, "cronExpression", "spreadsheetId",
       "lastRun", "lastRowCount", "lastError"
FROM scheduled_exports ORDER BY "createdAt" DESC LIMIT 5;
```

`lastError` NULL and `lastRowCount` > 0 is a healthy run. (Prod DB access goes
through the DO app console — there is no external route to `gomer-db`.)

---

## If something goes wrong mid-recording

| Symptom | Cause | Fix |
|---|---|---|
| "Google Sheets isn't connected" | Connection was made Private | Disconnect, reconnect as Team |
| `insufficient authentication scopes` | Read-only Google grant | Revoke at myaccount.google.com/permissions, reconnect, grant write |
| `Domain … is not allowed for this app` | Pipedream won't proxy to Sheets for this app | Nothing to do mid-demo — the export falls back to a direct Google call automatically. Raise it with Pipedream afterwards. |
| Export tools missing entirely | Deploy didn't land | Check the deployed commit; re-record after it does |
| Second spreadsheet created on message 4 | Sheet id wasn't remembered | Name the spreadsheet id explicitly, or ask Gomer to remember it first |
| Rule confirmation never appears | Meta connection missing/expired | Reconnect Meta |

---

## Known gap (flagged, not blocking)

Rules, memory, ROAS snapshots, and exports are all managed **through chat only** —
there is no dashboard page for them. Milestone 4 is scoped as backend work
(Weeks 1–2 were the frontend), so this is consistent with the plan, but it is
worth raising with the client if they expect a UI surface for these in Week 6.
