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

## What production actually holds

Measured 2026-08-27 with `npm run probe:roas` and a direct read of the prod
database. This decides what can be filmed and what cannot, so read it first.

| Fact | State |
|---|---|
| Meta token scopes | `ads_management`, `ads_read`, `business_management` — all granted |
| Meta ad accounts | `act_1471210033594550` (0 campaigns), `act_1709976226241899` KIVOVA (3 campaigns, **all PAUSED**) |
| Meta spend, trailing 365 days | **0.00** on both accounts — no insight rows at all |
| Stripe connection | **none** |
| `roas_snapshots` / `ad_rules` / `ad_rule_actions` | 0 / 0 / 0 |
| `scheduled_exports` / `workspace_memory` / `anomaly_alerts` | 0 / 0 / 0 |
| Google Sheets proxy | **working** — `apn_AVhXbQO` (team); Google answers 404 to a fake id, so the proxy forwards authenticated |

Two consequences:

- **Verified ROAS cannot be demonstrated.** `RoasService.verify` throws
  `No active Stripe connection is available.` before computing anything, and
  even with Stripe connected, Meta contributes spend 0. Do not send the ROAS
  question on camera — it returns an error, not a number.
- **Exports will write headers and zero data rows.** Both `roas_snapshots` and
  `campaign_insights` are empty for this workspace, and paused campaigns with no
  delivered spend produce no insights. The export *mechanism* is fully
  demonstrable; the data is not. Say so plainly rather than letting the client
  notice an empty sheet.

What is still real and live on camera: the memory write, the rule engine with
its confirmation gate, the scheduled export being created, run, and listed, and
the Automations page reflecting all of it afterwards.

> **Record Milestone 5 first.** The workspace balance is $8.70, and the eight
> messages below are eight model calls billed against it. Milestone 5's top-up
> beat refills the ledger, so filming M5 first both captures its low-balance
> nudge while it is genuinely low and funds this recording. See the M5 runbook.

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

Meta Ads is connected in production. **Stripe is not** — verified as of
2026-08-27, there is no `stripe` row in the production `integrations` table at
all. The campaign-performance export needs Meta; the verified-ROAS export needs
both. See "What production actually holds" below before you plan the take.

### Verify the proxy before you record — this one is a hard gate

Every Sheets call goes through the **Pipedream Connect proxy**, and there is no
other path: Pipedream holds the Google credential and refreshes it, and we never
store a Google token. Pipedream allowlists proxy destinations **per app**, so if
`google_sheets` is not allowed to reach `sheets.googleapis.com`, exports do not
work at all. Confirm it before filming:

```sh
npm run probe:sheets                 # read-only: proves the proxy reaches Google
PROBE_WRITE=1 npm run probe:sheets   # also creates a throwaway sheet
```

A Google `404` for the fake id is the **good** result — it means the proxy
forwarded an authenticated request. `Domain sheets.googleapis.com is not allowed
for this app` is a stop sign: raise it with Pipedream before recording, because
nothing downstream will work. (Measured: the `google` app *is* rejected for that
domain, so do not substitute it for `google_sheets`.)

---

## Step 2 — Drive it from Slack

**Start a brand-new thread.** An old thread carries conversation memory of
earlier campaigns and Gomer will reference things that no longer exist.

Send these one at a time, waiting for each reply:

| # | Message | What it proves |
|---|---|---|
| 1 | `our target ROAS is 3` | **Memory write.** Saved silently as a durable fact — no "I've noted that" theatre. |
| 2 | `what do you remember about us?` | Reads the fact back, proving it persisted rather than living in the thread. |
| 3 | `export last week's campaign performance to a spreadsheet` | **The headline.** Creates the sheet, writes the header contract, returns a link. Open it on camera — and say up front that the connected ad account has no delivered spend, so the rows are empty by construction, not by failure. |
| 4 | `every Monday at 8am put last week's campaign performance in that same sheet` | Recurring export created. Gomer should confirm the terms first and reuse the spreadsheet from message 3 rather than making a second one. |
| 5 | `run that export now` | Runs it off-schedule so the write happens live instead of waiting until Monday. |
| 6 | `what reports are running?` | Lists the schedule, destination, last run, and row count. |
| 7 | `every night at 2am pause any campaign whose CPA over the last 3 days is above 40` | **Rule engine.** Gomer states metric/threshold/window/action/schedule/guardrails and asks for confirmation. |
| 8 | `yes` | Rule created. |

> **Do not send a verified-ROAS question.** `what's our real ROAS…` throws
> `No active Stripe connection is available.` in production today. The
> Stripe-verification deliverable is covered in Step 5 instead, as code and
> schema rather than a live answer.

### Two things to avoid on camera

- **Don't demo a Google Ads write.** Approval gating is Meta-only
  (`META_ADS_WRITE_TOOL_NAMES` in `ai.service.ts`) — unchanged from Milestone 3.
- **Don't ask for an export in a thread where Sheets isn't connected.** The tools
  are only offered when the workspace has a Google Sheets connection, so Gomer
  will correctly say it can't — accurate, but not the shot you want.

---

## Step 3 — Show the spreadsheet

Open the link from message 3. The **Campaign Performance** tab carries its
header row: Exported At, window, Campaign, Spend, Impressions, Clicks, CTR, CPC,
Purchases, CPA, Meta ROAS.

**Set expectations before you scroll.** The connected ad account's three
campaigns are all paused and have never delivered, so Meta returns no insight
rows and the tab is headers only. That is the documented contract, not a
failure — `export-tables.spec.ts` pins "an empty dataset still carries its header
contract" precisely so a quiet window produces a valid sheet instead of a broken
one. Show the row count Gomer reports back (0) and the `lastRowCount` column in
Step 4; the honest version of this beat is stronger than a surprised one.

Two points worth making out loud regardless:

- **Numbers land as numbers, not text**, so once rows exist they sort and chart
  in Sheets directly.
- **Run it again and it appends, it doesn't duplicate.** Each scheduled run
  resumes from the newest row it already wrote, so the sheet accumulates a
  history instead of repeating one.

If the client wants to see populated rows, that needs an ad account with
delivered spend — see Step 5.

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

`lastError` NULL is a healthy run. `lastRowCount` will be **0** for this
workspace — see Step 3; a non-zero count only appears once an ad account with
delivered spend is connected. (Prod DB access goes through the DO app console —
there is no external route to `gomer-db`.)

---

## Step 5 — Stripe ROAS verification, without a live number

This deliverable is built and tested but cannot be run on camera today: there is
no Stripe connection in production, and the connected Meta accounts have never
spent. Cover it honestly rather than skipping it.

Walk the client through the mechanism:

- `RoasService.verify` pairs Meta account-level spend with **actual Stripe
  charge revenue**, net of refunds, over the same window — the check on Meta's
  self-attributed conversions.
- It refuses to compute across currencies, and always attaches the caveat that
  revenue is *all* Stripe revenue in the window, not only ad-attributed
  purchases — so the client is told it is blended ROAS, not a precise
  attribution claim.
- Every verification persists a `roas_snapshots` row, which is what makes the
  history queryable and exportable.

Then state the gap plainly: **to produce a real verified ROAS the client needs to
connect Stripe and supply an ad account with delivered spend.** Both are theirs
to provide; neither is a code change. `npm run probe:roas` reports exactly what
each side is missing and is the fastest way to confirm once they do.

---

## If something goes wrong mid-recording

| Symptom | Cause | Fix |
|---|---|---|
| "Google Sheets isn't connected" | Connection was made Private | Disconnect, reconnect as Team |
| `insufficient authentication scopes` | Read-only Google grant | Revoke at myaccount.google.com/permissions, reconnect, grant write |
| `Domain … is not allowed for this app` | Pipedream won't proxy to Sheets for this app | Not fixable mid-demo — exports have no other path. Stop, raise it with Pipedream, re-record. `npm run probe:sheets` catches this beforehand. |
| Export tools missing entirely | Deploy didn't land | Check the deployed commit; re-record after it does |
| Second spreadsheet created on message 4 | Sheet id wasn't remembered | Name the spreadsheet id explicitly, or ask Gomer to remember it first |
| Rule confirmation never appears | Meta connection missing/expired | Reconnect Meta |
| `No active Stripe connection is available.` | You asked a verified-ROAS question | Expected in production — Stripe is not connected. Do not send that question; cover it via Step 5 |
| Export sheet has headers but no rows | Ad account has no delivered spend | Expected — see Step 3. Not a failure; state it before opening the sheet |

---

## Known gap — since closed for reading

Rules, memory, ROAS snapshots, and exports were originally managed **through chat
only**, with no dashboard page. Milestone 4 was scoped as backend work (Weeks 1–2
were the frontend), so that was consistent with the plan.

**Resolved in Week 6:** the dashboard's **Automations** page now reports all four
— rules with their recent activity, scheduled reports, remembered facts, and
verified-ROAS history. It is deliberately **read-only**: creating a rule
conversationally makes Gomer state the metric, threshold, window, action and
guardrails and ask for confirmation, which a form would reproduce worse. So the
demo above is still the way to *create* these; the page is where you show what is
running afterwards.
