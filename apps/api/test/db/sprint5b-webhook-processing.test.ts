import assert from "node:assert/strict";
import test from "node:test";
import { processFundingInstructionWebhookEvent } from "../../src/db/postgres-route-handler.js";

type QueryResult = { rows: Array<Record<string, unknown>> };

const tenantId = "00000000-0000-4000-8000-000000000001";
const instructionId = "00000000-0000-4000-8000-000000000401";
const destinationId = "00000000-0000-4000-8000-000000000302";
const tenantFiatAccountId = "00000000-0000-4000-8000-000000000303";
const tenantUsdcAccountId = "00000000-0000-4000-8000-000000000304";
const settlementJournalEntryId = "00000000-0000-4000-8000-000000000601";

test("sprint5b: wire confirmation reserves pending funds and posts fiat settlement", async () => {
  const queries: string[] = [];
  const journalLines: unknown[][] = [];
  const client = webhookClient(queries, { status: "pending_confirmation" }, journalLines);
  await processFundingInstructionWebhookEvent(
    client as never,
    tenantId,
    webhookInput(),
    "00000000-0000-4000-8000-000000000501",
    webhookEvent("wire.received")
  );

  assert.equal(queries.some((sql) => sql.includes("pending_usdc_minor_units = coalesce") && sql.includes("wire_confirmed_webhook_event_id")), true);
  assert.equal(queries.some((sql) => sql.includes("available_usdc_minor_units = coalesce")), false);
  assert.equal(queries.filter((sql) => sql.includes("insert into treasury_journal_entries")).length, 1);
  assert.equal(queries.filter((sql) => sql.includes("insert into treasury_journal_lines")).length, 2);
  assert.equal(queries.some((sql) => sql.includes("insert into account_of_digital_asset_balances") && sql.includes("pending_minor_units")), true);
  assert.equal(queries.some((sql) => sql.includes("order_kind = 'ada_wire_transfer'") && sql.includes("set journal_entry_id")), true);
  assert.deepEqual(journalLines.map((values) => values.slice(2)), [
    ["ledger-10010", tenantFiatAccountId, "USD", "2500000", "0"],
    ["ledger-20500", destinationId, "USD", "0", "2500000"]
  ]);
});

test("sprint5b: persisted wire completion marker makes a repeated stage a no-op", async () => {
  const queries: string[] = [];
  const client = webhookClient(queries, {
    status: "pending_usdc_reserved",
    wire_confirmed_webhook_event_id: "00000000-0000-4000-8000-000000000500"
  });
  await processFundingInstructionWebhookEvent(
    client as never,
    tenantId,
    webhookInput(),
    "00000000-0000-4000-8000-000000000501",
    webhookEvent("wire.received")
  );

  assert.equal(queries.some((sql) => sql.includes("update funding_instruction_orders")), false);
  assert.equal(queries.some((sql) => sql.includes("pending_usdc_minor_units = coalesce")), false);
});

test("sprint5b: USDC confirmation posts four-line conversion journal and links the USDC order", async () => {
  const queries: string[] = [];
  const journalLines: unknown[][] = [];
  const client = webhookClient(queries, {
    status: "pending_usdc_reserved",
    wire_confirmed_webhook_event_id: "00000000-0000-4000-8000-000000000500"
  }, journalLines);
  await processFundingInstructionWebhookEvent(
    client as never,
    tenantId,
    webhookInput(),
    "00000000-0000-4000-8000-000000000502",
    webhookEvent("usdc.delivery.confirmed")
  );

  assert.equal(queries.filter((sql) => sql.includes("insert into treasury_journal_entries")).length, 1);
  assert.equal(queries.filter((sql) => sql.includes("insert into treasury_journal_lines")).length, 4);
  assert.equal(queries.some((sql) => sql.includes("usdc_confirmed_webhook_event_id")), true);
  assert.equal(queries.some((sql) => sql.includes("set posting_journal_entry_id")), true);
  assert.equal(queries.some((sql) => sql.includes("set journal_entry_id") && sql.includes("order_kind = $4")), true);
  assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances") && sql.includes("pending_minor_units = greatest")), true);
  assert.deepEqual(journalLines.map((values) => values.slice(2)), [
    ["ledger-10020", tenantUsdcAccountId, "USDC", "2500000", "0"],
    ["ledger-10010", tenantFiatAccountId, "USD", "0", "2500000"],
    ["ledger-20500", destinationId, "USD", "2500000", "0"],
    ["ledger-20430", destinationId, "USDC", "0", "2500000"]
  ]);
});

test("sprint5b: amount mismatch enters reconciliation without posting funds", async () => {
  const queries: string[] = [];
  const client = webhookClient(queries, { status: "pending_confirmation" });
  await processFundingInstructionWebhookEvent(
    client as never,
    tenantId,
    webhookInput(),
    "00000000-0000-4000-8000-000000000503",
    { ...webhookEvent("wire.received"), amountMinorUnits: "2600000" }
  );

  assert.equal(queries.some((sql) => sql.includes("'funding_amount_mismatch'")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into treasury_journal_entries")), false);
  assert.equal(queries.some((sql) => sql.includes("set pending_usdc_minor_units") && sql.includes("available_usdc_minor_units")), false);
});

const webhookClient = (
  queries: string[],
  instruction: Record<string, unknown>,
  journalLines: unknown[][] = []
) => ({
  query: async (sql: string, values?: unknown[]): Promise<QueryResult> => {
    queries.push(sql);
    if (sql.includes("insert into treasury_journal_lines")) journalLines.push(values ?? []);
    if (sql.includes("from wire_funding_instructions") && sql.includes("for update")) {
      return {
        rows: [{
          id: instructionId,
          account_of_digital_asset_id: destinationId,
          destination_account_of_digital_asset_id: destinationId,
          amount_minor_units: "2500000",
          pending_usdc_minor_units: "2500000",
          available_usdc_minor_units: "0",
          instruction_role: "client_exchange",
          wire_confirmed_webhook_event_id: null,
          usdc_confirmed_webhook_event_id: null,
          posting_journal_entry_id: null,
          ...instruction
        }]
      };
    }
    if (sql.includes("from funding_instruction_orders") && sql.includes("order_kind = 'ada_wire_transfer'")) {
      return {
        rows: [{
          status: "completed",
          destination_account_of_digital_asset_id: tenantFiatAccountId,
          tenant_fiat_account_id: tenantFiatAccountId,
          tenant_usdc_account_id: tenantUsdcAccountId,
          settlement_journal_entry_id: settlementJournalEntryId
        }]
      };
    }
    if (sql.includes("from ledger_accounts")) {
      return {
        rows: [
          { id: "ledger-10010", account_code: "10010" },
          { id: "ledger-10020", account_code: "10020" },
          { id: "ledger-20430", account_code: "20430" },
          { id: "ledger-20500", account_code: "20500" }
        ]
      };
    }
    if (sql.includes("update account_of_digital_asset_balances") && sql.includes("returning id")) {
      return { rows: [{ id: "balance-client-usdc" }] };
    }
    return { rows: [] };
  }
});

const webhookInput = () => ({
  method: "POST",
  pathname: "/webhooks/circle",
  body: {},
  idempotencyKey: "webhook-idempotency",
  correlationId: "webhook-correlation"
});

const webhookEvent = (eventType: string) => ({
  providerEventId: `provider-${eventType}`,
  eventType,
  fundingInstructionId: instructionId,
  providerReferenceId: `reference-${eventType}`,
  destinationAccountOfDigitalAssetId: destinationId,
  amountMinorUnits: "2500000",
  payload: { eventType }
});