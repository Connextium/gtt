import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  executePostgresCommand,
  executePostgresQueryWithClient,
  handlePostgresCommand
} from "../../src/db/postgres-route-handler.js";
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

  const result = await executePostgresCommand(client as never, input, requestHash(input));

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into business_clients")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("api key command stores only hash metadata and returns one-time plaintext", async () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/api-keys",
      body: { clientName: "Treasury Integration", scopes: ["read:operations", "write:ledger"] },
      idempotencyKey: "idem-api-key",
      correlationId: "corr-api-key"
    },
    "api_key_hash"
  );

  assert.equal(result.status, 201);
  const body = result.body as { key: Record<string, unknown>; plaintextKey: string };
  assert.equal(typeof body.plaintextKey, "string");
  assert.equal("keyHash" in body.key, false);
  assert.equal(queries.some((sql) => sql.includes("insert into api_clients")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_keys")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(params.flat().some((value) => typeof value === "string" && value.startsWith("hmac-sha256:")), true);
  assert.equal(params.flat().some((value) => typeof value === "string" && value.startsWith("gtt_live_") && value.includes(".")), false);
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

  const result = await executePostgresCommand(client as never, input, requestHash(input));

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
    () => executePostgresCommand(client as never, input, requestHash(input)),
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

  const result = await executePostgresCommand(
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

test("manual journal command writes balanced treasury journal entry and lines", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from ledger_accounts where account_code = any")) {
        return {
          rows: [
            { id: "00000000-0000-4000-8000-000000010020", account_code: "10020" },
            { id: "00000000-0000-4000-8000-000000020430", account_code: "20430" }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/ledger/journals",
      body: {
        amountMinorUnits: "2500000",
        debitLedgerAccountCode: "10020",
        creditLedgerAccountCode: "20430",
        description: "Manual funding journal"
      },
      idempotencyKey: "idem-manual-journal",
      correlationId: "corr-manual-journal"
    },
    "manual_journal_hash"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into treasury_journal_entries")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into treasury_journal_lines")), true);
});

test("trial balance query endpoint returns aggregate debit and credit totals", async () => {
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      if (sql.includes("from ledger_accounts ledger")) {
        return {
          rows: [
            {
              account_code: "10020",
              account_name: "Circle Business Account USDC",
              total_debit_minor_units: "2500000",
              total_credit_minor_units: "0"
            },
            {
              account_code: "20430",
              account_name: "Customer ADA Available Liability",
              total_debit_minor_units: "0",
              total_credit_minor_units: "2500000"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresQueryWithClient(client as never, {
    method: "GET",
    pathname: "/treasury-accounting/trial-balance",
    body: {},
    correlationId: "corr-trial-balance"
  });

  assert.equal(result.status, 200);
  const body = result.body as {
    lines: Array<{ accountCode: string }>;
    totalDebitMinorUnits: string;
    totalCreditMinorUnits: string;
    balanced: boolean;
  };
  assert.equal(body.lines.length, 2);
  assert.equal(body.totalDebitMinorUnits, "2500000");
  assert.equal(body.totalCreditMinorUnits, "2500000");
  assert.equal(body.balanced, true);
});

test("business client lifecycle command writes transition, audit, outbox, and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("select id, onboarding_status")) return { rows: [{ id: "client_1", onboarding_status: "submitted" }] };
      if (sql.includes("select id, platform_tenant_id, legal_name")) {
        return {
          rows: [
            {
              id: "client_1",
              platform_tenant_id: "tenant_1",
              legal_name: "Client",
              country: "US",
              onboarding_status: "approved",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/business-clients/client_1/map-circle",
      body: { circleClientEntityId: "circle_client_1", circleApplicationId: "circle_app_1" },
      idempotencyKey: "idem-client-transition",
      correlationId: "corr-client-transition"
    },
    "client_transition_hash"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("insert into business_client_lifecycle_transitions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("ADA lifecycle command writes transition with tenant-bound client validation", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from accounts_of_digital_asset account")) return { rows: [{ id: "ada_1", status: "active", business_client_id: "client_1" }] };
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "ada_1",
              platform_tenant_id: "tenant_1",
              business_client_id: "client_1",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "restricted",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/ada_1/restrict",
      body: { reason: "Compliance review" },
      idempotencyKey: "idem-ada-transition",
      correlationId: "corr-ada-transition"
    },
    "ada_transition_hash"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("join business_clients client")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into account_of_digital_asset_lifecycle_transitions")), true);
});

test("ADA linked rail command writes rail, linked instrument, audit, outbox, and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              platform_tenant_id: "00000000-0000-4000-8000-000000000001",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "active",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("returning id, account_of_digital_asset_id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000888",
              account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
              instrument_type: "on_chain_wallet",
              status: "active",
              provider_reference: "ethereum_usdc",
              created_at: "2026-01-02T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/00000000-0000-4000-8000-000000000777/linked-instruments",
      body: {
        assetCode: "USDC",
        reference: "ethereum_usdc",
        instrumentType: "on_chain_wallet",
        railCode: "ethereum_usdc",
        railName: "Ethereum USDC"
      },
      idempotencyKey: "idem-linked-rail",
      correlationId: "corr-linked-rail"
    },
    "linked_rail_hash"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into asset_rails")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("ADA fiat wire linked instrument in circle sandbox requires CIRCLE_MINT_KEY or CIRCLE_API_KEY", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  const previousMintKey = process.env.CIRCLE_MINT_KEY;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  delete process.env.CIRCLE_API_KEY;
  delete process.env.CIRCLE_MINT_KEY;

  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              platform_tenant_id: "00000000-0000-4000-8000-000000000001",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "active",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              metadata: {},
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/accounts-of-digital-asset/00000000-0000-4000-8000-000000000777/linked-instruments",
        body: {
          assetCode: "USDC",
          instrumentType: "fiat_wire_bank_account",
          accountNumber: "123456789",
          routingNumber: "011000015",
          railCode: "fiat-checking-011000015",
          railName: "Platform Treasury Bank",
          railType: "fiat",
          networkCode: "011000015"
        },
        idempotencyKey: "idem-linked-fiat-wire-sandbox-missing-key",
        correlationId: "corr-linked-fiat-wire-sandbox-missing-key"
      },
      "linked_fiat_wire_missing_key_hash"
    );

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "circle_api_key_required");
    assert.equal(queries.some((sql) => sql.includes("insert into asset_rails")), false);
    assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), false);
    assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), false);
    assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
    if (previousMintKey === undefined) delete process.env.CIRCLE_MINT_KEY;
    else process.env.CIRCLE_MINT_KEY = previousMintKey;
  }
});

test("ADA activation command enforces instrument and Circle mapping gates transactionally", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from accounts_of_digital_asset account")) {
        return {
          rows: [
            {
              id: "ada_1",
              status: "pending_activation",
              asset_rail: "circle_internal",
              circle_account_id: "circle_account_1",
              circle_sub_account_id: "circle_wallet_1",
              business_client_id: "client_1",
              onboarding_status: "approved"
            }
          ]
        };
      }
      if (sql.includes("count(*)::int as verified_count")) return { rows: [{ verified_count: 1 }] };
      if (sql.includes("count(*)::int as circle_count")) return { rows: [{ circle_count: 1 }] };
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "ada_1",
              platform_tenant_id: "tenant_1",
              business_client_id: "client_1",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "active",
              circle_account_id: "circle_account_1",
              circle_sub_account_id: "circle_wallet_1",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/ada_1/activate",
      body: { reason: "Activation gates satisfied" },
      idempotencyKey: "idem-ada-activate",
      correlationId: "corr-ada-activate"
    },
    "ada_activate_hash"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("count(*)::int as verified_count")), true);
  assert.equal(queries.some((sql) => sql.includes("update accounts_of_digital_asset set status")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into account_of_digital_asset_lifecycle_transitions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("ADA activation blocks when Circle mapping is missing", async () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from accounts_of_digital_asset account")) {
        return {
          rows: [
            {
              id: "ada_1",
              status: "pending_activation",
              asset_rail: "circle_internal",
              business_client_id: "client_1",
              onboarding_status: "approved"
            }
          ]
        };
      }
      if (sql.includes("count(*)::int as verified_count")) return { rows: [{ verified_count: 1 }] };
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/ada_1/activate",
      body: {},
      idempotencyKey: "idem-ada-activate-blocked",
      correlationId: "corr-ada-activate-blocked"
    },
    "ada_activate_blocked_hash"
  );

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "circle_mapping_required" });
  assert.equal(queries.some((sql) => sql.includes("update accounts_of_digital_asset set status")), false);
  assert.equal(params.flat().includes("account_of_digital_asset.activation_blocked"), true);
});

test("ADA activation allows tenant internal Tenant ADA without linked instruments", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from accounts_of_digital_asset account")) {
        return {
          rows: [
            {
              id: "ada_tenant_fiat_1",
              status: "pending_activation",
              asset_rail: "fiat_internal",
              use_purpose: "settlement",
              account_name: "Tenant ADA Fiat",
              business_client_id: "client_internal_1",
              onboarding_status: "approved",
              business_client_legal_name: "Platform Internal Treasury Client"
            }
          ]
        };
      }
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "ada_tenant_fiat_1",
              platform_tenant_id: "tenant_1",
              business_client_id: "client_internal_1",
              account_name: "Tenant ADA Fiat",
              use_purpose: "settlement",
              status: "active",
              asset_code: "USD",
              asset_rail: "fiat_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/ada_tenant_fiat_1/activate",
      body: { reason: "Tenant ADA internal activation" },
      idempotencyKey: "idem-ada-tenant-fiat-activate",
      correlationId: "corr-ada-tenant-fiat-activate"
    },
    "ada_tenant_fiat_activate_hash"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("count(*)::int as verified_count")), false);
  assert.equal(queries.some((sql) => sql.includes("update accounts_of_digital_asset set status")), true);
});

test("ADA Circle provisioning persists provider mapping evidence", async () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from accounts_of_digital_asset account")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              status: "pending_activation",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              onboarding_status: "approved"
            }
          ]
        };
      }
      if (sql.includes("and operation_type = 'ada_circle_mapping'") && sql.includes("idempotency_key = $3")) return { rows: [] };
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) return { rows: [] };
      if (sql.includes("from circle_api_operations") && sql.includes("where id = $1")) {
        return {
          rows: [
            {
              id: "circle_op_1",
              operation_type: "ada_circle_mapping",
              idempotency_key: "idem-circle-map",
              correlation_id: "corr-circle-map",
              request_payload: {},
              response_payload: {},
              provider_reference: "circle_account_000000000777",
              provider_account_id: "circle_account_000000000777",
              provider_wallet_id: "circle_wallet_000000000777",
              provider_address_id: "circle_address_000000000777",
              status: "succeeded",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("insert into linked_instruments")) {
        return {
          rows: [{
            id: "linked_circle_1",
            account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
            instrument_type: "circle_wallet",
            status: "active",
            provider_reference: "circle_address_000000000777",
            asset_code: "USDC",
            rail_type: "on-chain",
            purpose: "settlement",
            provider: "circle",
            provider_reference: "circle_wallet_000000000777",
            verification_status: "verified",
            network_code: "ARC-TESTNET",
            is_default: true,
            metadata: {},
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              platform_tenant_id: "tenant_1",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "pending_activation",
              circle_account_id: "circle_account_000000000777",
              circle_sub_account_id: "circle_wallet_000000000777",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/00000000-0000-4000-8000-000000000777/provision-circle",
      body: {},
      idempotencyKey: "idem-circle-map",
      correlationId: "corr-circle-map"
    },
    "circle_map_hash"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), true);
  assert.equal(params.flat().includes("account_of_digital_asset.circle_mapping.provisioned"), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("ADA Circle provisioning reuses existing successful provider mapping without creating a new wallet", async () => {
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from accounts_of_digital_asset account")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              status: "pending_activation",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              legal_name: "Reusable Client",
              circle_wallet_set_id: "circle_wallet_set_reuse",
              circle_account_id: "circle_account_existing",
              circle_sub_account_id: "circle_wallet_existing",
              onboarding_status: "approved"
            }
          ]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) {
        return {
          rows: [{
            id: "linked_circle_existing",
            account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
            instrument_type: "circle_wallet",
            status: "active",
            provider_reference: "circle_address_existing",
            asset_code: "USDC",
            rail_type: "on-chain",
            purpose: "settlement",
            provider: "circle",
            provider_reference: "circle_wallet_existing",
            verification_status: "verified",
            network_code: "ARC-TESTNET",
            is_default: true,
            metadata: { walletSetId: "circle_wallet_set_reuse" },
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("and status = 'succeeded'")) {
        return {
          rows: [
            {
              id: "circle_op_existing",
              operation_type: "ada_circle_mapping",
              idempotency_key: "first-click-key",
              correlation_id: "first-click-corr",
              request_payload: {},
              response_payload: {},
              provider_reference: "circle_account_existing",
              provider_account_id: "circle_account_existing",
              provider_wallet_id: "circle_wallet_existing",
              provider_address_id: "circle_address_existing",
              status: "succeeded",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              platform_tenant_id: "tenant_1",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "pending_activation",
              circle_account_id: "circle_account_existing",
              circle_sub_account_id: "circle_wallet_existing",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/accounts-of-digital-asset/00000000-0000-4000-8000-000000000777/provision-circle",
      body: {},
      idempotencyKey: "second-click-key",
      correlationId: "second-click-corr"
    },
    "circle_map_second_click_hash"
  );

  assert.equal(result.status, 200);
  assert.equal((result.body as { reusedExistingMapping?: boolean }).reusedExistingMapping, true);
  assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), false);
  assert.equal(params.flat().includes("account_of_digital_asset.circle_mapping.provisioned"), false);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("ADA Circle provisioning ignores removed legacy Circle fields", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  const previousApiKey = process.env.CIRCLE_API_KEY;
  const previousEntitySecret = process.env.CIRCLE_ENTITY_SECRET;
  delete process.env.CIRCLE_API_KEY;
  delete process.env.CIRCLE_ENTITY_SECRET;
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from accounts_of_digital_asset account")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              status: "active",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              circle_account_id: "circle_account_existing",
              circle_sub_account_id: "circle_wallet_existing",
              onboarding_status: "approved"
            }
          ]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) return { rows: [] };
      if (sql.includes("and status = 'succeeded'")) return { rows: [] };
      if (sql.includes("from circle_api_operations") && sql.includes("where id = $1")) {
        return {
          rows: [
            {
              id: values[0],
              operation_type: "ada_circle_mapping",
              idempotency_key: "recover-circle-map",
              correlation_id: "recover-circle-map-corr",
              request_payload: { recoveredExistingAccountMapping: true },
              response_payload: { recoveredExistingAccountMapping: true },
              provider_reference: "circle_account_existing",
              provider_account_id: "circle_account_existing",
              provider_wallet_id: "circle_wallet_existing",
              status: "succeeded",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("select id, platform_tenant_id, business_client_id")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              platform_tenant_id: "tenant_1",
              business_client_id: "00000000-0000-4000-8000-000000000222",
              account_name: "ADA",
              use_purpose: "settlement",
              status: "active",
              circle_account_id: "circle_account_existing",
              circle_sub_account_id: "circle_wallet_existing",
              asset_code: "USDC",
              asset_rail: "circle_internal",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/accounts-of-digital-asset/00000000-0000-4000-8000-000000000777/provision-circle",
        body: {},
        idempotencyKey: "recover-circle-map",
        correlationId: "recover-circle-map-corr"
      },
      "circle_map_recover_hash"
    );

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "circle_api_key_required");
    assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), true);
    assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
    if (previousEntitySecret === undefined) delete process.env.CIRCLE_ENTITY_SECRET;
    else process.env.CIRCLE_ENTITY_SECRET = previousEntitySecret;
  }
});

test("tenant activation initializes simulator wallet set and stores tenant Circle integration", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "simulator";
  const queries: string[] = [];
  const params: unknown[][] = [];
  let integrationStored = false;
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from platform_tenants")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              tenant_name: "Demo Tenant",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("insert into platform_tenant_circle_integrations")) {
        integrationStored = true;
        return { rows: [] };
      }
      if (sql.includes("from platform_tenant_circle_integrations")) {
        return integrationStored
          ? {
              rows: [
                {
                  id: "tenant_circle_1",
                  platform_tenant_id: "00000000-0000-4000-8000-000000000001",
                  provider: "circle",
                  environment: "simulator",
                  wallet_set_id: "circle_wallet_set_demotenantwallets",
                  wallet_set_name: "Demo Tenant Wallets",
                  wallet_blockchain: "ARC-TESTNET",
                  wallet_strategy: "omnibus_custodial_set",
                  status: "active",
                  activated_at: "2026-01-01T00:00:00.000Z",
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                  metadata: {}
                }
              ]
            }
          : { rows: [] };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/tenants/current/activate",
        body: {
          walletSetName: "Demo Tenant Wallets",
          walletBlockchains: ["ARC-TESTNET"],
          walletStrategy: "omnibus_custodial_set"
        },
        idempotencyKey: "tenant-activate",
        correlationId: "tenant-activate-corr"
      },
      "tenant_activate_hash"
    );

    assert.equal(result.status, 200);
    assert.equal(queries.some((sql) => sql.includes("insert into platform_tenant_circle_integrations")), true);
    assert.equal(queries.some((sql) => sql.includes("insert into business_clients")), true);
    assert.equal(queries.some((sql) => sql.includes("insert into accounts_of_digital_asset")), true);
    assert.equal(params.flat().includes("platform_tenant.circle_wallet_set.activated"), true);
    assert.equal(params.flat().includes("business_client.pseudo_internal.created"), true);
    assert.equal(params.flat().includes("account_of_digital_asset.tenant_central.created"), true);
    assert.equal(JSON.stringify(result.body).includes("CIRCLE_ENTITY_SECRET"), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});

test("tenant activation relinks existing tenant ADA to tenant internal business client", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "simulator";
  const queries: string[] = [];
  const params: unknown[][] = [];
  let integrationStored = false;
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from platform_tenants")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              tenant_name: "Demo Tenant",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      if (sql.includes("insert into platform_tenant_circle_integrations")) {
        integrationStored = true;
        return { rows: [] };
      }
      if (sql.includes("from platform_tenant_circle_integrations")) {
        return integrationStored
          ? {
              rows: [
                {
                  id: "tenant_circle_1",
                  platform_tenant_id: "00000000-0000-4000-8000-000000000001",
                  provider: "circle",
                  environment: "simulator",
                  wallet_set_id: "circle_wallet_set_demotenantwallets",
                  wallet_set_name: "Demo Tenant Wallets",
                  wallet_blockchain: "ARC-TESTNET",
                  wallet_strategy: "omnibus_custodial_set",
                  status: "active",
                  activated_at: "2026-01-01T00:00:00.000Z",
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-01T00:00:00.000Z",
                  metadata: {}
                }
              ]
            }
          : { rows: [] };
      }
      if (sql.includes("select id, onboarding_status") && sql.includes("from business_clients")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000222",
              onboarding_status: "approved"
            }
          ]
        };
      }
      if (sql.includes("select id, business_client_id, status, account_name") && sql.includes("from accounts_of_digital_asset")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000777",
              business_client_id: "00000000-0000-4000-8000-000000000333",
              status: "pending_activation",
              account_name: "Tenant ADA Legacy"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/tenants/current/activate",
        body: {
          walletSetName: "Demo Tenant Wallets",
          walletBlockchains: ["ARC-TESTNET"],
          walletStrategy: "omnibus_custodial_set"
        },
        idempotencyKey: "tenant-activate-relink",
        correlationId: "tenant-activate-relink-corr"
      },
      "tenant_activate_relink_hash"
    );

    assert.equal(result.status, 200);
    assert.equal(queries.some((sql) => sql.includes("update accounts_of_digital_asset")), true);
    assert.equal(params.flat().includes("account_of_digital_asset.tenant_central.linked"), true);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});

test("Circle sandbox diagnostic command persists provider evidence through direct database mode", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  delete process.env.CIRCLE_API_KEY;
  const queries: string[] = [];
  const params: unknown[][] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      params.push(values);
      if (sql.includes("from circle_api_operations") && sql.includes("where id = $1")) {
        return {
          rows: [
            {
              id: "circle_diag_1",
              operation_type: "circle.sandbox_check",
              idempotency_key: "idem-circle-diag",
              correlation_id: "corr-circle-diag",
              request_payload: {},
              response_payload: { accepted: false },
              provider_reference: "circle_diagnostic_circle-sandbox",
              status: "failed",
              error_code: "circle_api_key_required",
              created_at: "2026-01-01T00:00:00.000Z"
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/integrations/circle/sandbox-check",
        body: {},
        idempotencyKey: "idem-circle-diag",
        correlationId: "corr-circle-diag"
      },
      "circle_diag_hash"
    );

    assert.equal(result.status, 400);
    assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), true);
    assert.equal(params.flat().includes("circle.sandbox_check.failed"), true);
    assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
  }
});

test("postgres evidence query reads ledger, audit, outbox, and inbox tables", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from ledger_accounts")) return { rows: [{ account_code: "20430", account_name: "Customer ADA Liability", account_class: "Liability", normal_balance: "credit" }] };
      if (sql.includes("from audit_events")) return { rows: [{ id: "audit_1", platform_tenant_id: "tenant_1", event_type: "api.read", correlation_id: "corr", payload: {}, created_at: "2026-01-01T00:00:00.000Z" }] };
      if (sql.includes("from event_outbox")) return { rows: [{ id: "outbox_1", platform_tenant_id: "tenant_1", event_type: "event", payload: {}, status: "pending", attempt_count: 0, created_at: "2026-01-01T00:00:00.000Z" }] };
      if (sql.includes("from event_inbox")) return { rows: [{ id: "inbox_1", platform_tenant_id: "tenant_1", source: "circle", source_event_id: "evt_1", event_type: "event", raw_payload: {}, normalized_payload: {}, status: "pending", attempt_count: 0, created_at: "2026-01-01T00:00:00.000Z" }] };
      return { rows: [] };
    }
  };

  assert.equal((await executePostgresQueryWithClient(client as never, { method: "GET", pathname: "/ledger/chart-of-accounts", body: {}, correlationId: "corr" })).status, 200);
  assert.equal((await executePostgresQueryWithClient(client as never, { method: "GET", pathname: "/audit-events", body: {}, correlationId: "corr" })).status, 200);
  assert.equal((await executePostgresQueryWithClient(client as never, { method: "GET", pathname: "/events/outbox", body: {}, correlationId: "corr" })).status, 200);
  assert.equal((await executePostgresQueryWithClient(client as never, { method: "GET", pathname: "/events/inbox", body: {}, correlationId: "corr" })).status, 200);

  assert.equal(queries.some((sql) => sql.includes("from ledger_accounts")), true);
  assert.equal(queries.some((sql) => sql.includes("from audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("from event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("from event_inbox")), true);
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
        handlePostgresCommand({
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

test("integration: multi-step posting flow produces statement movements and explicit reversal entry", async () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const adaId = "00000000-0000-4000-8000-000000000777";
  const client = createLedgerFlowClient(tenantId);

  const opening = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/ledger/events/opening-journal",
      body: {
        accountOfDigitalAssetId: adaId,
        amountMinorUnits: "1000000"
      },
      idempotencyKey: "idem-int-open-1",
      correlationId: "corr-int-open-1"
    },
    "hash-int-open-1"
  );
  assert.equal(opening.status, 201);

  const manual = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/ledger/journals",
      body: {
        accountOfDigitalAssetId: adaId,
        amountMinorUnits: "2500000",
        debitLedgerAccountCode: "10020",
        creditLedgerAccountCode: "20430",
        description: "Integration manual posting"
      },
      idempotencyKey: "idem-int-manual-1",
      correlationId: "corr-int-manual-1"
    },
    "hash-int-manual-1"
  );
  assert.equal(manual.status, 201);
  const manualJournalId = (manual.body as { journal?: { id?: string } }).journal?.id;
  assert.equal(typeof manualJournalId, "string");

  const reversal = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: `/ledger/journals/${manualJournalId}/reverse`,
      body: {
        description: "Integration reversal"
      },
      idempotencyKey: "idem-int-reverse-1",
      correlationId: "corr-int-reverse-1"
    },
    "hash-int-reverse-1"
  );
  assert.equal(reversal.status, 201);

  const statements = await executePostgresQueryWithClient(client as never, {
    method: "GET",
    pathname: `/accounts-of-digital-asset/${adaId}/statements`,
    body: {},
    correlationId: "corr-int-statement-1"
  });
  assert.equal(statements.status, 200);
  const statementBody = statements.body as {
    journals: Array<{ journalEntryId: string; debitMinorUnits: string; creditMinorUnits: string }>;
  };
  assert.equal(statementBody.journals.length >= 6, true);
  const reversalJournalId = (reversal.body as { journal?: { id?: string } }).journal?.id;
  assert.equal(statementBody.journals.some((row) => row.journalEntryId === reversalJournalId), true);

  const journalDetail = await executePostgresQueryWithClient(client as never, {
    method: "GET",
    pathname: `/ledger/journals/${manualJournalId}`,
    body: {},
    correlationId: "corr-int-journal-detail-1"
  });
  assert.equal(journalDetail.status, 200);
  const detailBody = journalDetail.body as { journal?: { id?: string; lines?: unknown[] } };
  assert.equal(detailBody.journal?.id, manualJournalId);
  assert.equal((detailBody.journal?.lines ?? []).length, 2);
});

test("integration: statement pagination scenario supports stable client-side page windows", async () => {
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const adaId = "00000000-0000-4000-8000-000000000777";
  const client = createLedgerFlowClient(tenantId);

  for (let index = 0; index < 25; index += 1) {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/ledger/journals",
        body: {
          accountOfDigitalAssetId: adaId,
          amountMinorUnits: String(1000000 + index),
          debitLedgerAccountCode: "10020",
          creditLedgerAccountCode: "20430",
          description: `Pagination posting ${index + 1}`
        },
        idempotencyKey: `idem-int-page-${index + 1}`,
        correlationId: `corr-int-page-${index + 1}`
      },
      `hash-int-page-${index + 1}`
    );
    assert.equal(result.status, 201);
  }

  const statements = await executePostgresQueryWithClient(client as never, {
    method: "GET",
    pathname: `/accounts-of-digital-asset/${adaId}/statements`,
    body: {},
    correlationId: "corr-int-page-statement"
  });
  assert.equal(statements.status, 200);

  const rows = (statements.body as {
    journals: Array<{ journalEntryId: string; postedAt?: string }>;
  }).journals;
  assert.equal(rows.length, 50);

  const pageSize = 20;
  const page1 = rows.slice(0, pageSize);
  const page2 = rows.slice(pageSize, pageSize * 2);
  const page3 = rows.slice(pageSize * 2, pageSize * 3);

  assert.equal(page1.length, 20);
  assert.equal(page2.length, 20);
  assert.equal(page3.length, 10);

  const firstWindowIds = new Set(page1.map((row) => row.journalEntryId));
  const overlapWithSecond = page2.some((row) => firstWindowIds.has(row.journalEntryId));
  assert.equal(overlapWithSecond, false);

  const postedTimes = rows
    .map((row) => (row.postedAt ? Date.parse(row.postedAt) : Number.NaN))
    .filter((timestamp) => Number.isFinite(timestamp));
  for (let index = 1; index < postedTimes.length; index += 1) {
    assert.equal(postedTimes[index - 1]! >= postedTimes[index]!, true);
  }
});

test("sprint5: funding instruction command writes domain, audit, outbox, and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000777",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "00000000-0000-4000-8000-000000000123",
            account_name: "Client Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from wire_funding_instructions") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "funding_instruction_1",
            account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
            status: "created",
            bank_name: "CIRCLE",
            created_at: "2026-01-01T00:00:01.000Z",
            updated_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/funding-instructions",
      body: {
        accountOfDigitalAssetId: "00000000-0000-4000-8000-000000000777",
        amountMinorUnits: "2500000",
        fundingType: "usdc_payin"
      },
      idempotencyKey: "idem-funding-1",
      correlationId: "corr-funding-1"
    },
    "hash-funding-1"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into wire_funding_instructions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: fiat wire account command writes domain, audit, outbox, and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_supplier",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "client_supplier",
            account_name: "Supplier ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "client_supplier",
            bank_name: "Supplier Bank",
            account_number_last4: "7788",
            routing_number: "000000001",
            business_wire_account_id: "business_wire_123",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/wire-accounts",
      body: {
        businessClientId: "client_supplier",
        targetAccountOfDigitalAssetId: "ada_supplier",
        bankName: "Supplier Bank",
        accountNumberLast4: "7788",
        routingNumber: "000000001"
      },
      idempotencyKey: "idem-wire-1",
      correlationId: "corr-wire-1"
    },
    "hash-wire-1"
  );

  assert.equal(result.status, 201);
  assert.equal((result.body as { wireAccount?: { businessWireAccountId?: string } }).wireAccount?.businessWireAccountId, "business_wire_123");
  assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: fiat wire account command in circle sandbox requires CIRCLE_MINT_KEY or CIRCLE_API_KEY", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  const previousMintKey = process.env.CIRCLE_MINT_KEY;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  delete process.env.CIRCLE_API_KEY;
  delete process.env.CIRCLE_MINT_KEY;

  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_platform_treasury",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "00000000-0000-4000-8000-000000000123",
            account_name: "Platform Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/fiat/wire-accounts",
        body: {
          businessClientId: "00000000-0000-4000-8000-000000000123",
          targetAccountOfDigitalAssetId: "ada_platform_treasury",
          bankName: "Platform Treasury Bank",
          accountNumber: "123456789012",
          accountNumberLast4: "2401",
          routingNumber: "011000015"
        },
        idempotencyKey: "idem-wire-sandbox-key-missing",
        correlationId: "corr-wire-sandbox-key-missing"
      },
      "hash-wire-sandbox-key-missing"
    );

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "circle_api_key_required");
    assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), false);
    assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), false);
    assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
    if (previousMintKey === undefined) delete process.env.CIRCLE_MINT_KEY;
    else process.env.CIRCLE_MINT_KEY = previousMintKey;
  }
});

test("sprint5: fiat wire account command auto-creates tenant pseudo business client when omitted", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from business_clients") && sql.includes("legal_name = $2")) return { rows: [] };
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_tenant_central",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "00000000-0000-4000-8000-000000000999",
            account_name: "Tenant Central ADA",
            use_purpose: "tenant_central",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "00000000-0000-4000-8000-000000000999",
            bank_name: "Platform Treasury Bank",
            account_number_last4: "2401",
            routing_number: "011000015",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/wire-accounts",
      body: {
        targetAccountOfDigitalAssetId: "ada_tenant_central",
        bankName: "Platform Treasury Bank",
        accountNumberLast4: "2401",
        routingNumber: "011000015"
      },
      idempotencyKey: "idem-wire-tenant-self-1",
      correlationId: "corr-wire-tenant-self-1"
    },
    "hash-wire-tenant-self-1"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into business_clients")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into linked_instruments")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: fiat wire mint command writes audit, outbox, and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "client_supplier",
            bank_name: "Supplier Bank",
            account_number_last4: "7788",
            routing_number: "000000001",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_platform_treasury",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "client_supplier",
            account_name: "Platform Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000991",
            provider_reference: "circle_wallet_ada_platform_treasury",
            provider_reference: "circle_wallet_ada_platform_treasury",
            metadata: {
              walletId: "circle_wallet_ada_platform_treasury",
              walletSetId: "circle_wallet_set_platform",
              address: "0x1111111111111111111111111111111111111111"
            }
          }]
        };
      }
      if (sql.includes("from account_of_digital_asset_balances") && sql.includes("for update")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000992",
            available_minor_units: "1000000"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/wire-accounts/wire_1/mint",
      body: {
        targetAccountOfDigitalAssetId: "ada_platform_treasury",
        amountMinorUnits: "2500000"
      },
      idempotencyKey: "idem-wire-mint-1",
      correlationId: "corr-wire-mint-1"
    },
    "hash-wire-mint-1"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("from linked_instruments")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), true);
  assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: fiat wire mint fails when account Circle wallet is not linked", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "client_supplier",
            bank_name: "Supplier Bank",
            account_number_last4: "7788",
            routing_number: "000000001",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_platform_treasury",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "client_supplier",
            account_name: "Platform Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/wire-accounts/wire_1/mint",
      body: {
        targetAccountOfDigitalAssetId: "ada_platform_treasury",
        amountMinorUnits: "2500000"
      },
      idempotencyKey: "idem-wire-mint-wallet-missing",
      correlationId: "corr-wire-mint-wallet-missing"
    },
    "hash-wire-mint-wallet-missing"
  );

  assert.equal(result.status, 400);
  assert.equal((result.body as { error?: string }).error, "account_circle_wallet_not_linked");
  assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), false);
  assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), false);
});

test("sprint5: fiat wire mint fails fast when linked Circle wallet address is missing", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "client_supplier",
            bank_name: "Supplier Bank",
            account_number_last4: "7788",
            routing_number: "000000001",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_platform_treasury",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "client_supplier",
            account_name: "Platform Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000991",
            provider_reference: "circle_wallet_ada_platform_treasury",
            provider_reference: "circle_wallet_ada_platform_treasury",
            metadata: {
              walletId: "circle_wallet_ada_platform_treasury",
              walletSetId: "circle_wallet_set_platform"
            }
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/wire-accounts/wire_1/mint",
      body: {
        targetAccountOfDigitalAssetId: "ada_platform_treasury",
        amountMinorUnits: "2500000"
      },
      idempotencyKey: "idem-wire-mint-wallet-address-missing",
      correlationId: "corr-wire-mint-wallet-address-missing"
    },
    "hash-wire-mint-wallet-address-missing"
  );

  assert.equal(result.status, 400);
  assert.equal((result.body as { error?: string }).error, "account_circle_wallet_address_missing");
  assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), false);
  assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), false);
});

test("sprint5: fiat wire mint maps provider failure status and returns 400 for Circle auth/config errors", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  const previousEntitySecret = process.env.CIRCLE_ENTITY_SECRET;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  delete process.env.CIRCLE_API_KEY;
  delete process.env.CIRCLE_ENTITY_SECRET;

  const queries: string[] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "client_supplier",
            bank_name: "Supplier Bank",
            account_number_last4: "7788",
            routing_number: "000000001",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_platform_treasury",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "00000000-0000-4000-8000-000000000123",
            account_name: "Platform Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000991",
            provider_reference: "circle_wallet_ada_platform_treasury",
            provider_reference: "circle_wallet_ada_platform_treasury",
            metadata: {
              walletId: "circle_wallet_ada_platform_treasury",
              walletSetId: "circle_wallet_set_platform",
              address: "0x1111111111111111111111111111111111111111"
            }
          }]
        };
      }
      if (sql.includes("from circle_api_operations") && sql.includes("where id = $1")) {
        return {
          rows: [{
            id: values[0],
            operation_type: "fiat_wire_mint",
            idempotency_key: "idem-wire-mint-provider-failed",
            correlation_id: "corr-wire-mint-provider-failed",
            request_payload: {},
            response_payload: {},
            provider_reference: "circle_failed_ref",
            provider_wallet_id: "circle_wallet_ada_platform_treasury",
            status: "failed",
            error_code: "circle_api_key_required",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/fiat/wire-accounts/wire_1/mint",
        body: {
          targetAccountOfDigitalAssetId: "ada_platform_treasury",
          amountMinorUnits: "2500000"
        },
        idempotencyKey: "idem-wire-mint-provider-failed",
        correlationId: "corr-wire-mint-provider-failed"
      },
      "hash-wire-mint-provider-failed"
    );

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "circle_api_key_required");
    assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), true);
    assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
    if (previousEntitySecret === undefined) delete process.env.CIRCLE_ENTITY_SECRET;
    else process.env.CIRCLE_ENTITY_SECRET = previousEntitySecret;
  }
});

test("sprint5: fiat wire mint defaults endpoint and fails when Circle API key is missing", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  const previousEntitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const previousMintEndpoint = process.env.CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  delete process.env.CIRCLE_API_KEY;
  delete process.env.CIRCLE_ENTITY_SECRET;
  delete process.env.CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET;

  const queries: string[] = [];
  const client = {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from linked_instruments linked") && sql.includes("where linked.id = $1 and linked.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "wire_1",
            business_client_id: "client_supplier",
            bank_name: "Supplier Bank",
            account_number_last4: "7788",
            routing_number: "000000001",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "ada_platform_treasury",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "00000000-0000-4000-8000-000000000123",
            account_name: "Platform Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from linked_instruments") && sql.includes("instrument_type = 'circle_wallet'")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000991",
            provider_reference: "circle_wallet_ada_platform_treasury",
            provider_reference: "circle_wallet_ada_platform_treasury",
            metadata: {
              walletId: "circle_wallet_ada_platform_treasury",
              walletSetId: "circle_wallet_set_platform",
              address: "0x1111111111111111111111111111111111111111"
            }
          }]
        };
      }
      if (sql.includes("from circle_api_operations") && sql.includes("where id = $1")) {
        return {
          rows: [{
            id: values[0],
            operation_type: "fiat_wire_mint",
            idempotency_key: "idem-wire-mint-endpoint-missing",
            correlation_id: "corr-wire-mint-endpoint-missing",
            request_payload: {},
            response_payload: {},
            provider_reference: "circle_failed_ref",
            provider_wallet_id: "circle_wallet_ada_platform_treasury",
            status: "failed",
            error_code: "circle_api_key_required",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  try {
    const result = await executePostgresCommand(
      client as never,
      {
        method: "POST",
        pathname: "/fiat/wire-accounts/wire_1/mint",
        body: {
          targetAccountOfDigitalAssetId: "ada_platform_treasury",
          amountMinorUnits: "2500000"
        },
        idempotencyKey: "idem-wire-mint-endpoint-missing",
        correlationId: "corr-wire-mint-endpoint-missing"
      },
      "hash-wire-mint-endpoint-missing"
    );

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "circle_api_key_required");
    assert.equal(queries.some((sql) => sql.includes("insert into circle_api_operations")), true);
    assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
    if (previousEntitySecret === undefined) delete process.env.CIRCLE_ENTITY_SECRET;
    else process.env.CIRCLE_ENTITY_SECRET = previousEntitySecret;
    if (previousMintEndpoint === undefined) delete process.env.CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET;
    else process.env.CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET = previousMintEndpoint;
  }
});

test("sprint5: fiat mint history includes destination wallet and persisted circle operation", async () => {
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      if (sql.includes("from audit_events") && sql.includes("event_type = 'fiat.mint.completed'")) {
        return {
          rows: [{
            id: "audit_1",
            payload: {
              id: "mint_1",
              wireAccountId: "wire_1",
              targetAccountOfDigitalAssetId: "ada_platform_treasury",
              amountMinorUnits: "2500000",
              status: "completed",
              providerMintId: "provider_mint_1",
              destinationWalletId: "circle_wallet_ada_platform_treasury",
              providerWalletId: "circle_wallet_ada_platform_treasury",
              circleOperationId: "00000000-0000-4000-8000-000000000995",
              createdAt: "2026-01-01T00:00:02.000Z"
            },
            created_at: "2026-01-01T00:00:02.000Z"
          }]
        };
      }
      if (sql.includes("from circle_api_operations") && sql.includes("id::text = any($2::text[])")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000995",
            operation_type: "fiat_wire_mint",
            idempotency_key: "idem-wire-mint-1",
            correlation_id: "corr-wire-mint-1",
            request_payload: { wireAccountId: "wire_1" },
            response_payload: { status: "complete" },
            provider_reference: "provider_mint_1",
            provider_account_id: null,
            provider_wallet_id: "circle_wallet_ada_platform_treasury",
            provider_address_id: null,
            status: "succeeded",
            error_code: null,
            created_at: "2026-01-01T00:00:02.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresQueryWithClient(
    client as never,
    {
      method: "GET",
      pathname: "/fiat/mints",
      query: {},
      body: {},
      correlationId: "corr-fiat-mints-history-1"
    },
    "hash-fiat-mints-history-1"
  );

  assert.equal(result.status, 200);
  const payload = result.body as { mints: Array<Record<string, unknown>> };
  assert.equal(payload.mints.length, 1);
  assert.equal(payload.mints[0]?.destinationWalletId, "circle_wallet_ada_platform_treasury");
  assert.equal((payload.mints[0]?.circleOperation as { id?: string })?.id, "00000000-0000-4000-8000-000000000995");
});

test("sprint5: funding reservation command writes reservation, balance update, audit, outbox, and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from settlement_obligations")) return { rows: [{ id: "00000000-0000-4000-8000-000000000555" }] };
      if (sql.includes("from accounts_of_digital_asset") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "00000000-0000-4000-8000-000000000777",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            business_client_id: "00000000-0000-4000-8000-000000000123",
            account_name: "Client Treasury ADA",
            use_purpose: "settlement",
            status: "active",
            asset_code: "USDC",
            asset_rail: "circle_internal",
            created_at: "2026-01-01T00:00:00.000Z"
          }]
        };
      }
      if (sql.includes("from account_of_digital_asset_balances")) {
        return {
          rows: [{
            available_minor_units: "9000000",
            reserved_minor_units: "1000000"
          }]
        };
      }
      if (sql.includes("from funding_reservations") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "reservation_1",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            settlement_obligation_id: "00000000-0000-4000-8000-000000000555",
            account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
            amount_minor_units: "2500000",
            status: "active",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/funding-reservations",
      body: {
        settlementObligationId: "00000000-0000-4000-8000-000000000555",
        accountOfDigitalAssetId: "00000000-0000-4000-8000-000000000777",
        amountMinorUnits: "2500000"
      },
      idempotencyKey: "idem-funding-reservation-1",
      correlationId: "corr-funding-reservation-1"
    },
    "hash-funding-reservation-1"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into funding_reservations")), true);
  assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: funding reservation release command updates reservation status and emits evidence", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from funding_reservations") && sql.includes("for update")) {
        return {
          rows: [{
            id: "reservation_1",
            settlement_obligation_id: "00000000-0000-4000-8000-000000000555",
            account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
            amount_minor_units: "2500000",
            consumed_minor_units: "0",
            status: "active"
          }]
        };
      }
      if (sql.includes("from account_of_digital_asset_balances")) {
        return {
          rows: [{
            available_minor_units: "6500000",
            reserved_minor_units: "3500000"
          }]
        };
      }
      if (sql.includes("from funding_reservations") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "reservation_1",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            settlement_obligation_id: "00000000-0000-4000-8000-000000000555",
            account_of_digital_asset_id: "00000000-0000-4000-8000-000000000777",
            amount_minor_units: "2500000",
            status: "released",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/funding-reservations/reservation_1/release",
      body: {},
      idempotencyKey: "idem-funding-reservation-release-1",
      correlationId: "corr-funding-reservation-release-1"
    },
    "hash-funding-reservation-release-1"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("update funding_reservations")), true);
  assert.equal(queries.some((sql) => sql.includes("update account_of_digital_asset_balances")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: internal payment command writes payment and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from payment_instructions payment") && sql.includes("where payment.id = $1 and payment.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "payment_1",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            source_account_of_digital_asset_id: "ada_buyer",
            destination_account_of_digital_asset_id: "ada_supplier",
            recipient_address: null,
            amount_minor_units: "2500000",
            status: "created",
            provider_transfer_id: null,
            idempotency_key: "idem-payment-create-1",
            created_at: "2026-01-01T00:00:01.000Z",
            payment_type: "internal"
          }]
        };
      }
      if (sql.includes("from external_payment_executions payment") && sql.includes("where payment.id = $1 and payment.platform_tenant_id = $2")) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/payments/internal",
      body: {
        sourceAccountOfDigitalAssetId: "ada_buyer",
        destinationAccountOfDigitalAssetId: "ada_supplier",
        amountMinorUnits: "2500000"
      },
      idempotencyKey: "idem-payment-create-1",
      correlationId: "corr-payment-create-1"
    },
    "hash-payment-create-1"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into payment_instructions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: payment submit command updates execution state and emits evidence", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from payment_instructions") && sql.includes("for update")) {
        return { rows: [{ id: "payment_1", status: "created" }] };
      }
      if (sql.includes("from internal_transfer_executions") && sql.includes("for update")) {
        return { rows: [] };
      }
      if (sql.includes("from payment_instructions payment") && sql.includes("where payment.id = $1 and payment.platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "payment_1",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            source_account_of_digital_asset_id: "ada_buyer",
            destination_account_of_digital_asset_id: "ada_supplier",
            recipient_address: null,
            amount_minor_units: "2500000",
            status: "submitted",
            provider_transfer_id: "provider_transfer_1",
            idempotency_key: "idem-payment-submit-1",
            created_at: "2026-01-01T00:00:01.000Z",
            payment_type: "internal"
          }]
        };
      }
      if (sql.includes("from external_payment_executions payment") && sql.includes("where payment.id = $1 and payment.platform_tenant_id = $2")) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/payments/payment_1/submit",
      body: {},
      idempotencyKey: "idem-payment-submit-1",
      correlationId: "corr-payment-submit-1"
    },
    "hash-payment-submit-1"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("update payment_instructions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into internal_transfer_executions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: fiat redemption command writes domain and idempotency", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from redemption_instructions") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "redemption_1",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            source_account_of_digital_asset_id: "ada_supplier",
            linked_instrument_id: "wire_1",
            amount_minor_units: "1250000",
            status: "created",
            provider_withdrawal_id: null,
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/redemptions",
      body: {
        sourceAccountOfDigitalAssetId: "ada_supplier",
        fiatWireAccountId: "wire_1",
        amountMinorUnits: "1250000"
      },
      idempotencyKey: "idem-redemption-create-1",
      correlationId: "corr-redemption-create-1"
    },
    "hash-redemption-create-1"
  );

  assert.equal(result.status, 201);
  assert.equal(queries.some((sql) => sql.includes("insert into redemption_instructions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: fiat redemption submit command updates status and emits evidence", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from redemption_instructions") && sql.includes("for update")) {
        return { rows: [{ id: "redemption_1", status: "created", provider_withdrawal_id: null }] };
      }
      if (sql.includes("from redemption_instructions") && sql.includes("where id = $1 and platform_tenant_id = $2")) {
        return {
          rows: [{
            id: "redemption_1",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            source_account_of_digital_asset_id: "ada_supplier",
            linked_instrument_id: "wire_1",
            amount_minor_units: "1250000",
            status: "submitted",
            provider_withdrawal_id: "withdrawal_1",
            created_at: "2026-01-01T00:00:01.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/fiat/redemptions/redemption_1/submit",
      body: {},
      idempotencyKey: "idem-redemption-submit-1",
      correlationId: "corr-redemption-submit-1"
    },
    "hash-redemption-submit-1"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("update redemption_instructions")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into redemption_execution_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into api_idempotency_records")), true);
});

test("sprint5: circle webhook dedupe returns prior processed result without duplicate posting", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from provider_webhook_events") && sql.includes("provider_event_id = $2")) {
        return { rows: [{ id: "webhook_existing", status: "processed" }] };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/webhooks/circle",
      body: {
        providerEventId: "circle_event_123",
        eventType: "usdc.payin.confirmed",
        amountMinorUnits: "2500000"
      },
      idempotencyKey: "idem-webhook-dup",
      correlationId: "corr-webhook-dup"
    },
    "hash-webhook-dup"
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { webhookEventId: "webhook_existing", duplicate: true, status: "processed" });
  assert.equal(queries.some((sql) => sql.includes("insert into provider_webhook_events")), false);
  assert.equal(queries.some((sql) => sql.includes("insert into treasury_journal_entries")), false);
});

test("sprint5: circle webhook processing failure rolls back business mutations and retains failure evidence", async () => {
  const queries: string[] = [];
  const state = {
    orderStatus: "pending_provider",
    instructionStatus: "pending_confirmation",
    instructionAvailableMinorUnits: "0",
    webhookStatus: "received",
    deadLetterInserted: false
  };
  let savepointState: typeof state | undefined;
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql === "savepoint circle_webhook_processing") {
        savepointState = { ...state };
        return { rows: [] };
      }
      if (sql === "rollback to savepoint circle_webhook_processing") {
        assert.ok(savepointState);
        Object.assign(state, savepointState);
        return { rows: [] };
      }
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("from idempotency_keys")) return { rows: [] };
      if (sql.includes("from provider_webhook_events") && sql.includes("provider_event_id = $2")) return { rows: [] };
      if (sql.includes("from wire_funding_instructions") && sql.includes("select id,")) {
        return {
          rows: [{
            id: "11111111-2222-4333-8444-555555555555",
            account_of_digital_asset_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            destination_account_of_digital_asset_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
            amount_minor_units: "11000000",
            instruction_role: "internal_treasury_mint",
            status: "pending_confirmation"
          }]
        };
      }
      if (sql.includes("update funding_instruction_orders") && sql.includes("provider_payload_json")) {
        state.orderStatus = "completed";
        return { rows: [] };
      }
      if (sql.includes("update wire_funding_instructions") && sql.includes("available_usdc_minor_units")) {
        state.instructionStatus = "posted_available";
        state.instructionAvailableMinorUnits = "11000000";
        return { rows: [] };
      }
      if (sql.includes("from ledger_accounts")) {
        return {
          rows: [
            { id: "ledger-debit", account_code: "10020" },
            { id: "ledger-credit", account_code: "20430" }
          ]
        };
      }
      if (sql.includes("insert into treasury_journal_entries")) {
        throw new Error("forced_journal_insert_failure");
      }
      if (sql.includes("insert into provider_webhook_dead_letters")) {
        state.deadLetterInserted = true;
        return { rows: [] };
      }
      if (sql.includes("update provider_webhook_events")) {
        state.webhookStatus = "failed";
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/webhooks/circle",
      headers: { "circle-signature": "test_valid_signature" },
      body: {
        id: "evt_rollback_test",
        type: "usdc.mint.confirmed",
        fundingInstructionId: "11111111-2222-4333-8444-555555555555",
        amountMinorUnits: "11000000"
      },
      idempotencyKey: "circle_webhook_evt_rollback_test",
      correlationId: "corr-webhook-rollback"
    },
    "hash-webhook-rollback"
  );

  assert.equal(result.status, 500);
  assert.equal((result.body as { message?: string }).message, "forced_journal_insert_failure");
  assert.equal(state.orderStatus, "pending_provider");
  assert.equal(state.instructionStatus, "pending_confirmation");
  assert.equal(state.instructionAvailableMinorUnits, "0");
  assert.equal(state.webhookStatus, "failed");
  assert.equal(state.deadLetterInserted, true);
  assert.ok(queries.indexOf("rollback to savepoint circle_webhook_processing") > queries.findIndex((sql) => sql.includes("insert into treasury_journal_entries")));
  assert.ok(queries.findIndex((sql) => sql.includes("insert into provider_webhook_dead_letters")) > queries.indexOf("rollback to savepoint circle_webhook_processing"));
});

test("sprint5: reconciliation break resolve updates state and emits evidence", async () => {
  const queries: string[] = [];
  const client = {
    query: async (sql: string): Promise<QueryResult> => {
      queries.push(sql);
      if (sql.includes("from api_idempotency_records")) return { rows: [] };
      if (sql.includes("update reconciliation_breaks") && sql.includes("returning id, status")) {
        return {
          rows: [{
            id: "break_1",
            status: "resolved",
            reason: "orphan_circle_transaction",
            webhook_event_id: "webhook_1",
            suspense_case_id: "suspense_1",
            resolution_note: "Matched to ADA and resolved",
            resolved_at: "2026-01-01T00:00:02.000Z"
          }]
        };
      }
      return { rows: [] };
    }
  };

  const result = await executePostgresCommand(
    client as never,
    {
      method: "POST",
      pathname: "/reconciliation/breaks/break_1/resolve",
      body: { resolutionNote: "Matched to ADA and resolved" },
      idempotencyKey: "idem-reconciliation-1",
      correlationId: "corr-reconciliation-1"
    },
    "hash-reconciliation-1"
  );

  assert.equal(result.status, 200);
  assert.equal(queries.some((sql) => sql.includes("update reconciliation_breaks")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into audit_events")), true);
  assert.equal(queries.some((sql) => sql.includes("insert into event_outbox")), true);
});

type InMemoryLedgerJournal = {
  id: string;
  tenantId: string;
  description: string;
  eventType: string;
  postedAt: string;
  reversalOfJournalEntryId?: string;
  correlationId?: string;
  idempotencyKey?: string;
};

type InMemoryLedgerLine = {
  id: string;
  journalEntryId: string;
  ledgerAccountId: string;
  accountOfDigitalAssetId?: string;
  assetCode: string;
  currency: string;
  debitMinorUnits: bigint;
  creditMinorUnits: bigint;
  createdAt: string;
};

const createLedgerFlowClient = (tenantId: string): { query: (sql: string, values?: unknown[]) => Promise<QueryResult> } => {
  const journals: InMemoryLedgerJournal[] = [];
  const lines: InMemoryLedgerLine[] = [];
  const accountNames = new Map<string, string>([
    ["10020", "Circle Business Account USDC"],
    ["20400", "Escrow Liability - Investor Funds"],
    ["20430", "Customer ADA Available Liability"]
  ]);
  const ledgerByCode = new Map<string, string>([
    ["10020", "00000000-0000-4000-8000-000000010020"],
    ["20400", "00000000-0000-4000-8000-000000020400"],
    ["20430", "00000000-0000-4000-8000-000000020430"]
  ]);

  let sequence = 0;
  const nextIso = (): string => {
    const value = `2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`;
    sequence += 1;
    return value;
  };

  const asBigIntSafe = (value: unknown): bigint => {
    try {
      return BigInt(String(value ?? "0"));
    } catch {
      return 0n;
    }
  };

  return {
    query: async (sql: string, values: unknown[] = []): Promise<QueryResult> => {
      if (sql.includes("select response_snapshot from api_idempotency_records")) return { rows: [] };
      if (sql.includes("insert into legacy_idempotency_keys")) return { rows: [] };
      if (sql.includes("insert into api_idempotency_records")) return { rows: [] };
      if (sql.includes("insert into platform_tenants")) return { rows: [] };
      if (sql.includes("insert into audit_events")) return { rows: [] };
      if (sql.includes("insert into event_outbox")) return { rows: [] };

      if (sql.includes("from posting_rules")) {
        return {
          rows: [{
            rule_name: "Opening ADA journal",
            debit_ledger_account_code: "10020",
            credit_ledger_account_code: "20400"
          }]
        };
      }

      if (sql.includes("from ledger_accounts") && sql.includes("account_code = any")) {
        const requested = Array.isArray(values[0]) ? values[0] as string[] : [];
        return {
          rows: requested
            .filter((code) => ledgerByCode.has(code))
            .map((code) => ({ id: ledgerByCode.get(code), account_code: code })) as Array<Record<string, unknown>>
        };
      }

      if (sql.includes("insert into treasury_journal_entries")) {
        const isReversal = sql.includes("treasury.journal.reversal.posted");
        const entry: InMemoryLedgerJournal = {
          id: String(values[0]),
          tenantId: String(values[1]),
          description: isReversal ? String(values[4] ?? "Journal") : String(values[5] ?? "Journal"),
          eventType: isReversal ? "treasury.journal.reversal.posted" : String(values[3] ?? "treasury.manual_journal.posted"),
          idempotencyKey: isReversal ? String(values[3] ?? "") : String(values[4] ?? ""),
          correlationId: isReversal ? String(values[5] ?? "") : String(values[6] ?? ""),
          reversalOfJournalEntryId: isReversal && typeof values[6] === "string" ? values[6] : undefined,
          postedAt: isReversal && typeof values[7] === "string"
            ? String(values[7])
            : typeof values.at(-1) === "string"
              ? String(values.at(-1))
              : nextIso()
        };
        journals.push(entry);
        return { rows: [] };
      }

      if (sql.includes("insert into treasury_journal_lines") && values.length === 7) {
        lines.push({
          id: String(values[0]),
          journalEntryId: String(values[1]),
          ledgerAccountId: String(values[2]),
          accountOfDigitalAssetId: values[3] ? String(values[3]) : undefined,
          assetCode: "USDC",
          currency: "USD",
          debitMinorUnits: asBigIntSafe(values[4]),
          creditMinorUnits: 0n,
          createdAt: nextIso()
        });
        lines.push({
          id: String(values[5]),
          journalEntryId: String(values[1]),
          ledgerAccountId: String(values[6]),
          accountOfDigitalAssetId: values[3] ? String(values[3]) : undefined,
          assetCode: "USDC",
          currency: "USD",
          debitMinorUnits: 0n,
          creditMinorUnits: asBigIntSafe(values[4]),
          createdAt: nextIso()
        });
        return { rows: [] };
      }

      if (sql.includes("select id from treasury_journal_entries") && sql.includes("reversal_of_journal_entry_id")) {
        const reversal = journals.find((item) => item.tenantId === String(values[0]) && item.reversalOfJournalEntryId === String(values[1]));
        return { rows: reversal ? [{ id: reversal.id }] : [] };
      }

      if (sql.includes("from treasury_journal_entries") && sql.includes("where id = $1 and platform_tenant_id = $2") && sql.includes("description")) {
        const found = journals.find((item) => item.id === String(values[0]) && item.tenantId === String(values[1]));
        return { rows: found ? [{ id: found.id, description: found.description, posted_at: found.postedAt }] : [] };
      }

      if (sql.includes("from treasury_journal_lines") && sql.includes("where journal_entry_id = $1") && sql.includes("ledger_account_id")) {
        const result = lines
          .filter((line) => line.journalEntryId === String(values[0]))
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          .map((line) => ({
            ledger_account_id: line.ledgerAccountId,
            account_of_digital_asset_id: line.accountOfDigitalAssetId ?? null,
            asset_code: line.assetCode,
            currency: line.currency,
            debit_minor_units: line.debitMinorUnits.toString(),
            credit_minor_units: line.creditMinorUnits.toString()
          }));
        return { rows: result };
      }

      if (sql.includes("insert into treasury_journal_lines") && sql.includes("values ($1, $2, $3, $4, $5, $6, $7, $8)")) {
        lines.push({
          id: String(values[0]),
          journalEntryId: String(values[1]),
          ledgerAccountId: String(values[2]),
          accountOfDigitalAssetId: values[3] ? String(values[3]) : undefined,
          assetCode: String(values[4] ?? "USDC"),
          currency: String(values[5] ?? "USD"),
          debitMinorUnits: asBigIntSafe(values[6]),
          creditMinorUnits: asBigIntSafe(values[7]),
          createdAt: nextIso()
        });
        return { rows: [] };
      }

      if (sql.includes("from treasury_journal_lines line")
        && sql.includes("join treasury_journal_entries entry")
        && sql.includes("line.account_of_digital_asset_id = $2")) {
        const rows = lines
          .filter((line) => line.accountOfDigitalAssetId === String(values[1]))
          .map((line) => {
            const entry = journals.find((journal) => journal.id === line.journalEntryId && journal.tenantId === String(values[0]));
            if (!entry) return undefined;
            const code = [...ledgerByCode.entries()].find(([, id]) => id === line.ledgerAccountId)?.[0] ?? "10020";
            return {
              journal_entry_id: entry.id,
              description: entry.description,
              accounting_event_type: entry.eventType,
              correlation_id: entry.correlationId,
              idempotency_key: entry.idempotencyKey,
              posted_at: entry.postedAt,
              account_code: code,
              account_name: accountNames.get(code) ?? "Ledger Account",
              asset_code: line.assetCode,
              currency: line.currency,
              debit_minor_units: line.debitMinorUnits.toString(),
              credit_minor_units: line.creditMinorUnits.toString(),
              _created_at: line.createdAt
            };
          })
          .filter((row): row is Record<string, unknown> => Boolean(row))
          .sort((a, b) => {
            const postedDelta = Date.parse(String(b.posted_at)) - Date.parse(String(a.posted_at));
            if (postedDelta !== 0) return postedDelta;
            return Date.parse(String(a._created_at)) - Date.parse(String(b._created_at));
          })
          .map(({ _created_at, ...rest }) => rest);
        return { rows };
      }

      if (sql.includes("from treasury_journal_entries entry") && sql.includes("group by entry.id")) {
        const rows = journals
          .filter((entry) => entry.tenantId === String(values[0]))
          .map((entry) => {
            const journalLines = lines.filter((line) => line.journalEntryId === entry.id);
            const totalDebit = journalLines.reduce((sum, line) => sum + line.debitMinorUnits, 0n);
            const totalCredit = journalLines.reduce((sum, line) => sum + line.creditMinorUnits, 0n);
            return {
              id: entry.id,
              description: entry.description,
              accounting_event_type: entry.eventType,
              reversal_of_journal_entry_id: entry.reversalOfJournalEntryId ?? null,
              correlation_id: entry.correlationId ?? null,
              idempotency_key: entry.idempotencyKey ?? null,
              posted_at: entry.postedAt,
              total_debit_minor_units: totalDebit.toString(),
              total_credit_minor_units: totalCredit.toString()
            };
          })
          .sort((a, b) => Date.parse(String(b.posted_at)) - Date.parse(String(a.posted_at)))
          .slice(0, 200);
        return { rows };
      }

      if (sql.includes("select line.id") && sql.includes("where line.journal_entry_id = $1")) {
        const rows = lines
          .filter((line) => line.journalEntryId === String(values[0]))
          .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
          .map((line) => {
            const code = [...ledgerByCode.entries()].find(([, id]) => id === line.ledgerAccountId)?.[0] ?? "10020";
            return {
              id: line.id,
              account_of_digital_asset_id: line.accountOfDigitalAssetId ?? null,
              asset_code: line.assetCode,
              currency: line.currency,
              debit_minor_units: line.debitMinorUnits.toString(),
              credit_minor_units: line.creditMinorUnits.toString(),
              account_code: code,
              account_name: accountNames.get(code) ?? "Ledger Account"
            };
          });
        return { rows };
      }

      return { rows: [] };
    }
  };
};
