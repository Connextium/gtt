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

test("Sprint 6 migration adds obligation events, journal links, and reservation consume fields", () => {
  const sql = readFileSync(migrationPath("0037_sprint6_settlement_obligations_funding_reservations.sql"), "utf8");

  assert.match(sql, /add column if not exists principal_minor_units/);
  assert.match(sql, /add column if not exists fulfilled_minor_units/);
  assert.match(sql, /create table if not exists obligation_events/);
  assert.match(sql, /create table if not exists obligation_journal_links/);
  assert.match(sql, /add column if not exists consumed_at/);
  assert.match(sql, /funding_reservation\.consumed/);
});

test("Sprint 7 migration adds route models and internal ADA settlement lifecycle tables", () => {
  const sql = readFileSync(migrationPath("0038_sprint7_payment_instruction_router_internal_ada_settlement.sql"), "utf8");

  assert.match(sql, /add column if not exists instruction_type/);
  assert.match(sql, /create table if not exists route_profiles/);
  assert.match(sql, /create table if not exists route_bindings/);
  assert.match(sql, /create table if not exists routing_decisions/);
  assert.match(sql, /create table if not exists internal_ada_settlements/);
  assert.match(sql, /create table if not exists routing_and_settlement_events/);
  assert.match(sql, /unique \(platform_tenant_id, payment_instruction_id\)/);
});

test("Business auth sessions migration adds durable access/refresh token session mappings", () => {
  const sql = readFileSync(migrationPath("0040_business_auth_sessions_refresh_tokens.sql"), "utf8");

  assert.match(sql, /create table if not exists business_auth_sessions/);
  assert.match(sql, /access_jti uuid not null unique/);
  assert.match(sql, /refresh_jti uuid not null unique/);
  assert.match(sql, /supabase_access_token text not null/);
  assert.match(sql, /supabase_refresh_token text/);
  assert.match(sql, /revoked_at timestamptz/);
});

const migrationPath = (filename: string): string =>
  fileURLToPath(new URL(`../../../../supabase/migrations/${filename}`, import.meta.url));
