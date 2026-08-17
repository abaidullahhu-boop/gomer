# gomer.ai — Backend

AI coworker for ad operations. A team installs gomer.ai into their **Slack**
workspace, connects their ad and commerce accounts (Meta Ads, Google Ads,
Stripe, Google Sheets, Gmail, …), and then works through the assistant in Slack:
asking questions about spend and return, having it act on campaigns, setting up
rules that run unattended, and exporting reports on a schedule.

The system is **multi-tenant**. Each tenant is a `Workspace`, bound 1:1 to a
Slack workspace. Authentication is **Slack OAuth only** — there is no
email/password login.

- **Operations, deployment, and handover:** [`docs/operations.md`](docs/operations.md)
- **End-user guide:** [`docs/user-guide.md`](docs/user-guide.md)
- **Security audit:** [`docs/milestone-5-security-audit.md`](docs/milestone-5-security-audit.md)

---

## Architecture at a glance

```
Slack workspace                     Dashboard (React SPA)
      │  events, slash replies            │  JWT (Bearer)
      ▼                                   ▼
┌─────────────────────────────────────────────────────┐
│  NestJS API                                          │
│                                                      │
│   auth ── workspaces ── users                        │
│   ai ──── the orchestration core                     │
│    │                                                 │
│    ├── integrations ── Pipedream Connect ── 2500+ apps│
│    │                └─ Meta Ads (native + MCP)       │
│    ├── skills, memory, spaces  (AI context)          │
│    ├── rules, tasks, exports, monitoring (schedulers) │
│    └── usage, billing, admin   (credits & money)     │
└─────────────────────────────────────────────────────┘
      │                    │                  │
   Postgres 16          Redis 7        Anthropic / gateway
```

**Two things carry most of the design:**

1. **Pipedream Connect holds third-party credentials, not us.** For most
   integrations we never store a customer's OAuth token — Pipedream stores and
   refreshes it, and we call apps through Connect (as MCP tool servers, or
   through its HTTP proxy). Meta Ads is the exception: it is connected natively
   and its tokens are stored locally, because ROAS verification and the rule
   engine need deterministic server-side reads rather than tool round-trips.
2. **One AI entry point.** Everything that spends a model call — a Slack
   message, a scheduled task, a rule evaluation — goes through `AiService.run()`.
   That is where the credit gate, tool routing, and metering live, so they cannot
   be bypassed by adding a new caller.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Framework | NestJS 11 + TypeScript (strict) |
| Database | PostgreSQL 16 |
| ORM | TypeORM 0.3, migration-driven (`synchronize: false`) |
| Cache / coordination | Redis 7 (ioredis) |
| Auth | Slack OAuth → JWT (access + refresh) |
| Models | Anthropic direct, plus an optional OpenAI-compatible gateway |
| Third-party apps | Pipedream Connect (MCP + HTTP proxy) |
| Scheduling | `@nestjs/schedule` cron inside the API process |
| Tests | Node's built-in `node:test` |
| Hosting | DigitalOcean App Platform |

---

## Getting started

```bash
npm install                  # Node >= 20, npm >= 10
cp .env.example .env         # then fill in the values below
docker compose up -d         # PostgreSQL 16 + Redis 7
npm run migration:run        # apply the schema
npm run start:dev            # watch mode on http://localhost:3000
```

To get past the login screen you need a Slack app pointed at your machine —
see [Local Slack development](docs/operations.md#local-slack-development) for the
ngrok setup, because Slack will not redirect to `localhost`.

### The minimum env to boot

`JWT_SECRET` and `JWT_REFRESH_SECRET` are validated at startup and the process
**exits** if either is missing. Everything else degrades gracefully: a missing
`STRIPE_SECRET_KEY` disables top-ups rather than crashing, a missing
`ANTHROPIC_API_KEY` makes the assistant report a configuration problem in chat
instead of throwing.

---

## Environment variables

Full list in [`.env.example`](.env.example). By group:

| Group | Variables | Notes |
| --- | --- | --- |
| Core | `NODE_ENV`, `PORT`, `FRONTEND_URL` | `FRONTEND_URL` is the CORS allowlist **and** the base for links the assistant posts into Slack |
| Database | `DATABASE_URL`, or `DATABASE_HOST/PORT/NAME/USER/PASSWORD` | `DATABASE_URL` wins when set, which is how DigitalOcean injects it |
| Redis | `REDIS_URL`, or `REDIS_HOST/PORT` | `REDIS_URL` carries auth + TLS for managed Redis |
| JWT | `JWT_SECRET`, `JWT_EXPIRES_IN` (15m), `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRES_IN` (7d) | Access and refresh use **separate** secrets. Both secrets required at boot |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_SCOPES` | Signing secret verifies inbound events; without it every event is rejected |
| AI | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_MODELS` | Gateway vars are optional; set them to offer extra models |
| Pipedream | `PIPEDREAM_CLIENT_ID`, `PIPEDREAM_CLIENT_SECRET`, `PIPEDREAM_PROJECT_ID`, `PIPEDREAM_ENVIRONMENT` | `development` and `production` are separate credential stores |
| Meta Ads | `META_OAUTH_CLIENT_ID`, `META_OAUTH_CLIENT_SECRET`, `META_REDIRECT_URI`, `META_SCOPES`, `META_LOGIN_CONFIG_ID`, `META_MCP_URL` | Native connection, separate from Pipedream |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Platform's own Stripe account, for selling credits |

---

## Project structure

```
src/
├── main.ts                  Bootstrap: helmet, CORS, validation, rawBody, shutdown hooks
├── app.module.ts            Root module + global guards / filter / interceptor
├── config/                  Typed configuration and boot-time env validation
├── common/                  Decorators, guards, interceptors, filters, enums, constants
├── database/                Entities and migrations
├── redis/                   Shared ioredis client (global module)
│
├── auth/                    Slack OAuth, JWT issue/rotate, workspace switching
├── users/                   Member provisioning, roles, activation
├── workspaces/              Tenant provisioning, instructions, model choice
│
├── ai/                      Orchestration core: the run loop, tool routing,
│                            provider abstraction, credit gate, metering
├── integrations/            Pipedream Connect, Meta Ads (native + MCP),
│                            Stripe reads, ROAS verification
├── skills/                  Installable skill catalogue injected into context
├── memory/                  Durable per-workspace facts ("our target ROAS is 3")
├── spaces/                  Published mini-apps with their own end-user auth
│
├── rules/                   Ad rule engine (CPA/ROAS thresholds → actions)
├── tasks/                   User-defined scheduled prompts
├── exports/                 Scheduled Google Sheets exports
├── monitoring/              Hourly anomaly sweep (CPA spike, ROAS drop, spend spike)
│
├── usage/                   Credit ledger: metering and balance
├── billing/                 Stripe Checkout for credit top-ups + webhook
├── admin/                   Admin read models: members, analytics, revenue
├── slack/                   Slack Web API, event and interaction handling
└── health/                  GET /health
```

---

## Authentication

### Slack OAuth → JWT

1. `GET /auth/slack/install` → 302 to Slack's consent screen.
2. Slack calls back to `GET /auth/slack/callback?code=…`.
3. The backend exchanges the code, resolves the team and user profile,
   provisions the workspace and user, grants the workspace its **$100 onboarding
   credits** (idempotent), and issues a JWT pair.
4. Redirect to `FRONTEND_URL/auth/callback?accessToken=…&refreshToken=…`.

The first user provisioned in a workspace becomes its `ADMIN`.

Access tokens last **15 minutes**; refresh tokens last **7 days**, are stored as
a bcrypt hash, and are rotated on every refresh. Refresh checks `isActive`, so a
deactivated member is locked out at their next renewal.

### Two token domains — read this before touching the strategy

There are **two** kinds of JWT in this system and they are signed with the same
`JWT_SECRET`:

| | Workspace access token | Space session token |
| --- | --- | --- |
| Issued by | `AuthService` after Slack OAuth | `SpacesAuthService` after a magic link |
| Claims | `sub`, `workspaceId`, `slackUserId`, `role` | `sub`, `spaceId`, `email`, `scope: 'space'` |
| Lifetime | 15 minutes | 7 days |
| Gate | global `JwtAuthGuard` | `SpaceAuthGuard` on the route |

Because the signature alone cannot tell them apart, **each validator asserts the
claim shape**: `JwtStrategy` rejects any token carrying a `scope` claim and
requires a well-formed `workspaceId` and a known role; `verifySession` requires
`scope === 'space'`. Removing either check re-opens a cross-tenant hole — a Space
visitor's token satisfying the workspace guard with `workspaceId: undefined`,
which TypeORM turns into an unscoped query that returns every tenant's rows.
This is finding 1 of the [security audit](docs/milestone-5-security-audit.md);
please read it before changing `jwt.strategy.ts`.

### Guards

Three global guards run in order, all fail-closed:

| Guard | Effect |
| --- | --- |
| `JwtAuthGuard` | Requires a valid access token unless the route is `@Public()` |
| `RolesGuard` | Enforces `@Roles(UserRole.ADMIN)` where declared |
| `RateLimitGuard` | Enforces `@RateLimit({ limit, windowSeconds })` where declared; no-op otherwise |

`RateLimitGuard` counts in Redis (the API runs as more than one instance, so an
in-memory counter would be per-instance), buckets by member id or the first
`x-forwarded-for` hop, and **fails open** if Redis is unreachable.

---

## Credits

One credit = one US cent, so credits map 1:100 to dollars and the grants ledger
doubles as a revenue record.

Balance is computed, never stored:

```
balance = SUM(credit_grants.credits) − SUM(credit_events.creditsUsed)
```

Both tables are append-only, so the accounting stays auditable and there is no
counter to drift.

| Flow | Where |
| --- | --- |
| $100 free on workspace creation | `UsageService.grantOnboardingCredits()`, idempotent |
| Metering per model call | `AiService` → `UsageService.recordEvent()`, priced from the model catalog |
| Hard gate at zero | `AiService.run()` — declines and links the billing page before calling a model |
| Low-balance nudge under $10 | appended to the assistant's normal answer |
| Top-up | Stripe Checkout → verified webhook → `credit_grants` row |

Credits are granted by the **verified webhook**, never by the browser redirect,
and the grant is idempotent on the Stripe session id (unique index), so retries
and concurrent deliveries cannot double-credit.

An unknown model id is billed at Opus rates, so a retired model can never be
billed too cheaply.

---

## Background schedulers

Cron runs inside the API process (`@nestjs/schedule`). Each has a run guard so
ticks cannot overlap.

| Schedule | Cadence | Does |
| --- | --- | --- |
| `tasks.scheduler` | every minute | Runs user-defined scheduled prompts whose cron is due |
| `rules.scheduler` | every minute | Evaluates ad rules, applies actions with guardrails |
| `exports.scheduler` | every minute | Runs due Google Sheets exports, appending rows |
| `monitoring.scheduler` | hourly | Sweeps Meta accounts for anomalies, posts to the alerts channel |

> **Multi-instance caveat.** These run on **every** instance. Work that must
> happen once is protected at the data layer, not by the scheduler — the anomaly
> sweep dedupes on a unique `(workspace, account, metric, day)` index, for
> example. Anything new added here needs the same treatment.

---

## API surface

All routes require `Authorization: Bearer <accessToken>` unless marked Public.
In production everything is served under the **`/api`** prefix (see
[operations](docs/operations.md#routing)).

| Area | Routes |
| --- | --- |
| Auth | `GET /auth/slack/install` ᴾ, `GET /auth/slack/callback` ᴾ, `POST /auth/refresh` ᴾᴿ, `POST /auth/logout`, `GET /auth/me`, `GET /auth/workspaces`, `POST /auth/switch-workspace` |
| Users | `GET /users/me`, `GET /users`, `PATCH /users/:id/role` ᴬ |
| Workspaces | `GET /workspaces/me`, `PATCH /workspaces/me` ᴬ |
| AI | `GET /ai/status`, `GET /ai/models`, `POST /ai/run` |
| Integrations | `GET /integrations`, `GET /integrations/apps`, `GET /integrations/:appSlug/tools`, `POST /integrations/connect-token`, `POST /integrations/confirm`, `GET /integrations/meta/authorize`, `GET /integrations/meta/callback` ᴾ, `PATCH /integrations/:id`, `DELETE /integrations/:id` |
| Skills | `GET /skills`, `GET /skills/installed`, `POST /skills/:id/install`, `DELETE /skills/:id/install` |
| Tasks | `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `POST /tasks/:id/run`, `DELETE /tasks/:id` |
| Usage | `GET /usage/summary`, `GET /usage/balance`, `GET /usage/cost`, `GET /usage/events` |
| Billing | `GET /billing/summary`, `POST /billing/topup` ᴿ, `POST /billing/webhook` ᴾ |
| Admin | `GET /admin/overview` ᴬ, `GET /admin/analytics` ᴬ, `GET /admin/revenue` ᴬ, `GET /admin/users` ᴬ, `PATCH /admin/users/:id/active` ᴬ |
| Spaces (dashboard) | `GET /spaces`, `GET /spaces/:id`, `GET /spaces/:id/members`, `DELETE /spaces/:id` |
| Spaces (runtime) | `GET /spaces/public/:slug` ᴾ, `POST /spaces/:slug/auth/request-link` ᴾᴿ, `GET /spaces/:slug/auth/verify` ᴾᴿ, and `:slug/data/:entity` CRUD ᴾ (guarded by `SpaceAuthGuard`) |
| Slack | `GET /slack/status` ᴾ, `POST /slack/events` ᴾ, `POST /slack/interactions` ᴾ |
| Health | `GET /health` ᴾ |

ᴾ Public · ᴬ Admin only · ᴿ Rate limited

Swagger is served at `/api/docs` in non-production environments only.

---

## Database

Migration-driven; entities use UUID primary keys.

```bash
npm run migration:run                                    # apply pending
npm run migration:revert                                 # roll back the last one
npm run migration:generate -- src/database/migrations/<Name>   # diff from entities
```

In production, migrations run automatically as a **PRE_DEPLOY job** — a push is
enough, and a failing migration aborts the deploy rather than half-applying it.

Tables: `workspaces`, `users`, `messages`, `integrations`, `skills`,
`user_skills`, `scheduled_tasks`, `workspace_memory`, `roas_snapshots`,
`ad_rules`, `ad_rule_actions`, `anomaly_alerts`, `scheduled_exports`,
`credit_events`, `credit_grants`, `spaces`, `space_records`, `space_users`,
`space_auth_tokens`.

---

## Testing

```bash
npm test        # 83 tests
```

There is no full test framework. `test/run-tests.ts` requires every
`src/**/*.spec.ts` and lets Node's built-in `node:test` runner report them.
Write tests as plain `node:test` files next to the code they cover.

Coverage is deliberately concentrated on logic that is expensive to get wrong:
JWT claim validation, Stripe signature verification and webhook idempotency,
rate-limit windowing, URL redaction, tool routing, and spec validation. There is
**no HTTP-level integration harness** — route authorization is verified by
reading code, which is the main known gap.

---

## Scripts

| Script | Does |
| --- | --- |
| `npm run start:dev` | Watch-mode dev server |
| `npm run build` | Compile to `dist/` |
| `npm run lint` | ESLint (flat config) + Prettier, autofixing |
| `npm test` | Run the spec suite |
| `npm run deployed` | Print what production is currently serving |
| `npm run credits` | Grant or deduct credits for a workspace |
| `npm run probe:sheets` | Prove the Pipedream proxy can reach Google Sheets |
| `npm run probe:cache` | Inspect prompt-cache hit rates |
| `npm run probe:route` | Inspect tool-routing decisions for a prompt |
| `npm run probe:allowlist` | Check MCP tool allowlisting |
| `npm run tool:sizes` | Report tool-definition token cost |
| `npm run catalog:build` | Rebuild the local integration catalogue snapshot |

---

## Security posture

- `helmet` headers; CORS restricted to `FRONTEND_URL`; Swagger off in production.
- Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`, so unknown
  body fields are rejected rather than silently bound.
- Every tenant-scoped query is keyed by `workspaceId`; Space data is keyed by
  `spaceId`.
- Slack and Stripe webhooks are verified by HMAC over the **raw** body with
  timing-safe comparison and a freshness window. This is why `main.ts` enables
  `rawBody`.
- Meta OAuth uses PKCE with single-use state held in Redis.
- Credential-bearing query values (`token`, `code`, `state`, …) are masked before
  anything reaches the logs.
- Strict TypeScript, no `any`.

Known accepted risks — Meta tokens unencrypted at rest, up-to-15-minute
revocation lag, Space records shared across a Space's end-users — are documented
with rationale in the [security audit](docs/milestone-5-security-audit.md).
