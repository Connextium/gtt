import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import {
  executeSprint1PostgresCommand,
  executeSprint1PostgresQueryWithClient,
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

  const result = await executeSprint1PostgresCommand(
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

  const result = await executeSprint1PostgresCommand(
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

  const result = await executeSprint1PostgresCommand(
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
              external_reference: "ethereum_usdc",
              created_at: "2026-01-02T00:00:00.000Z"
            }
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
      pathname: "/accounts-of-digital-asset/00000000-0000-4000-8000-000000000777/linked-instruments",
      body: {
        assetCode: "USDC",
        externalReference: "ethereum_usdc",
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

  const result = await executeSprint1PostgresCommand(
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

  const result = await executeSprint1PostgresCommand(
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
              provider_reference_id: "circle_account_000000000777",
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
            external_reference: "circle_address_000000000777",
            asset_code: "USDC",
            rail_type: "on-chain",
            purpose: "settlement",
            provider: "circle",
            provider_reference_id: "circle_wallet_000000000777",
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

  const result = await executeSprint1PostgresCommand(
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
            external_reference: "circle_address_existing",
            asset_code: "USDC",
            rail_type: "on-chain",
            purpose: "settlement",
            provider: "circle",
            provider_reference_id: "circle_wallet_existing",
            verification_status: "verified",
            network_code: "ARC-TESTNET",
            is_default: true,
            metadata: {},
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
              provider_reference_id: "circle_account_existing",
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

  const result = await executeSprint1PostgresCommand(
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
              provider_reference_id: "circle_account_existing",
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
    const result = await executeSprint1PostgresCommand(
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
    const result = await executeSprint1PostgresCommand(
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
    assert.equal(params.flat().includes("platform_tenant.circle_wallet_set.activated"), true);
    assert.equal(JSON.stringify(result.body).includes("CIRCLE_ENTITY_SECRET"), false);
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
              provider_reference_id: "circle_diagnostic_circle-sandbox",
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
    const result = await executeSprint1PostgresCommand(
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

  assert.equal((await executeSprint1PostgresQueryWithClient(client as never, { method: "GET", pathname: "/ledger/chart-of-accounts", body: {}, correlationId: "corr" })).status, 200);
  assert.equal((await executeSprint1PostgresQueryWithClient(client as never, { method: "GET", pathname: "/audit-events", body: {}, correlationId: "corr" })).status, 200);
  assert.equal((await executeSprint1PostgresQueryWithClient(client as never, { method: "GET", pathname: "/events/outbox", body: {}, correlationId: "corr" })).status, 200);
  assert.equal((await executeSprint1PostgresQueryWithClient(client as never, { method: "GET", pathname: "/events/inbox", body: {}, correlationId: "corr" })).status, 200);

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
