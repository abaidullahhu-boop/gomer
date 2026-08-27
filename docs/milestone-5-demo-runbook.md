# Milestone 5 — Credits, Admin & QA: demo runbook

Milestone 5 (Week 5) has four deliverables. Three were already built and running
in production; the fourth — **full end-to-end QA + security audit** — is the
work of this branch. This runbook is the sign-off script: it proves all four,
half from the dashboard and half from Slack.

| Deliverable | Where it lives |
|---|---|
| Credit system (tracking, top-up, $100 onboarding) | `usage.service.ts`, `billing.service.ts`, `credit_events` + `credit_grants` |
| Slack notification alerts (CPA spikes, ROAS drops, anomalies) | `src/monitoring/`, `anomaly_alerts` |
| Admin dashboard (users, analytics, revenue) | `src/admin/`, `dashboard/admin.tsx` |
| End-to-end QA + security audit | `docs/milestone-5-security-audit.md`, 83 backend tests |

Everything below runs against **production**
(`gomer-7i3jm.ondigitalocean.app`), which is where the Slack app points.

---

## What production actually holds

Measured 2026-08-27 against the prod database. Unlike Milestone 4, every surface
here has real data behind it.

| Fact | State |
|---|---|
| Workspace / users | 1 workspace; 1 admin + 3 members, all active |
| Credits granted | 12,500 (a $100 `onboarding` grant + one $25 `topup`) |
| Credits used | 11,630 across 70 real events |
| **Current balance** | **870 credits — $8.70** |
| Stripe billing mode | **TEST** — `STRIPE_SECRET_KEY` is not a live key, and the webhook secret is set |

The balance being under $10 is worth planning around rather than fixing: it puts
the workspace **below the `LOW_BALANCE_CREDITS = 1000` threshold right now**, so
Step 2's preferred demo works live with no staging at all.

### Record Milestone 5 before Milestone 4

$8.70 is not much runway. The M4 script is eight Slack messages, each a model
call billed against this same ledger, and if it drains to zero mid-take you get
the hard stop on camera in the wrong video. So:

1. Record M5 through the low-balance nudge (Step 2) while the balance is low —
   that is the shot, and it exists for free today.
2. Do the top-up on camera (Step 1). It refills the ledger.
3. Record M4 afterwards, funded by that top-up.

---

## Step 0 — Deploy first (do not skip)

This branch changes **authentication**. The JWT strategy now rejects tokens that
do not carry a well-formed workspace claim, and four other hardening fixes ride
along. No migration is involved, so pushing is enough.

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

### One thing to check the moment it lands

The auth change is the riskiest thing in this milestone — it sits in front of
every authenticated route. Log in to the dashboard **before** you record. If the
page loads and the sidebar shows your workspace, the strategy is accepting
ordinary member tokens and you are clear.

If you are already logged in from before the deploy, your existing access token
still works and will keep working. Nothing about a legitimate session changed.

---

## Step 1 — Credits, from the dashboard

Dashboard → **Billing**.

| # | What to show | What it proves |
|---|---|---|
| 1 | The credit balance tile | Granted / used / remaining, computed as `SUM(grants) − SUM(events)` — never a mutable counter, so it is auditable |
| 2 | The grant history list | The **$100 onboarding grant** is the oldest row on every workspace, including ones that predate the feature (the migration backfilled them) |
| 3 | The four credit packs | $25 / $50 / $100 / $250. 1 credit = 1 cent, so the ledger doubles as the revenue record |

### The top-up, on camera

Click **Scale — $100** → Stripe Checkout opens → pay with `4242 4242 4242 4242`,
any future expiry, any CVC.

You land back on `/dashboard/billing?topup=success`, and the page refetches the
balance by itself on the way in — so it usually shows the new figure with no
input from you. If the webhook is still in flight at that moment the old balance
lingers; refresh once and it lands.

Either way, **say why out loud**: the credit is granted by the *verified
webhook*, not by the browser redirect, so nobody can mint credits by
hand-crafting a success URL. The delay, when you see it, is the security
property working rather than a lag worth apologising for.

> **Use test mode.** Confirm the dashboard's Stripe keys are test keys before
> filming, or that $100 is real money.

---

## Step 2 — The credit gate, from Slack

This is the deliverable most worth demonstrating live, because it is the part
that protects the business: an exhausted workspace stops costing money.

The gate is checked before every model call (`ai.service.ts`), so it applies to
Slack messages, scheduled tasks, and rules alike.

Two ways to show it, in order of preference:

1. **Low-balance nudge** — on a workspace under $10 of credits, Gomer appends a
   "heads up, about $X left" line to its normal answer. Show a normal question
   getting a normal answer *plus* the nudge. **This is live right now** at $8.70;
   nothing needs staging.

   > **Use a brand-new thread, and don't rehearse it in the thread you film.**
   > The nudge claims a Redis slot keyed per conversation for six hours
   > (`LOW_BALANCE_NUDGE_TTL_SECONDS`), so it fires *once* per thread. A thread
   > you tested in will answer normally with no nudge, and you will think the
   > feature is broken. A fresh thread is a fresh key.
2. **Hard stop** — on a workspace at zero, Gomer declines and links the billing
   page instead of calling a model at all.

To stage the hard stop on a throwaway workspace, spend the balance down rather
than deleting grants — the ledger is append-only by design:

```sh
npm run credits -- --workspace <id> --credits -10000 --note "demo drawdown"
```

Then top up on camera and watch the same question start working. That is the
whole loop — meter, gate, top up, resume — in about ninety seconds.

---

## Step 3 — Admin dashboard

Dashboard → **Admin**. The nav item only appears for admins; a member who
navigates directly to `/dashboard/admin` is refused by the API too, not just
hidden in the UI.

| Tab | What to show |
|---|---|
| Overview | Member counts, credit position, usage totals, connected accounts |
| Analytics | Daily credit/token series and top spenders. System runs (rules, scheduled tasks) attribute to "System (rules & tasks)" rather than a person |
| Revenue | Money in vs credits out, split by reason, with the full grant history |
| Users | The roster, including deactivated members |

**Deactivate a member on camera**, then re-activate them. Two guardrails worth
naming while you do it: you cannot deactivate yourself, and you cannot remove
the last active admin — a workspace can never lock itself out.

> **Say the honest thing about timing.** A deactivated member's *existing* access
> token keeps working until it expires, up to 15 minutes. Their refresh is
> refused immediately, so they cannot extend the session and are locked out at
> the next renewal. This is normal for stateless JWTs and is documented in the
> audit; if the client wants instant revocation, that is a token-denylist change
> and belongs in Week 6.

---

## Step 4 — Slack anomaly alerts

The hourly sweep compares each Meta ad account's numbers today against its
trailing 7-day baseline and posts CPA spikes, ROAS drops, and spend spikes to
the workspace's alerts channel. No user-created rule is involved — this is the
proactive layer.

**Set the channel first**, conversationally, because the sweep skips any
workspace that has not named one:

```
remember our alerts channel is #ads-alerts
```

Then show the mechanism. The thresholds are 30% deviation from baseline for
CPA/ROAS and 2× the daily average for spend, with accounts under $10 of spend
today ignored as too thin to judge.

**Do not wait for a live anomaly on camera** — it fires on a real deviation, on
the hour, and it will not cooperate with a recording schedule. Show instead:

- the alerts channel with any alerts that have genuinely fired, and
- the dedup guarantee: each anomaly notifies **at most once per day**, enforced
  by a unique index rather than in-memory state, so two app instances cannot
  double-post the same spike.

```sql
SELECT "adAccountId", metric, day, left(message, 60)
FROM anomaly_alerts ORDER BY "createdAt" DESC LIMIT 10;
```

If the table is empty, say so plainly: it means no account has deviated far
enough to warrant an alert, which is the system working, not failing.

---

## Step 5 — QA and the security audit

This is the fourth deliverable and it is a document, not a screen. Walk the
client through `docs/milestone-5-security-audit.md`.

The headline is worth stating directly, because it was a real hole found and
closed in this milestone rather than a checklist item:

> A Space end-user's session token was accepted by the workspace API. Space
> sessions are signed with the same secret as member tokens, and the workspace
> strategy checked only the signature — not the claims. `GET /billing/summary`
> answered **200** to a Space visitor with every credit grant in the table:
> workspace ids, amounts paid, Stripe session ids, across all tenants. It now
> answers **401**. Reproduced end to end, before and after.

Four smaller findings were fixed alongside it: a Stripe retry storm on duplicate
webhook deliveries, a membership oracle on the magic-link endpoint, auth tokens
written into request logs, and no rate limiting anywhere on the API.

Gates, all green on this branch:

```sh
npm run build     # clean
npm run lint      # clean
npm test          # 83 pass, 0 fail
```

21 of those 83 tests are new and were written to lock these five fixes in place,
including one that mints a Space-scoped token and asserts the workspace strategy
refuses it.

---

## If something goes wrong mid-recording

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard logs you out after the deploy | Stored token predates the workspace claim check | Log in again — one time only, then it is stable |
| Balance unchanged after paying | Webhook not delivered | Check the Stripe dashboard's webhook log; `STRIPE_WEBHOOK_SECRET` must match the endpoint's signing secret |
| Top-up succeeds but credits arrive twice | Should be impossible — unique index on the session id | Capture the grant rows; this would be a real bug |
| Admin nav item missing | Signed in as a member, not an admin | Switch accounts |
| `429 Too many requests` | You hit a new rate limit while testing | Wait out the 15-minute window, or use a different account |
| Anomaly alert never posts | No alerts channel fact, or no Meta connection | `remember our alerts channel is #…`; confirm Meta is connected as Team |
| Alerts channel set but still silent | No account deviated enough | Expected. Show the empty `anomaly_alerts` table and explain the thresholds |

---

## Known gaps (flagged, not blocking)

Three things the audit surfaced that are **not** fixed on this branch, each a
deliberate call rather than an oversight. They are listed in full with rationale
in the audit document.

- **Meta OAuth tokens are stored unencrypted** in `integrations`. They never
  leave the server and the API projects a safe subset to clients, but at-rest
  encryption needs a key-management decision and a migration. Week 6 candidate.
- **Revoking a member is not instant** — up to 15 minutes, as described in
  Step 3.
- **Space records are visible to every end-user of that Space.** For a shared
  team app that is correct; for a Space collecting private per-person
  submissions it is not. Worth confirming the intent with the client before
  anyone builds the second kind.
