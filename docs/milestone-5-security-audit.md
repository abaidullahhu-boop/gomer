# Milestone 5 — QA and security audit

Scope: the whole backend API surface and the credit/admin/alerting code that
Milestone 5 delivers, reviewed at code level with the findings verified against
a running instance. Frontend was reviewed for authorization gaps only.

**Result:** five issues found and fixed, three accepted and documented, and a
list of things checked that were already correct. Build, lint, and the 83-test
suite are green on this branch.

| | Finding | Severity | State |
|---|---|---|---|
| 1 | Space session tokens accepted by the workspace API, leaking credit grants across tenants | **High** | Fixed |
| 2 | Duplicate Stripe webhook delivery causes an endless retry loop | Medium | Fixed |
| 3 | Magic-link endpoint is a membership oracle | Medium | Fixed |
| 4 | Auth tokens and OAuth codes written to request logs | Medium | Fixed |
| 5 | No rate limiting anywhere on the API | Medium | Fixed |
| 6 | Meta OAuth tokens stored unencrypted at rest | Medium | Accepted |
| 7 | Member revocation takes up to 15 minutes | Low | Accepted |
| 8 | Space records readable by every end-user of that Space | Low | Accepted (by design) |

---

## 1. Space sessions were accepted by the workspace API — High

**What was wrong.** Two different trust domains share one signing key. Workspace
access tokens (`{ sub, workspaceId, slackUserId, role }`) and Space end-user
sessions (`{ sub, spaceId, email, scope: 'space' }`) are both signed with
`jwt.secret`. The workspace strategy verified the signature and then projected
the claims without asserting any of them:

```ts
validate(payload: JwtPayload): AuthenticatedUser {
  return { userId: payload.sub, workspaceId: payload.workspaceId, ... };
}
```

A Space session is signature-valid, so it passed. It arrived at workspace routes
as an authenticated member whose `workspaceId` was `undefined`.

**Why that was worse than an auth bypass.** TypeORM drops a `where` condition
whose value is `undefined` rather than matching nothing. So
`findGrantsForWorkspace(undefined)` did not return an empty list — it returned
the 50 most recent credit grants **in the table, across every tenant**.

**Reproduction.** A token minted with the Space payload shape, against a running
instance:

| Endpoint | Before | After |
|---|---|---|
| `GET /billing/summary` | **200** — returned every grant row in the table | 401 |
| `GET /usage/balance` | **200** | 401 |
| `GET /admin/overview` | 403 — saved by `RolesGuard` rejecting `role: undefined` | 401 |
| `GET /integrations` | 500 — crashed on the undefined workspace | 401 |

The exposed fields were workspace ids, credit amounts, dollar amounts paid,
Stripe session ids, and grant notes. A legitimate member token returned 200
before and after, confirming the difference is the claim check and not a broken
signature path.

**Who could exploit it.** Anyone holding a Space session — that is, any end-user
of any published Space, self-serve via magic link where the Space allows signup.
Space sessions last 7 days.

**Fix.** `src/auth/strategies/jwt.strategy.ts` now rejects any token carrying a
`scope` claim, and requires a non-empty `sub`, a non-empty `workspaceId`, and a
role in the known set. Rejecting on the *presence* of `scope` rather than
listing known-bad values means a future scoped token type is refused by default
instead of inheriting the same hole.

**Residual risk.** The underlying footgun — a repository call with an
`undefined` scope key silently returning everything — still exists elsewhere in
the codebase. The strategy is the right chokepoint and closes it for
authenticated routes, since `workspaceId` can no longer be `undefined`. A
defence-in-depth pass asserting the tenant key in the repository layer is worth
doing but is a larger refactor than this milestone's QA scope.

---

## 2. Duplicate Stripe delivery caused an endless retry loop — Medium

Idempotency was a read-then-write: `hasGrantForStripeSession()` followed by an
insert. Two concurrent deliveries of the same session both cleared the read, and
the unique index on `stripeSessionId` correctly rejected the second — but the
resulting error surfaced as a 500.

Stripe treats 500 as "retry", and the retry hits the same race outcome, so a
payment that was *already correctly credited* would keep failing until Stripe
marked the delivery permanently failed and raised it in the dashboard.

**Fix.** The unique violation is caught and acked. The money outcome was never
wrong — the index guaranteed that — but the operational signal was.

---

## 3. Magic-link endpoint was a membership oracle — Medium

For a Space with signup closed, `POST /spaces/:slug/auth/request-link` threw
`403 "This email is not invited to this app"` for unknown addresses and returned
`{ sent: true }` for known ones. Unauthenticated, so anyone could enumerate a
Space's user list one address at a time.

**Fix.** Both cases return `{ sent: true }`. No link is minted or mailed for an
uninvited address.

---

## 4. Auth tokens and OAuth codes were written to logs — Medium

The request logger recorded the full URL, and two routes carry a credential in
the query string: the Space magic link (`?token=`) and the Meta OAuth callback
(`?code=`, `?state=`). Both landed verbatim in application logs, which are
retained and widely readable. The exception filter also echoed the raw URL back
in error responses.

**Fix.** `redactUrl()` masks `token`, `code`, `state`, `access_token`, and
`secret` values; both the interceptor and the filter use it.

Mitigating factors that kept this below High: magic-link tokens are single-use
with a 30-minute TTL, and OAuth codes are single-use and PKCE-protected.

---

## 5. Nothing was rate limited — Medium

No throttling existed on any route. The exposures that mattered:

- `POST /spaces/:slug/auth/request-link` — unauthenticated and **sends mail**,
  so it could be driven as a spam relay against a third party's inbox.
- `POST /auth/refresh` and `GET /spaces/:slug/auth/verify` — unauthenticated and
  each runs a bcrypt comparison, which is deliberately expensive and therefore
  an efficient way to burn server CPU.
- `POST /billing/topup` — creates Stripe Checkout sessions against our account's
  API quota.

**Fix.** An opt-in `@RateLimit({ limit, windowSeconds })` decorator and guard,
registered globally but a no-op on routes that do not declare a limit — so no
existing endpoint changed behaviour.

Two implementation notes. The counter lives in **Redis**, not process memory,
because the API runs as more than one instance and an in-memory limit would let
a caller multiply their allowance by the instance count. And the caller is
identified by the first `x-forwarded-for` hop rather than `req.ip`, because
behind the DigitalOcean load balancer `req.ip` is the proxy — every caller in
the world would share one bucket.

The guard **fails open**: if Redis is unreachable the request proceeds. A
limiter outage should not take down the API, and every route behind it has its
own authentication or signature check.

Applied limits, per caller per 15 minutes: magic link 5, verify 20, refresh 30,
top-up 15. Verified live — 30 requests returned 401 for the bad token, the 31st
returned 429.

---

## 6. Meta OAuth tokens are stored unencrypted — Medium, accepted

`integrations.accessToken` and `.refreshToken` hold live Meta credentials in
plaintext, with no column encryption and no `select: false`.

Not fixed here because at-rest encryption requires a key-management decision
(where the key lives, how it rotates) and a data migration — a design choice for
the client, not a QA fix.

What limits the exposure today: most credentials are held by Pipedream rather
than by us, the tokens never leave the server, and the integrations API projects
an explicit safe subset to clients. Verified that no endpoint returns token
material.

**Recommendation:** Week 6, if the client wants it.

---

## 7. Member revocation takes up to 15 minutes — Low, accepted

Deactivating a member flips `users.isActive`, but the JWT strategy is stateless,
so an already-issued access token stays valid until it expires. Refresh checks
`isActive` and is refused immediately, so the member is locked out at the next
renewal — a bounded window of at most 15 minutes. Role changes have the same lag.

This is standard for stateless JWTs and the window is short. Instant revocation
means a token denylist checked per request, which trades a Redis round-trip on
every call for closing a 15-minute gap. Flagged for the client to decide.

---

## 8. Space records are readable by every end-user of that Space — Low, by design

`listRecords` returns all records for an entity, scoped to the Space but not to
the end-user who created them. For a shared team app that is correct. For a
Space collecting private per-person submissions it would be a privacy problem.

Not a defect — there is no per-user access model in the Space spec to violate.
Raising it so the intent is confirmed before a Space of the second kind gets
built.

---

## Checked and already correct

Recorded so the client can see the audit's coverage, not just its findings.

**Authorization**
- Global `JwtAuthGuard` + `RolesGuard`; both fail closed. `RolesGuard` denies
  when the user or role is missing rather than defaulting to allow.
- Admin routes are role-gated server-side, and the frontend hides the nav item —
  the UI gate is cosmetic, the API gate is real.
- `setActive` scopes its lookup by `workspaceId`, so an admin cannot reach a user
  in another workspace by id. Refuses self-deactivation and refuses to remove the
  last active admin.

**Tenant isolation**
- Every credit, usage, admin, and grant query filters on `workspaceId`.
- Space record CRUD scopes by `spaceId` on read, update, and delete — no IDOR.
- `SpaceAuthGuard` pins the session to the Space named in the route, so one
  app's session cannot reach another's data.

**The Gmail-incident pattern**
- The monitoring sweep resolves Meta tokens with a null user, which is exactly
  the shape of the August 2026 cross-user leak. Checked: `visibleMetaIntegrations`
  restricts a null user to `accessLevel = 'team'`, so the sweep cannot pick up a
  member's private connection. Correct.

**Webhooks and callbacks**
- Slack: HMAC-SHA256 over the raw body, timing-safe comparison, 5-minute replay
  window.
- Stripe: HMAC over `${timestamp}.${rawBody}`, timing-safe, 5-minute tolerance.
  Credit amounts come from server-set session metadata, never from the client.
- Meta OAuth: state stored in Redis, single-use (deleted on redemption), with a
  PKCE verifier.

**Credit integrity**
- Balance is `SUM(grants) − SUM(events)` over two append-only tables; no mutable
  counter to drift or be tampered with.
- The gate runs before every model call at a single chokepoint (`ai.run`), so
  Slack messages, scheduled tasks, and rules are all covered.
- Onboarding grant is idempotent, and the migration backfilled existing
  workspaces.
- Unknown models are priced at Opus rates, so a retired model id can never be
  billed too cheaply.

**Platform**
- `helmet()` on, CORS restricted to the configured frontend origin, Swagger
  disabled in production.
- `ValidationPipe` with `whitelist` and `forbidNonWhitelisted`, so unexpected
  body fields are rejected rather than silently bound.
- `JWT_SECRET` and `JWT_REFRESH_SECRET` are required non-empty at boot, so the
  placeholder defaults in `configuration.ts` are unreachable. They are still
  misleading and worth deleting.
- Access and refresh tokens use separate secrets.
- Stack traces are logged server-side only; error responses carry a generic
  message.

---

## Gates

```
npm run build     clean
npm run lint      clean
npm test          83 pass, 0 fail
```

21 tests are new in this milestone, covering the JWT claim check (including a
minted Space token asserted to be refused), Stripe signature verification and
webhook idempotency under the race, URL redaction, and the rate limiter's
window, bucketing, and fail-open behaviour.

**Not covered by automated tests:** there is no integration-test harness, so
route-level authorization is verified by reading code and by the manual
reproduction described in finding 1. An HTTP-level test suite that asserts each
route's expected status for member / admin / Space / anonymous callers would
turn that manual check into a permanent regression guard. Recommended for
Week 6.
