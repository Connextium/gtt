import { randomUUID } from "node:crypto";
import { requestHash } from "../events/idempotency.js";
import type { JsonResponse } from "../http/index.js";
import { withPostgresTransaction, type PostgresClient } from "./transaction.js";

const defaultTenantId = (): string => process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

export interface Sprint1PostgresCommandInput {
  method: string;
  pathname: string;
  body: Record<string, unknown>;
  idempotencyKey?: string;
  correlationId: string;
  apiKeyId?: string;
  apiClientId?: string;
}

export const isSprint1PostgresCommand = (method: string, pathname: string): boolean => {
  return method === "POST" && [
    "/business-clients",
    "/accounts-of-digital-asset",
    "/ledger/events/opening-journal"
  ].includes(pathname);
};

export const handleSprint1PostgresCommand = async (input: Sprint1PostgresCommandInput): Promise<JsonResponse> => {
  if (!input.idempotencyKey) return { status: 400, body: { error: "idempotency_key_required" } };
  const hash = requestHash({ method: input.method, pathname: input.pathname, body: input.body });
  return withPostgresTransaction((client) => executeSprint1PostgresCommand(client, input, hash));
};

export const executeSprint1PostgresCommand = async (
  client: Pick<PostgresClient, "query">,
  input: Sprint1PostgresCommandInput,
  hash: string
): Promise<JsonResponse> => {
  const tenantId = defaultTenantId();
  await ensureTenant(client, tenantId);
  const replay = await findIdempotencyRecord(client, tenantId, input.idempotencyKey!, hash);
  if (replay) return { status: 200, body: replay };

  let response: JsonResponse;
  if (input.pathname === "/business-clients") {
    response = await createBusinessClient(client, tenantId, input);
  } else if (input.pathname === "/accounts-of-digital-asset") {
    response = await createAccountOfDigitalAsset(client, tenantId, input);
  } else if (input.pathname === "/ledger/events/opening-journal") {
    response = await postOpeningJournal(client, tenantId, input);
  } else {
    response = { status: 404, body: { error: "postgres_command_not_supported" } };
  }

  if (response.status < 400) {
    await recordIdempotency(client, tenantId, input, hash, response.body);
  }
  return response;
};

const ensureTenant = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<void> => {
  await client.query(
    `insert into platform_tenants (id, tenant_name)
     values ($1, $2)
     on conflict (id) do nothing`,
    [tenantId, "Demo Tenant"]
  );
};

const findIdempotencyRecord = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  idempotencyKey: string,
  hash: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select request_hash, response_snapshot
       from api_idempotency_records
      where platform_tenant_id = $1 and idempotency_key = $2`,
    [tenantId, idempotencyKey]
  );
  const row = result.rows[0] as { request_hash: string; response_snapshot: unknown } | undefined;
  if (!row) return undefined;
  if (row.request_hash !== hash) throw new Error("idempotency_key_reused_with_different_request");
  return row.response_snapshot;
};

const recordIdempotency = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  hash: string,
  responseBody: unknown
): Promise<void> => {
  await client.query(
    `insert into api_idempotency_records
      (id, platform_tenant_id, idempotency_key, request_hash, response_snapshot, request_path, request_method, correlation_id)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
    [randomUUID(), tenantId, input.idempotencyKey, hash, JSON.stringify(responseBody), input.pathname, input.method, input.correlationId]
  );
};

const createBusinessClient = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const businessClient = {
    id: randomUUID(),
    tenantId,
    legalName: stringBody(input.body, "legalName", "New Client"),
    country: stringBody(input.body, "country", "US"),
    onboardingStatus: "draft" as const,
    createdAt: new Date().toISOString()
  };
  await client.query(
    `insert into business_clients
      (id, platform_tenant_id, legal_name, country, onboarding_status, correlation_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [
      businessClient.id,
      tenantId,
      businessClient.legalName,
      businessClient.country,
      businessClient.onboardingStatus,
      input.correlationId,
      businessClient.createdAt
    ]
  );
  await writeAuditAndOutbox(client, tenantId, input, "business_client.created", { businessClientId: businessClient.id });
  return { status: 201, body: { businessClient } };
};

const createAccountOfDigitalAsset = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const businessClientId = stringBody(input.body, "businessClientId");
  const clientResult = await client.query(
    `select id from business_clients
      where id = $1 and platform_tenant_id = $2 and onboarding_status = 'approved'`,
    [businessClientId, tenantId]
  );
  if (!clientResult.rows.length) return { status: 400, body: { error: "business_client_not_approved" } };

  const account = {
    id: randomUUID(),
    tenantId,
    businessClientId,
    accountName: stringBody(input.body, "accountName", "New ADA"),
    usePurpose: "settlement" as const,
    status: "active" as const,
    createdAt: new Date().toISOString()
  };
  await client.query(
    `insert into accounts_of_digital_asset
      (id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, correlation_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, 'USDC', 'circle_internal', $7, $8, $8)`,
    [
      account.id,
      tenantId,
      account.businessClientId,
      account.accountName,
      account.usePurpose,
      account.status,
      input.correlationId,
      account.createdAt
    ]
  );
  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.created", { accountOfDigitalAssetId: account.id });
  return { status: 201, body: { account } };
};

const postOpeningJournal = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const accountOfDigitalAssetId = stringBody(input.body, "accountOfDigitalAssetId");
  const amountMinorUnits = stringBody(input.body, "amountMinorUnits", "0");
  if (BigInt(amountMinorUnits) <= 0n) return { status: 400, body: { error: "money_amount_must_be_positive" } };

  const ruleResult = await client.query(
    `select event_type, rule_name, debit_ledger_account_code, credit_ledger_account_code
       from posting_rules
      where event_type = 'treasury.opening_journal.posted' and status = 'active'`,
    []
  );
  const rule = ruleResult.rows[0] as {
    rule_name: string;
    debit_ledger_account_code: string;
    credit_ledger_account_code: string;
  } | undefined;
  if (!rule) return { status: 400, body: { error: "posting_rule_not_active" } };

  const ledgerResult = await client.query(
    `select id, account_code from ledger_accounts where account_code = any($1::text[])`,
    [[rule.debit_ledger_account_code, rule.credit_ledger_account_code]]
  );
  const debitLedgerId = ledgerResult.rows.find((row: { account_code: string }) => row.account_code === rule.debit_ledger_account_code)?.id;
  const creditLedgerId = ledgerResult.rows.find((row: { account_code: string }) => row.account_code === rule.credit_ledger_account_code)?.id;
  if (!debitLedgerId || !creditLedgerId) return { status: 400, body: { error: "posting_rule_ledger_account_missing" } };

  const journal = {
    id: randomUUID(),
    tenantId,
    description: stringBody(input.body, "description", rule.rule_name),
    amountMinorUnits,
    debitLedgerAccountCode: rule.debit_ledger_account_code,
    creditLedgerAccountCode: rule.credit_ledger_account_code,
    accountOfDigitalAssetId,
    createdAt: new Date().toISOString()
  };
  await client.query(
    `insert into treasury_journal_entries
      (id, platform_tenant_id, source_event_id, accounting_event_type, idempotency_key, description, correlation_id, posted_at)
     values ($1, $2, $3, 'treasury.opening_journal.posted', $4, $5, $6, $7)`,
    [journal.id, tenantId, input.idempotencyKey, input.idempotencyKey, journal.description, input.correlationId, journal.createdAt]
  );
  await client.query(
    `insert into treasury_journal_lines
      (id, journal_entry_id, ledger_account_id, account_of_digital_asset_id, asset_code, currency, debit_minor_units, credit_minor_units)
     values
      ($1, $2, $3, $4, 'USDC', 'USD', $5, 0),
      ($6, $2, $7, $4, 'USDC', 'USD', 0, $5)`,
    [randomUUID(), journal.id, debitLedgerId, accountOfDigitalAssetId, amountMinorUnits, randomUUID(), creditLedgerId]
  );
  await writeAuditAndOutbox(client, tenantId, input, "treasury.journal_entry.posted", { journalEntryId: journal.id });
  return { status: 201, body: { journal } };
};

const writeAuditAndOutbox = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> => {
  const outboxId = randomUUID();
  await client.query(
    `insert into audit_events
      (id, platform_tenant_id, event_type, request_path, request_method, api_key_id, api_client_id, correlation_id, idempotency_key, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
    [
      randomUUID(),
      tenantId,
      eventType,
      input.pathname,
      input.method,
      input.apiKeyId,
      input.apiClientId,
      input.correlationId,
      input.idempotencyKey,
      JSON.stringify(payload)
    ]
  );
  await client.query(
    `insert into event_outbox
      (id, platform_tenant_id, event_type, payload, status, attempt_count)
     values ($1, $2, $3, $4::jsonb, 'pending', 0)`,
    [outboxId, tenantId, eventType, JSON.stringify({ ...payload, outboxEventId: outboxId })]
  );
};

const stringBody = (body: Record<string, unknown>, key: string, fallback = ""): string => {
  const value = body[key];
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : fallback;
};
