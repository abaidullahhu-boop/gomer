# Operations & handover

Everything needed to run, deploy, debug, and take ownership of gomer.ai. Written
for whoever inherits the codebase.

- [Hosting topology](#hosting-topology)
- [Routing — the `/api` prefix](#routing)
- [Deploying](#deploying)
- [Environment variables in production](#environment-variables-in-production)
- [Pointing a custom domain](#pointing-a-custom-domain)
- [The Slack app: local vs production](#the-slack-app-local-vs-production)
- [Local Slack development](#local-slack-development)
- [Querying the production database](#querying-the-production-database)
- [Integration scoping: team vs private](#integration-scoping-team-vs-private)
- [Known launch blockers](#known-launch-blockers)
- [Rollback](#rollback)

---

## Hosting topology

One **DigitalOcean App Platform** app named `gomer`
(id `a193439a-bad8-47f5-9843-60751e9b7a71`), currently at
`https://gomer-7i3jm.ondigitalocean.app`.

| Component | Kind | Source | Serves |
| --- | --- | --- | --- |
| `api` | service, port 3000 | `abaidullahhu-boop/gomer` | The NestJS backend |
| `web` | static site | `abaidullahhu-boop/gomer.ai-FE` | The React dashboard (`catchall_document: index.html`) |
| `migrate` | PRE_DEPLOY job | `abaidullahhu-boop/gomer` | `npm run migration:run:prod` |

The database is `gomer-db`, an App Platform **dev** Postgres attached to the app.
Redis is likewise managed and injected by URL.

Both repositories deploy on push to `main`. They are **separate repos** with
separate deploys — a frontend change does not redeploy the API, and vice versa.

---

## Routing

DigitalOcean's ingress splits traffic by path prefix:

```
/api/*  →  api      (prefix stripped before it reaches Nest)
/*      →  web      (the SPA)
```

Two consequences that cost time if you don't know them:

1. **Nest routes are unprefixed in code.** There is no `setGlobalPrefix`. The
   `/api` prefix exists only at the DO router, which strips it. So
   `@Get('health')` is `GET /api/health` in production and `GET /health` locally.
2. **Hitting the production host without `/api` returns the SPA, not the API.**
   You get a 200 and a page of HTML, which looks like a broken endpoint rather
   than a wrong URL. Any external URL you configure — Slack, Meta, Stripe — must
   include `/api`.

---

## Deploying

```bash
git push origin main         # deploy_on_push is enabled
npm run deployed             # prints "<phase> <commit>", e.g. "ACTIVE d9cd7ba"
git rev-parse --short HEAD   # must match before you trust what you're seeing
```

A deploy takes roughly 4–6 minutes through `BUILDING → DEPLOYING → ACTIVE`.
Migrations run as the PRE_DEPLOY job, so a failing migration **aborts the deploy**
rather than half-applying — the previous version keeps serving.

`npm run deployed` uses the DO REST API directly with the token from
`~/.config/doctl/config.yaml`, because `doctl` is installed via snap here and
fails with a confinement error (`snap-confine` lacks `cap_dac_override`).

> **Never commit straight to `main`.** Branch, then merge — `main` is the deploy
> trigger in both repos, so a commit on `main` is a deploy.

### After deploying anything that touches auth

Log in to the dashboard before doing anything else. The global guards sit in
front of every authenticated route, so an auth regression is total rather than
partial, and a login is the fastest way to prove it isn't there.

---

## Environment variables in production

Set on the app spec, not in a file. Secrets are stored encrypted and are **not
readable back** — you can overwrite one, never retrieve it. Keep a copy in your
password manager.

`JWT_SECRET` and `JWT_REFRESH_SECRET` are required and validated at boot: if
either is missing or empty the process exits immediately, and the deploy fails
its health check rather than serving with a weak default.

Changing an env var triggers a redeploy.

---

## Pointing a custom domain

Currently **unset** — the app spec's `domains` array is empty and the app answers
on the DO default ingress. Launching on a client-owned domain is a Week 6
deliverable, and it is more than a DNS record: several third parties hold the
old URL and will break silently.

Do it in this order.

**1. Add the domain to the app**

Add it to the app spec's `domains` (DO issues and renews the TLS certificate
automatically), then create the DNS record the DO panel shows — a `CNAME` to the
app's ingress hostname for a subdomain, or DO-managed nameservers for an apex
domain. Wait for the certificate to be issued before moving on.

**2. Update `FRONTEND_URL`**

This one variable does three jobs: the CORS allowlist, the base for links the
assistant posts into Slack, and the Stripe Checkout return URL. If it still says
the old host, the dashboard's own API calls will be blocked by CORS.

**3. Re-point every external callback** — all of them need the `/api` prefix:

| Service | What to change |
| --- | --- |
| Slack app | Event, interaction, and OAuth redirect URLs (see below) |
| Meta app | `META_REDIRECT_URI` and the same value in the Meta app's OAuth settings |
| Stripe | The webhook endpoint URL, then update `STRIPE_WEBHOOK_SECRET` to the new endpoint's signing secret |

**4. Re-install the Slack app** through the new domain, for the reason in the
next section.

**5. Verify**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<domain>/api/health   # 200
```

Then log in, send the bot a message, and make one top-up in Stripe test mode —
those three exercise CORS, Slack delivery, and the webhook respectively.

---

## The Slack app: local vs production

There is **one** Slack app (client id `11308942668967.11340379266852`) shared
between local and production, so its Request URLs point at exactly one
environment at a time.

**Production (current target):**

```
Events:       https://gomer-7i3jm.ondigitalocean.app/api/slack/events
Interactions: https://gomer-7i3jm.ondigitalocean.app/api/slack/interactions
OAuth:        https://gomer-7i3jm.ondigitalocean.app/api/auth/slack/callback
```

**Switching environments takes two steps, not one.** Re-pointing the Request URLs
only changes where Slack *delivers*. The workspace row and bot token live in
whichever database that environment uses (`slackTeamId` is unique per database),
so you must also **re-install** the app through that environment's
`/auth/slack/install` to create them.

Symptom of doing only the first step: events arrive, the log says
`No workspace/bot token for Slack team T…`, and the bot answers nothing.

---

## Local Slack development

Slack will not redirect to `localhost`, so local development needs a tunnel. A
reserved ngrok domain is in use so the URLs survive restarts:

```bash
ngrok http 3000
```

```
Events:       https://faultless-rightwardly-linh.ngrok-free.dev/slack/events
Interactions: https://faultless-rightwardly-linh.ngrok-free.dev/slack/interactions
OAuth:        http://localhost:3000/auth/slack/callback
```

Note: **no `/api` prefix locally** — that prefix is a production-router artifact.

Then re-install via `http://localhost:3000/auth/slack/install` to create the
local workspace row.

---

## Querying the production database

`gomer-db` is an App Platform **dev** database. It has no external connection
string and does not appear under `/v2/databases`, so the only route in is from
inside the running container.

1. `GET /v2/apps/{app}/deployments` → the ACTIVE deployment id.
2. `GET /v2/apps/{app}/deployments/{deployment}/components/api/exec` → a `wss://`
   console URL.
3. Connect with Node's global `WebSocket`. The console is a **pty** with a strict
   handshake:
   - It first sends `{"op":"stdout","data":"/app # \x1b[6n"}` — a cursor-position
     query.
   - Write anything before answering it and the socket dies with close 1006.
   - Answer with `{"op":"stdin","data":"\x1b[1;8R"}`, then send input as
     `{"op":"stdin","data":"…"}`. Raw non-JSON frames are rejected.
4. Ship a script in as base64
   (`echo <b64> | base64 -d > /app/q.js && node /app/q.js`) and fence the output
   between markers, because the pty echoes input back. Write to **`/app`**, not
   `/tmp` — `pg` only resolves from `/app/node_modules`.
5. In the script set `NODE_TLS_REJECT_UNAUTHORIZED='0'`. The DB certificate is
   self-signed, and `ssl.rejectUnauthorized: false` alone is overridden by
   `sslmode=require` in `DATABASE_URL`.

`api.digitalocean.com` is reachable only intermittently from some networks
(`fetch` times out roughly half the time, `curl` is steadier) — wrap the API call
in a retry loop.

> This is a genuine handover liability: it is slow, fiddly, and undocumented by
> DO. If the client will operate this themselves, consider migrating to a managed
> Postgres cluster with a real connection string.

---

## Integration scoping: team vs private

How a connected app becomes visible to an AI run:

| Access level | Pipedream `external_user_id` | Visible to |
| --- | --- | --- |
| `team` | `workspaceId` | Every member of the workspace |
| `private` | `u:<userId>` | Only the member who connected it |

Slack senders map to members via `users.slackUserId`; auth is Slack-OAuth only,
so the dashboard and Slack share one user row.

**The trap, learned the hard way (Aug 2026):** a team-scoped Gmail answered
"check my gmail" for a *different* member with no ownership attribution. That
turned out to be team scoping working as specified rather than a tenancy leak —
but it reads like a leak, on camera and to a client. Two rules follow:

- **Demos want `team`.** A private connection is invisible to the member you demo
  from, and the bot will correctly say the app isn't connected.
- **Personal accounts want `private`.** Anything connected as `team` is shared
  with everyone in the workspace by design.

Mitigations already in place: unknown Slack senders are auto-provisioned as
members, and the system prompt carries ownership annotations plus the requester's
identity.

---

## Known launch blockers

Carried here from the audit and from operational experience. These are not code
defects — they are decisions the client has to make before real users arrive.

### 1. Pipedream Connect plan gates tool calling in production

`PIPEDREAM_ENVIRONMENT=production` returns *"Tool calling via Pipedream Connect
in production is not available on your current plan"* on every `actions.list`.
The paid Connect plan gates tool calling, which almost certainly also covers the
remote MCP server tools run through.

The deployment therefore runs on `development`, which **caps at 10 external users,
each of whom must be signed in to pipedream.com**. That is workable for demos and
impossible for launch.

**Decision needed:** pay for Pipedream Connect, or stay demo-only. Nothing in the
codebase can work around this.

### 2. No custom domain

See [above](#pointing-a-custom-domain). Blocked on the client naming the domain.

### 3. Meta OAuth tokens unencrypted at rest

`integrations.accessToken` / `.refreshToken` hold live Meta credentials in
plaintext. Needs a key-management decision plus a migration — see finding 6 of
the [security audit](milestone-5-security-audit.md).

### 4. Schedulers run on every instance

Cron lives in the API process, so scaling to N instances runs each scheduler N
times. Work that must happen once is currently protected at the data layer
(unique indexes), not by the scheduler. Scaling up, or adding a new scheduled job,
requires either a distributed lock or moving cron to a dedicated single-instance
worker.

---

## Rollback

App Platform keeps previous deployments. To roll back, redeploy the last good
commit — either from the DO panel's deployment list, or:

```bash
git revert <bad-commit> && git push origin main
```

**Migrations do not roll back automatically.** If the bad deploy applied one,
revert it deliberately with `npm run migration:revert` before or alongside the
code rollback, and check whether the previous code can tolerate the newer schema
(usually yes for additive migrations, no for destructive ones).
