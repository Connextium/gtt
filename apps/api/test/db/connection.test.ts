import assert from "node:assert/strict";
import test from "node:test";
import { databaseModeFromEnv, databaseUrlFromEnv, postgresUrlFromEnv } from "../../src/db/connection.js";
import { requireDatabaseUrl } from "../../src/db/migrations-catalog/index.js";

const withEnv = (values: Record<string, string | undefined>, work: () => void): void => {
  const keys = ["DATABASE_URL", "SUPABASE_DB_URL", "GTT_STATE_STORE_FILE", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
  try {
    work();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
};

test("direct Postgres DATABASE_URL takes precedence over Supabase URL and file mode", () => {
  withEnv(
    {
      DATABASE_URL: "postgresql://user:pass@db.example.com:5432/postgres",
      SUPABASE_URL: "https://example.supabase.co",
      GTT_STATE_STORE_FILE: "/tmp/state.json"
    },
    () => {
      assert.equal(postgresUrlFromEnv(), "postgresql://user:pass@db.example.com:5432/postgres");
      assert.equal(databaseUrlFromEnv(), "postgresql://user:pass@db.example.com:5432/postgres");
      assert.equal(databaseModeFromEnv(), "postgres");
    }
  );
});

test("SUPABASE_DB_URL is accepted as direct Postgres database URL", () => {
  withEnv({ SUPABASE_DB_URL: "postgresql://user:pass@db.example.com:5432/postgres", SUPABASE_URL: "https://example.supabase.co" }, () => {
    assert.equal(postgresUrlFromEnv(), "postgresql://user:pass@db.example.com:5432/postgres");
    assert.equal(databaseModeFromEnv(), "postgres");
  });
});

test("ignores local file mode and falls back to Supabase REST mode", () => {
  withEnv({ GTT_STATE_STORE_FILE: "/tmp/state.json", SUPABASE_URL: "https://example.supabase.co" }, () => {
    assert.equal(databaseUrlFromEnv(), "https://example.supabase.co");
    assert.equal(databaseModeFromEnv(), "supabase");
  });

  withEnv({ GTT_STATE_STORE_FILE: "/tmp/state.json" }, () => {
    assert.equal(databaseUrlFromEnv(), undefined);
    assert.equal(databaseModeFromEnv(), "unconfigured");
  });

  withEnv({ SUPABASE_URL: "https://example.supabase.co" }, () => {
    assert.equal(databaseUrlFromEnv(), "https://example.supabase.co");
    assert.equal(databaseModeFromEnv(), "supabase");
  });
});

test("migration catalog accepts direct Postgres URL variables", () => {
  assert.equal(requireDatabaseUrl({ DATABASE_URL: "postgresql://primary" }), "postgresql://primary");
  assert.equal(requireDatabaseUrl({ SUPABASE_DB_URL: "postgresql://supabase" }), "postgresql://supabase");
});
