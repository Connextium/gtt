import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "apps/api/src/domain/index.ts",
  "apps/api/src/db/migrations-catalog/index.ts",
  "apps/api/src/db/transaction.ts",
  "apps/api/src/db/repositories/index.ts",
  "apps/api/src/db/state-store.ts",
  "apps/api/src/auth/index.ts",
  "apps/api/src/auth/middleware.ts",
  "apps/api/src/modules/circle/index.ts",
  "apps/api/src/events/idempotency.ts",
  "apps/api/src/http/index.ts",
  "apps/api/src/http/router.ts",
  "apps/api/src/index.ts",
  "apps/api/src/workers/index.ts",
  "apps/api/src/workers/scheduler.ts",
  "apps/web/src/index.ts"
];

for (const file of requiredFiles) {
  readFileSync(join(root, file), "utf8");
}

const domainSource = readFileSync(join(root, "apps/api/src/domain/index.ts"), "utf8");
const dbSource = readFileSync(join(root, "apps/api/src/db/migrations-catalog/index.ts"), "utf8");
const apiSource = readFileSync(join(root, "apps/api/src/index.ts"), "utf8");
const webSource = readFileSync(join(root, "apps/web/src/index.ts"), "utf8");
const migrationFiles = readdirSync(join(root, "supabase/migrations")).filter((file) => file.endsWith(".sql")).sort();

const assertions = [
  [domainSource.includes("evaluatePilotReadiness"), "domain readiness evaluator missing"],
  [domainSource.includes("recommendInternalRebalance"), "domain rebalance helper missing"],
  [dbSource.includes("0012_api_runtime_state_snapshots.sql"), "db catalog does not include migration 0012"],
  [dbSource.includes("validateMigrationCatalog"), "db migration validator missing"],
  [apiSource.includes("/release-readiness"), "api release-readiness route contract missing"],
  [apiSource.includes("applicationManifest"), "api manifest missing"],
  [webSource.includes("Release Readiness"), "web release readiness navigation missing"],
  [webSource.includes("contract_ready"), "web app shell status missing"],
  [migrationFiles.length === 15, `expected 15 migration files, found ${migrationFiles.length}`],
  [migrationFiles.at(-1)?.startsWith("0015_"), "latest migration should be 0015"]
];

const failures = assertions.filter(([condition]) => !condition).map(([, message]) => message);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("Sprint 9 app buildout structure passed");
