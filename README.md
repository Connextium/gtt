# Global Trade Treasury

Repository for the Global Trade Treasury MVP.

## Target Application Structure

```text
repo/gtt
  apps/api          Actual backend API
  apps/web          Frontend UI
```

The current `src/sprint*` folders are sprint execution evidence. They are not the final application shell. Durable backend implementation lives inside `apps/api`; the web UI lives inside `apps/web`.

## Phase 0 Baseline

This repo establishes:

- TypeScript project baseline.
- Circle adapter contract.
- In-memory Circle simulator fallback.
- Initial PostgreSQL migration.
- CI check workflow.
- Migration validation script.

## Commands

```bash
npm install
npm run check
npm run migrations:check
npm run test:sprint1
npm run test:sprint2
npm run test:sprint3
npm run test:sprint4
npm run test:sprint5
npm run test:sprint6
npm run test:sprint7
npm run test:sprint8
npm run test:sprint9
npm run demo:sprint1
npm run demo:sprint2
npm run demo:sprint3
npm run demo:sprint4
npm run demo:sprint5
npm run demo:sprint6
npm run demo:sprint7
npm run demo:sprint8
npm run api:dev
npm run api:build
npm run api:smoke
npm run api:start
npm run web:dev
npm run web:build
npm run web:preview
npm run workspaces:check
```

## Environment

Copy `.env.example` to the local environment mechanism used by the developer shell. Do not commit real secrets.

## Source Documents

Execution artifacts are stored in `../../AssetManagement/PlanB/Execution`.
