import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("Sprint 1 review migration keeps SQL chart of accounts in parity with runtime requirements", () => {
  const sql = readFileSync(migrationPath("0015_sprint1_review_completion_fixes.sql"), "utf8");

  assert.match(sql, /20430/);
  assert.match(sql, /20440/);
  assert.match(sql, /posting_rules/);
  assert.match(sql, /debit_ledger_account_code/);
  assert.match(sql, /credit_ledger_account_code/);
});

test("Client funding conversion migration seeds USD cash and pending liability accounts", () => {
  const sql = readFileSync(migrationPath("0034_client_funding_conversion_accounting.sql"), "utf8");

  assert.match(sql, /10010/);
  assert.match(sql, /Circle Business Account USD Cash/);
  assert.match(sql, /20500/);
  assert.match(sql, /Pending Fiat-to-USDC Conversion/);
});

test("Client funding balance backfill inserts only missing ADA projections", () => {
  const sql = readFileSync(migrationPath("0035_backfill_missing_client_ada_balances.sql"), "utf8");

  assert.match(sql, /instruction_role = 'client_exchange'/);
  assert.match(sql, /not exists\s*\(/);
  assert.match(sql, /sum\(coalesce\(instruction\.available_usdc_minor_units/);
  assert.match(sql, /sum\(coalesce\(instruction\.pending_usdc_minor_units/);
  assert.match(sql, /on conflict \(account_of_digital_asset_id, asset_code, currency\) do nothing/);
});

test("Settlement advance migration adds durable transfer and tenant disbursement records", () => {
  const sql = readFileSync(migrationPath("0036_sprint5_2_settlement_advance_tenant_disbursement.sql"), "utf8");

  assert.match(sql, /create table if not exists settlement_advance_transfers/);
  assert.match(sql, /create table if not exists settlement_advance_wire_proofs/);
  assert.match(sql, /create table if not exists tenant_disbursements/);
  assert.match(sql, /settlement_advance_transfer_id uuid references settlement_advance_transfers/);
  assert.match(sql, /tenant_disbursement_id uuid references tenant_disbursements/);
});

const migrationPath = (filename: string): string =>
  fileURLToPath(new URL(`../../../../supabase/migrations/${filename}`, import.meta.url));
