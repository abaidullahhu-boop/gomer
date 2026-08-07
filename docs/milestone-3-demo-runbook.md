# Milestone 3 — clean-room demo runbook

Reset both ad platforms, reconnect them on camera, and drive the whole flow from
Slack. Follow top to bottom; the ordering matters more than it looks.

Everything below runs against **production** (`gomer-7i3jm.ondigitalocean.app`),
which is where the Slack app currently points.

---

## Step 0 — Deploy first (do not skip)

Production runs `6f41f05`. The action-level allowlist and sticky attachment are
not in it. Record before deploying and you film the old behaviour: "list my ads
accounts" answers Meta-only, and each Google Ads message costs ~$0.23.

```sh
git add -A && git commit -m "perf: allowlist MCP actions and keep apps attached per thread"
git push origin main          # deploy_on_push is on for main
```

Wait for the deployment to go ACTIVE (~4-6 min), then confirm the running commit
matches your HEAD before recording anything:

```sh
npm run deployed                 # prints e.g. "ACTIVE a1b2c3d"
git rev-parse --short HEAD       # must match
```

(`doctl` is installed via snap on this machine and fails with a confinement
error, so `npm run deployed` calls the DigitalOcean API directly instead.)

**Gate:** do not start recording until those two hashes match. Filming against
the previous build is the easiest way to record behaviour you already fixed.

---

## Step 1 — Tear down the current state

### 1a. Delete the old demo campaign

`Milestone 3 Demo` (id `120253117340500195`, 8,000 PKR/day, paused) still exists
in KIVOVA. Delete it in Meta Ads Manager so you can create it live on camera.

### 1b. Disconnect both integrations in Gomer

Dashboard → **Integrations** → find the account → **Disconnect**. Do this for:

- **Google Ads** (`mubashar's GOOGLE ads`)
- **Meta Ads** (`Abdul Rehman`)

Disconnecting Google Ads also revokes the account at Pipedream, so the reconnect
is a genuinely fresh OAuth rather than a silent re-link.

### 1c. Revoke at the providers — this is what makes the recording look real

Gomer's disconnect drops the local tokens, but **Facebook and Google still have
the app authorised**. Reconnect without revoking and the OAuth consent screen
flashes past, so the recording never shows the permission grant — the part a
client most wants to see.

- **Meta**: facebook.com → Settings & Privacy → Settings → **Business
  Integrations** → find Gomer → **Remove**.
- **Google**: myaccount.google.com/permissions → find the Pipedream/Gomer entry →
  **Remove access**.

---

## Step 2 — Reconnect on camera

Order matters: connect **Meta first, Google Ads second**. Meta is the native
integration with the richer consent screen, so it opens the recording strongly.

### 2a. Meta Ads

1. Dashboard → **Integrations** → **Connect** on Meta Ads.
2. Facebook login → business selection → permission screen.
3. Grant the ad-account scopes.
4. Land back on Integrations and confirm the account appears.

### 2b. Google Ads

1. Dashboard → **Integrations** → search **Google Ads** → **Connect**.
2. Pipedream Connect popup → Google account → permission screen.
3. Confirm the account appears alongside Meta.

> **Set both to Team (shared), not Private.** A private connection is visible
> only to the member who made it. The Slack account you demo from is a different
> member than the one connecting here, so a private connection would leave Gomer
> answering "no ads account connected" on camera. This is the same scoping trap
> that caused the Gmail incident.

---

## Step 3 — Drive it from Slack

**Start a brand-new thread.** Do not reuse the thread from the earlier test — it
carries conversation memory of the old campaign, and Gomer will reference things
that are no longer there.

Send these one at a time, waiting for each reply:

| # | Message | What it proves |
|---|---|---|
| 1 | `list my ads accounts` | **The headline.** Returns Meta *and* Google Ads together — this is the fix. |
| 2 | `any campaigns running anywhere?` | Cross-platform read, and the app stays attached on a follow-up (no stale answer). |
| 3 | `create a paused traffic campaign called "Milestone 3 Demo" with a 5000 PKR daily budget` | Gomer asks which account — disambiguation. |
| 4 | `Kivova` | Approval card appears. **Click Approve on camera.** |
| 5 | `show me my campaigns` | Read-back verification: the new campaign, paused. |
| 6 | `change the Milestone 3 Demo daily budget to 8000 PKR` | Second approval gate. Approve. |
| 7 | `show campaigns now` | Confirms 8,000 PKR/day. |

### Two things to avoid on camera

- **Don't demo a Google Ads write.** Approval gating is Meta-only right now
  (`META_ADS_WRITE_TOOL_NAMES` in `ai.service.ts`). A Google Ads budget change
  would execute with no Approve button — an inconsistency you don't want the
  client to discover mid-demo. Keep Google Ads to reads.
- **Don't paraphrase message 1.** "list my ads accounts" with no platform named
  is precisely the case the old router got wrong. It's the shot worth having.

---

## Step 4 — Verify after recording

Check the router did what it should. In the production logs, per message you
want to see:

```
App router kept 2/2 connected apps for this run (google_ads, gmail)
Action router kept 3/35 actions for this run
```

`Action router kept N/35` is the allowlist working. `App router kept 2/2` on
message 1 is the bias fix working.

Then pull the cost for the session and compare against the last run — the same
seven-message demo, plus a whole extra platform, should land near the earlier
Meta-only figure rather than multiples of it.

---

## If something goes wrong mid-recording

| Symptom | Cause | Fix |
|---|---|---|
| "No ads account connected" | Connection was made Private | Disconnect, reconnect as Team |
| Only Meta accounts listed | Deploy didn't land | Check the deployed commit; re-record after it does |
| Google Ads answer looks stale | Reused an old Slack thread | Start a fresh thread |
| Approve button never appears | Meta connection missing/expired | Reconnect Meta |
