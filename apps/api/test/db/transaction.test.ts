import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { setPostgresPoolForTest, withPostgresTransaction } from "../../src/db/transaction.js";

const withDatabaseUrl = async (work: () => Promise<void>): Promise<void> => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://test";
  try {
    await work();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
    setPostgresPoolForTest(undefined);
  }
};

const fakePool = (queries: string[], failInside = false): pg.Pool =>
  ({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (failInside && sql === "select 1") throw new Error("query_failed");
        return { rows: [] };
      },
      release: () => {
        queries.push("release");
      }
    })
  }) as unknown as pg.Pool;

test("withPostgresTransaction commits successful work", async () => {
  await withDatabaseUrl(async () => {
    const queries: string[] = [];
    setPostgresPoolForTest(fakePool(queries));

    await withPostgresTransaction(async (client) => {
      await client.query("select 1");
    });

    assert.deepEqual(queries, ["begin", "select 1", "commit", "release"]);
  });
});

test("withPostgresTransaction rolls back failed work", async () => {
  await withDatabaseUrl(async () => {
    const queries: string[] = [];
    setPostgresPoolForTest(fakePool(queries, true));

    await assert.rejects(
      () =>
        withPostgresTransaction(async (client) => {
          await client.query("select 1");
        }),
      /query_failed/
    );

    assert.deepEqual(queries, ["begin", "select 1", "rollback", "release"]);
  });
});
