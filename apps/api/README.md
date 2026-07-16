# API App

Backend API for Global Trade Treasury Operations Console.

## Commands

```bash
npm run dev --workspace @gtt/api
npm run build --workspace @gtt/api
npm run start --workspace @gtt/api
npm run smoke --workspace @gtt/api
npm run check --workspace @gtt/api
npm run worker --workspace @gtt/api
npm run scheduler --workspace @gtt/api
```

From the repo root:

```bash
npm run api:dev
npm run api:build
npm run api:start
npm run api:smoke
npm run api:worker
npm run api:scheduler
```

The API uses typed runtime repositories plus explicit Supabase/Circle/event boundaries. Migration `0011` defines durable tables for API keys, idempotency, event queues, Circle operation evidence, and webhook payloads. Migration `0012` adds an API runtime state snapshot table so local command state can persist across restarts when `DATABASE_URL` or `SUPABASE_DB_URL` is configured.

Without a database URL, the API runs in deterministic in-memory mode for local development and smoke tests.

## Source Layout

```text
src
  http
  modules
  db
    repositories
    migrations-catalog
    transaction.ts
  workers
  webhooks
  auth
  events
```

Implemented runtime boundaries:

- API key authentication and scoped authorization.
- Idempotency-key replay for command endpoints.
- Audit metadata for API reads and commands.
- API-owned database client and transaction helper.
- API-owned repository interfaces.
- Durable runtime snapshot persistence when a database URL is configured.
- Circle simulator and HTTP adapter modes.
- Circle webhook ingest, duplicate replay safety, and normalized inbox events.
- Outbox/inbox worker entrypoint.
- Reservation/reconciliation scheduler entrypoint.

Security boundary:

- API key plaintext is returned only once at creation.
- Supabase stores API key hashes and non-secret metadata only.
- Do not store API key secrets, passwords, Circle secrets, or Supabase passwords in Supabase tables, runtime snapshots, source files, logs, or Apple Keychain as part of API key setup.
- Use environment variables for runtime credentials; keep local env files out of source control.

Circle adapter mode:

```bash
CIRCLE_ENVIRONMENT=simulator
CIRCLE_ENVIRONMENT=circle-sandbox
CIRCLE_ENVIRONMENT=circle-production
```

Real Circle HTTP mode requires runtime environment variables only:

```bash
CIRCLE_API_BASE_URL=...
CIRCLE_API_KEY=...
CIRCLE_WEBHOOK_SECRET=...
CIRCLE_TIMEOUT_MS=10000
CIRCLE_RETRY_MAX_ATTEMPTS=2
```

## Authentication

Most endpoints require an API key:

```bash
Authorization: Bearer gtt_live_<key_id>.<secret>
```

Local development seed key:

```text
gtt_live_api_key_dev.dev_secret
```

Example:

```bash
curl http://localhost:4000/business-clients \
  -H 'authorization: Bearer gtt_live_api_key_dev.dev_secret'
```

## Endpoints

- `GET /health`
- `GET /manifest`
- `GET /version`
- `GET /readiness`
- `POST /api-keys`
- `GET /api-keys`
- `GET /api-keys/:id`
- `POST /api-keys/:id/revoke`
- `POST /api-keys/:id/rotate`
- `POST /business-clients`
- `GET /business-clients`
- `GET /business-clients/:id`
- `POST /business-clients/:id/submit-onboarding`
- `POST /business-clients/:id/map-circle`
- `POST /accounts-of-digital-asset`
- `GET /accounts-of-digital-asset`
- `GET /accounts-of-digital-asset/:id`
- `POST /accounts-of-digital-asset/:id/provision-circle`
- `GET /accounts-of-digital-asset/:id/balance`
- `GET /accounts-of-digital-asset/:id/statement`
- `GET /ledger/chart-of-accounts`
- `POST /ledger/journals`
- `GET /ledger/journals`
- `POST /settlement-obligations`
- `GET /settlement-obligations`
- `POST /funding-reservations`
- `GET /funding-reservations`
- `POST /payments/internal`
- `POST /payments/external-usdc`
- `GET /payments`
- `POST /payments/:id/submit`
- `POST /payments/:id/refresh-status`
- `POST /fiat/wire-accounts`
- `GET /fiat/wire-accounts`
- `POST /fiat/redemptions`
- `GET /fiat/redemptions`
- `GET /liquidity-rebalancing/recommendations`
- `POST /liquidity-rebalancing/instructions`
- `POST /liquidity-rebalancing/instructions/:id/approve`
- `POST /liquidity-rebalancing/instructions/:id/execute`
- `POST /reconciliation/runs`
- `GET /reconciliation/runs`
- `GET /reconciliation/breaks`
- `POST /reconciliation/breaks/:id/assign`
- `POST /reconciliation/breaks/:id/resolve`
- `POST /webhooks/circle`
- `GET /webhooks/circle/events`
- `GET /events/outbox`
- `GET /events/inbox`
- `GET /dead-letter`
- `GET /treasury-accounting/trial-balance`
- `GET /reports/daily-close`
- `GET /uat/scenarios`
- `GET /release-readiness`

See `openapi.yaml` for the API contract.

## Sprint 0 Business User Self-Registration

Implemented API-centric Supabase Auth onboarding endpoints:

- `POST /auth/invitations`
- `GET /onboarding/me`
- `PATCH /onboarding/me/steps/:stepKey`
- `POST /onboarding/me/submit`

Runtime variables:

```bash
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
AUTH_INVITE_REDIRECT_URL=http://localhost:5173/auth/set-password
```

For local API tests without Supabase credentials:

```bash
ALLOW_DEV_WITHOUT_SUPABASE=true
```

Migration `0013_sprint0_business_user_self_registration_auth.sql` adds invitation, business user profile, onboarding application, and onboarding step payload tables with RLS. Business user passwords are never stored by this API; Supabase Auth owns credential storage.
