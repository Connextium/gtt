import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { encodeBigInts, loadApiStateSnapshot, reviveApiStateSnapshot, saveApiStateSnapshot, stateStoreStatus } from "../../src/db/state-store.js";

test("revives wrapped runtime state snapshots", () => {
  const state = createInitialState();
  const wrapped = {
    snapshotName: "default",
    schemaVersion: "0012",
    state: encodeBigInts(state)
  };

  const revived = reviveApiStateSnapshot(wrapped, createInitialState());

  assert.equal(revived.tenantId, state.tenantId);
  assert.equal(revived.apiKeys[0]?.id, "api_key_dev");
  assert.equal(typeof revived.balances[0]?.availableMinorUnits, "bigint");
});

test("falls back for invalid runtime state snapshots", () => {
  const fallback = createInitialState();
  const revived = reviveApiStateSnapshot({ snapshotName: "default" }, fallback);

  assert.equal(revived, fallback);
});

test("direct Postgres mode does not use snapshot-backed state", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseDbUrl = process.env.SUPABASE_DB_URL;
  const previousStateFile = process.env.GTT_STATE_STORE_FILE;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  process.env.DATABASE_URL = "postgresql://user:pass@db.invalid.example:5432/postgres";
  delete process.env.SUPABASE_DB_URL;
  delete process.env.GTT_STATE_STORE_FILE;
  delete process.env.SUPABASE_URL;
  try {
    const fallback = createInitialState();
    const loaded = await loadApiStateSnapshot(fallback);
    await saveApiStateSnapshot(loaded);

    assert.equal(loaded, fallback);
    assert.equal(stateStoreStatus.loaded, false);
    assert.equal(stateStoreStatus.persisted, false);
    assert.equal(stateStoreStatus.error, undefined);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSupabaseDbUrl === undefined) delete process.env.SUPABASE_DB_URL;
    else process.env.SUPABASE_DB_URL = previousSupabaseDbUrl;
    if (previousStateFile === undefined) delete process.env.GTT_STATE_STORE_FILE;
    else process.env.GTT_STATE_STORE_FILE = previousStateFile;
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
  }
});
