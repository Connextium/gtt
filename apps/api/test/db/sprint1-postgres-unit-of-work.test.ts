import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  executeSprint1PostgresCommand,
  handleSprint1PostgresCommand
} from "../../src/db/sprint1-postgres-unit-of-work.js";
import { setPostgresPoolForTest } from "../../src/db/transaction.js";
import { requestHash } from "../../src/events/idempotency.js";

type QueryResult = { rows: Array<Record<string, unknown>> };

const withDatabaseUrl = async (work: () => Promise<void>): Promise<void> => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousTenant = process.env.GTT_PLATFORM_TENANT_ID;
  process.env.DATABASE_URL = "postgresql://test";
  process.env.GTT_PLATFORM_TENANT_ID = "00000000-0000-4000-8000-000000000001";
  try {
    await work();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousTenant === undefined) delete process.env.GTT_PLATFORM_TENANT_ID;
    else process.env.GTT_PLATFORM_TENANT_ID = previousTenant;
    setPostgresPoolForTest(undefined);
  }
};

test("business client command writes domain, audit, outbox, and idempotency in one unit", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      return { rows: [] };
    }
  };
  const input = {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "Repository Client", country: "US" },
    idempotencyKey: "idem-client",
    correlationId: "corr-client"
  };

  const result = await executeSprint1PostgresCommand(client as never, input, requestHash(input));

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into business_clients")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("matching idempotent command replays response before domain writes", async () => {
  const queries: string[] = [];
  const input = {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "Replay Client" },
    idempotencyKey: "idem-replay",
    correlationId: "corr-replay"
  };
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) {
        return {
          rows: [
            {
              request_hash: requestHash(input),
              response_snapshot: { businessClient: { id: "client_existing" } }
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executeSprint1PostgresCommand(client as never, input, requestHash(input));

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { businessClient: { id: "client_existing" } });
  assert.equal(queries.some((sql) => sql.includes("insert into business_clients")), false);
});

test("changed idempotent command rejects before domain writes", async () => {
  const input = {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "Changed Client" },
    idempotencyKey: "idem-changed",
    correlationId: "corr-changed"
  };
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      if (sql.includes("from api_idempotency_records")) {
        return { rows: [{ request_hash: "different_hash", response_snapshot: { ok: true } }] };
      }
      return { rows: [] };
    }
  };

  await assert.rejects(
    () => executeSprint1PostgresCommand(client as never, input, requestHash(input)),
    /idempotency_key_reused_with_different_request/
  );
});

test("opening journal command writes two single-sided journal lines from posting rule", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from posting_rules")) {
        return {
          rows: [
            {
              rule_name: "Opening ADA journal",
              debit_ledger_account_code: "10020",
              credit_ledger_account_code: "20400"
            }
          ]
        };
      }
      if (sql.includes("from ledger_accounts")) {
        return {
          rows: [
            { id: "00000000-0000-4000-8000-000000010020", account_code: "10020" },
            { id: "00000000-0000-4000-8000-000000020400", account_code: "20400" }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executeSprint1PostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/ledger/events/opening-journal",
      body: {
        accountOfDigitalAssetId: "00000000-0000-4000-8000-000000000777",
        amountMinorUnits: "1000000"
      },
      idempotencyKey: "idem-journal",
      correlationId: "corr-journal"
    },
    "journal_hash"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into treasury_journal_entries")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into treasury_journal_lines")), true);
});

test("postgres command rolls back domain write, audit, outbox, and idempotency on failure", async () => {
  await withDatabaseUrl(async () => {
    const queries: string[] = [];
    const pool = {
      connect: async () => ({
        query: async (sql: string): Promise<QueryResult> => {
          queries.push(sql);
          if (sql.includes("insert into audit_events")) throw new Error("audit_insert_failed");
          return { rows: [] };
        },
        release: () => queries.push("release")
      })
    } as unknown as pg.Pool;
    setPostgresPoolForTest(pool);

    await assert.rejects(
      () =>
        handleSprint1PostgresCommand({
          method: "POST",
          pathname: "/business-clients",
          body: { legalName: "Rollback Client" },
          idempotencyKey: "idem-rollback",
          correlationId: "corr-rollback"
        }),
      /audit_insert_failed/
    );

    assert.deepEqual(queries.slice(0, 2), ["begin", queries[1]]);
    assert.equal(queries.includes("rollback"), true);
    assert.equal(queries.includes("commit"), false);
    assert.equal(queries.at(-1), "release");
  });
});
