# gomer.ai — Backend

AI coworker platform. Users install gomer.ai into their **Slack** workspace,
connect external apps (Gmail, Stripe, Shopify, eBay, Amazon, …), and automate
tasks through an AI assistant. The system is **multi-tenant**, with each tenant
(`Workspace`) bound 1:1 to a Slack workspace. Authentication is **Slack OAuth
only** — there is no email/password login.

## Tech Stack

| Concern        | Choice                          |
| -------------- | ------------------------------- |
| Framework      | NestJS 11 + TypeScript (strict) |
| Database       | PostgreSQL 16                   |
| ORM            | TypeORM 0.3 (migrations)        |
| Cache / Queue  | Redis 7 (ioredis)               |
| Auth           | Slack OAuth → JWT (access+refresh) |
| Package manager| npm                             |
| Local infra    | Docker Compose                  |

## Prerequisites

- Node.js >= 20
- npm >= 10
- Docker + Docker Compose

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Create your env file
cp .env.example .env
#    Fill in SLACK_CLIENT_ID / SLACK_CLIENT_SECRET from your Slack app.

# 3. Start PostgreSQL + Redis
docker compose up -d

# 4. Run database migrations
npm run migration:run

# 5. Start the API in watch mode
npm run start:dev
```

The API listens on `http://localhost:3000` by default.

## Environment Variables

See [`.env.example`](.env.example) for the full list. Key groups:

- **Database** — `DATABASE_HOST/PORT/NAME/USER/PASSWORD` and `DATABASE_URL`
- **Redis** — `REDIS_HOST/PORT`
- **JWT** — `JWT_SECRET` (15m access), `JWT_REFRESH_SECRET` (7d refresh)
- **Slack** — `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_REDIRECT_URI`, `SLACK_SCOPES`

## Project Structure

```
src/
├── main.ts                 # Bootstrap: helmet, CORS, validation, shutdown hooks
├── app.module.ts           # Root module + global guards/filters/interceptors
├── config/                 # Typed configuration + env validation
├── common/                 # Decorators, guards, interceptors, filters, enums, constants
├── database/               # Entities, migrations, subscribers, DatabaseModule
├── redis/                  # Shared ioredis client (global module)
├── auth/                   # Slack OAuth + JWT (controller, service, strategy, dto)
├── users/                  # User provisioning
├── workspaces/             # Tenant provisioning
├── integrations/           # External app connections (scaffold)
├── skills/                 # Skill catalogue (scaffold)
├── tasks/                  # Scheduled tasks (scaffold)
├── ai/                     # AI orchestration (scaffold)
├── slack/                  # Slack Web API + events (OAuth implemented)
├── usage/                  # Credit/token usage reporting (scaffold)
└── health/                 # GET /health
```

## Authentication Flow (Slack OAuth)

1. Browser hits `GET /auth/slack/install` → 302 redirect to Slack's consent screen.
2. Slack redirects back to `GET /auth/slack/callback?code=…`.
3. Backend exchanges the code (`oauth.v2.access`), resolves the team + user
   profile, **provisions the workspace and user**, and issues a JWT pair.
4. Browser is redirected to `FRONTEND_URL/auth/callback?accessToken=…&refreshToken=…`.

The first user provisioned in a workspace becomes its `ADMIN`.

### Auth Endpoints

| Method | Path                    | Auth   | Description                              |
| ------ | ----------------------- | ------ | ---------------------------------------- |
| GET    | `/auth/slack/install`   | Public | Redirect to Slack OAuth                  |
| GET    | `/auth/slack/callback`  | Public | Handle OAuth, provision, issue tokens    |
| POST   | `/auth/refresh`         | Public | Rotate tokens using a valid refresh token|
| POST   | `/auth/logout`          | JWT    | Invalidate stored refresh token          |
| GET    | `/auth/me`              | JWT    | Current authenticated user               |

JWT rules: access token **15m**, refresh token **7d**, refresh token stored in
the DB as a **bcrypt hash** and rotated on every refresh.

## Other Endpoints (selected)

| Method | Path               | Description                          |
| ------ | ------------------ | ------------------------------------ |
| GET    | `/health`          | Liveness + DB/Redis checks (public)  |
| GET    | `/users/me`        | Current user profile                 |
| GET    | `/workspaces/me`   | Current workspace                    |
| GET    | `/integrations`    | Workspace integrations               |
| GET    | `/skills`          | Skill catalogue                      |
| GET    | `/tasks`           | Scheduled tasks                      |
| GET    | `/usage/summary`   | Credit/token totals                  |

All non-`@Public()` routes require a valid `Authorization: Bearer <accessToken>`.

## Database & Migrations

Schema is migration-driven (`synchronize: false`). Entities use **UUID** primary keys.

```bash
npm run migration:run        # apply migrations
npm run migration:revert     # roll back the last migration
npm run migration:generate -- src/database/migrations/<Name>   # generate from entity diff
```

## Scripts

| Script                  | Description                         |
| ----------------------- | ----------------------------------- |
| `npm run start:dev`     | Watch-mode dev server               |
| `npm run build`         | Compile to `dist/`                  |
| `npm run start:prod`    | Run compiled build                  |
| `npm run lint`          | ESLint (flat config) + Prettier     |
| `npm run migration:run` | Apply pending migrations            |

## Security

- `helmet` security headers
- CORS restricted to `FRONTEND_URL`
- Global `ValidationPipe` (whitelist + transform)
- Global exception filter (consistent error envelope)
- Strict TypeScript, no `any`
- Multi-tenant isolation: every tenant-scoped query is keyed by `workspaceId`
```
