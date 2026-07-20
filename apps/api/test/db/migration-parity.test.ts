import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("Sprint 1 review migration keeps SQL chart of accounts in parity with runtime requirements", () => {
  const sql = readFileSync(path.resolve("../../supabase/migrations/0015_sprint1_review_completion_fixes.sql"), "utf8");

  assert.match(sql, /20430/);
  assert.match(sql, /20440/);
  assert.match(sql, /posting_rules/);
  assert.match(sql, /debit_ledger_account_code/);
  assert.match(sql, /credit_ledger_account_code/);
});
