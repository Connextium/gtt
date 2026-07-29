import { randomUUID } from "node:crypto";
import {
  allApiScopes,
  createPlaintextApiKey,
  hashApiSecret,
  publicApiKey,
  type ApiKeyRecord,
  type ApiScope
} from "../auth/index.js";
import { requestHash } from "../events/idempotency.js";
import type { JsonResponse } from "../http/index.js";
import { checkCircleHealth, circleEnvironment, circleWalletAccountType, initializeCircleWalletSet, provisionAdaCircleMapping } from "../modules/circle/index.js";
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
  actorUserId?: string;
  actorRole?: string;
}

export const isSprint1PostgresRoute = (method: string, pathname: string): boolean => {
  if (method === "GET") {
    return pathname === "/api-keys"
      || /^\/api-keys\/[^/]+$/.test(pathname)
      || pathname === "/business-clients"
      || /^\/business-clients\/[^/]+$/.test(pathname)
      || pathname === "/accounts-of-digital-asset"
      || /^\/accounts-of-digital-asset\/[^/]+$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/statement$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/provider-mappings$/.test(pathname)
      || pathname === "/ledger/chart-of-accounts"
      || pathname === "/ledger/posting-rules"
      || pathname === "/events/outbox"
      || pathname === "/events/inbox"
      || pathname === "/audit-log"
      || pathname === "/audit-events"
      || pathname === "/tenants/current/activation"
      || pathname === "/integrations/circle/health";
  }
  return method === "POST" && (
    [
      "/api-keys",
    "/business-clients",
    "/accounts-of-digital-asset",
    "/ledger/events/opening-journal"
    ].includes(pathname)
    || /^\/api-keys\/[^/]+\/(revoke|rotate)$/.test(pathname)
    || /^\/business-clients\/[^/]+\/(submit-onboarding|map-circle|restrict|close)$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/(activate|restrict|unrestrict|freeze|unfreeze|close|provision-circle)$/.test(pathname)
    || pathname === "/tenants/current/activate"
    || pathname === "/integrations/circle/sandbox-check"
    || /^\/events\/(outbox|inbox)\/[^/]+\/retry$/.test(pathname)
  );
};

export const isSprint1PostgresCommand = isSprint1PostgresRoute;

export const handleSprint1PostgresRoute = async (input: Sprint1PostgresCommandInput): Promise<JsonResponse> => {
  const hash = requestHash({ method: input.method, pathname: input.pathname, body: input.body });
  if (input.method === "GET") return executeSprint1PostgresQuery(input);
  if (!input.idempotencyKey) return { status: 400, body: { error: "idempotency_key_required" } };
  return withPostgresTransaction((client) => executeSprint1PostgresCommand(client, input, hash));
};

export const handleSprint1PostgresCommand = handleSprint1PostgresRoute;

export const executeSprint1PostgresQuery = async (input: Sprint1PostgresCommandInput): Promise<JsonResponse> => {
  return withPostgresTransaction((client) => executeSprint1PostgresQueryWithClient(client, input));
};

export const executeSprint1PostgresQueryWithClient = async (
  client: Pick<PostgresClient, "query">,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const tenantId = defaultTenantId();
  await ensureTenant(client, tenantId);
  if (input.pathname === "/api-keys") return { status: 200, body: { keys: await listApiKeys(client, tenantId) } };
    const apiKeyMatch = input.pathname.match(/^\/api-keys\/([^/]+)$/);
    if (apiKeyMatch) {
      const key = await getApiKey(client, tenantId, decodeURIComponent(apiKeyMatch[1]!));
      return key ? { status: 200, body: { key } } : { status: 404, body: { error: "api_key_not_found" } };
    }
    if (input.pathname === "/business-clients") return { status: 200, body: { businessClients: await listBusinessClients(client, tenantId) } };
    const businessClientMatch = input.pathname.match(/^\/business-clients\/([^/]+)$/);
    if (businessClientMatch) {
      const businessClient = await getBusinessClient(client, tenantId, decodeURIComponent(businessClientMatch[1]!));
      if (!businessClient) return { status: 404, body: { error: "business_client_not_found" } };
      const auditEvents = await listAuditEvents(client, tenantId, { businessClientId: businessClient.id });
      return { status: 200, body: { businessClient, auditEvents } };
    }
    if (input.pathname === "/accounts-of-digital-asset") return { status: 200, body: { accounts: await listAccounts(client, tenantId) } };
    const linkedInstrumentsMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/linked-instruments$/);
    if (linkedInstrumentsMatch) return { status: 200, body: await getAccountLinkedInstruments(client, tenantId, decodeURIComponent(linkedInstrumentsMatch[1]!)) };
    const providerMappingsMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/provider-mappings$/);
    if (providerMappingsMatch) return { status: 200, body: await getAccountProviderMappings(client, tenantId, decodeURIComponent(providerMappingsMatch[1]!)) };
    const statementMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/statement$/);
    if (statementMatch) return { status: 200, body: await getAccountStatement(client, tenantId, decodeURIComponent(statementMatch[1]!)) };
    const accountMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)$/);
    if (accountMatch) {
      const account = await getAccount(client, tenantId, decodeURIComponent(accountMatch[1]!));
      return account ? { status: 200, body: { account } } : { status: 404, body: { error: "account_not_found" } };
    }
    if (input.pathname === "/ledger/chart-of-accounts") return { status: 200, body: { accounts: await listLedgerAccounts(client) } };
    if (input.pathname === "/ledger/posting-rules") return { status: 200, body: { postingRules: await listPostingRules(client) } };
    if (input.pathname === "/events/outbox") return { status: 200, body: { events: await listOutboxEvents(client, tenantId) } };
    if (input.pathname === "/events/inbox") return { status: 200, body: { events: await listInboxEvents(client, tenantId) } };
    if (input.pathname === "/audit-log" || input.pathname === "/audit-events") return { status: 200, body: { auditEvents: await listAuditEvents(client, tenantId) } };
    if (input.pathname === "/tenants/current/activation") return { status: 200, body: await getTenantActivation(client, tenantId) };
    if (input.pathname === "/integrations/circle/health") return { status: 200, body: await getCircleHealth(client, tenantId) };
  return { status: 404, body: { error: "postgres_query_not_supported" } };
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
  if (input.pathname === "/api-keys") {
    response = await createApiKey(client, tenantId, input);
  } else {
    const revokeMatch = input.pathname.match(/^\/api-keys\/([^/]+)\/revoke$/);
    const rotateMatch = input.pathname.match(/^\/api-keys\/([^/]+)\/rotate$/);
    const clientLifecycleMatch = input.pathname.match(/^\/business-clients\/([^/]+)\/(submit-onboarding|map-circle|restrict|close)$/);
    const accountLifecycleMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/(activate|restrict|unrestrict|freeze|unfreeze|close)$/);
    const accountProvisionMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/provision-circle$/);
    const linkedInstrumentMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/linked-instruments$/);
    const eventRetryMatch = input.pathname.match(/^\/events\/(outbox|inbox)\/([^/]+)\/retry$/);
    if (revokeMatch) {
      response = await revokeApiKey(client, tenantId, input, decodeURIComponent(revokeMatch[1]!));
    } else if (rotateMatch) {
      response = await rotateApiKey(client, tenantId, input, decodeURIComponent(rotateMatch[1]!));
    } else if (clientLifecycleMatch) {
      response = await transitionBusinessClient(client, tenantId, input, decodeURIComponent(clientLifecycleMatch[1]!), clientLifecycleMatch[2]!);
    } else if (linkedInstrumentMatch) {
      response = await createLinkedInstrument(client, tenantId, input, decodeURIComponent(linkedInstrumentMatch[1]!));
    } else if (accountLifecycleMatch) {
      response = await transitionAccount(client, tenantId, input, decodeURIComponent(accountLifecycleMatch[1]!), accountLifecycleMatch[2]!);
    } else if (accountProvisionMatch) {
      response = await provisionCircleAccount(client, tenantId, input, decodeURIComponent(accountProvisionMatch[1]!));
    } else if (eventRetryMatch) {
      response = await retryEvent(client, tenantId, eventRetryMatch[1]!, decodeURIComponent(eventRetryMatch[2]!));
    } else if (input.pathname === "/tenants/current/activate") {
      response = await activateTenant(client, tenantId, input);
    } else if (input.pathname === "/integrations/circle/sandbox-check") {
      response = await runCircleSandboxCheck(client, tenantId, input);
    } else if (input.pathname === "/business-clients") {
    response = await createBusinessClient(client, tenantId, input);
  } else if (input.pathname === "/accounts-of-digital-asset") {
    response = await createAccountOfDigitalAsset(client, tenantId, input);
  } else if (input.pathname === "/ledger/events/opening-journal") {
    response = await postOpeningJournal(client, tenantId, input);
  } else {
    response = { status: 404, body: { error: "postgres_command_not_supported" } };
  }
  }

  if (response.status < 400) {
    await recordIdempotency(client, tenantId, input, hash, response.body);
  }
  return response;
};

const createApiKey = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const now = new Date().toISOString();
  const apiClient = {
    id: randomUUID(),
    tenantId,
    clientName: stringBody(input.body, "clientName", "API Client"),
    status: "active" as const,
    createdAt: now
  };
  const scopes = scopesBody(input.body);
  const keyId = randomUUID();
  const plaintextKey = createPlaintextApiKey(keyId);
  const secret = plaintextKey.split(".")[1]!;
  const key: ApiKeyRecord = {
    id: keyId,
    tenantId,
    apiClientId: apiClient.id,
    keyPrefix: `gtt_live_${keyId}`,
    keyHash: hashApiSecret(secret),
    scopes,
    status: "active",
    expiresAt: optionalStringBody(input.body, "expiresAt"),
    createdAt: now
  };
  await client.query(
    `insert into api_clients (id, platform_tenant_id, client_name, status, created_at)
     values ($1, $2, $3, $4, $5)`,
    [apiClient.id, tenantId, apiClient.clientName, apiClient.status, apiClient.createdAt]
  );
  await client.query(
    `insert into api_keys
      (id, platform_tenant_id, api_client_id, key_prefix, key_hash, scopes, status, expires_at, created_at)
     values ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9)`,
    [key.id, tenantId, key.apiClientId, key.keyPrefix, key.keyHash, key.scopes, key.status, key.expiresAt, key.createdAt]
  );
  await writeAuditAndOutbox(client, tenantId, input, "api_key.created", { apiKeyId: key.id, apiClientId: apiClient.id });
  return { status: 201, body: { client: apiClient, key: publicApiKey(key), plaintextKey } };
};

const revokeApiKey = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  apiKeyId: string
): Promise<JsonResponse> => {
  const now = new Date().toISOString();
  const result = await client.query(
    `update api_keys
        set status = 'revoked', revoked_at = $3
      where id = $1 and platform_tenant_id = $2
      returning id, platform_tenant_id, api_client_id, key_prefix, scopes, status, expires_at, revoked_at, rotated_from_api_key_id, last_used_at, last_used_ip, created_at`,
    [apiKeyId, tenantId, now]
  );
  const row = result.rows[0];
  if (!row) return { status: 404, body: { error: "api_key_not_found" } };
  await writeAuditAndOutbox(client, tenantId, input, "api_key.revoked", { apiKeyId });
  return { status: 200, body: { key: mapApiKeyRow(row) } };
};

const rotateApiKey = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  oldApiKeyId: string
): Promise<JsonResponse> => {
  const oldResult = await client.query(
    `select keys.id, keys.api_client_id, keys.scopes, clients.client_name
       from api_keys keys
       join api_clients clients on clients.id = keys.api_client_id
      where keys.id = $1 and keys.platform_tenant_id = $2`,
    [oldApiKeyId, tenantId]
  );
  const oldKey = oldResult.rows[0] as { id: string; api_client_id: string; scopes: string[]; client_name: string } | undefined;
  if (!oldKey) return { status: 404, body: { error: "api_key_not_found" } };

  const now = new Date().toISOString();
  await client.query(
    `update api_keys set status = 'revoked', revoked_at = $3 where id = $1 and platform_tenant_id = $2`,
    [oldApiKeyId, tenantId, now]
  );
  const keyId = randomUUID();
  const plaintextKey = createPlaintextApiKey(keyId);
  const secret = plaintextKey.split(".")[1]!;
  const key: ApiKeyRecord = {
    id: keyId,
    tenantId,
    apiClientId: oldKey.api_client_id,
    keyPrefix: `gtt_live_${keyId}`,
    keyHash: hashApiSecret(secret),
    scopes: oldKey.scopes.filter(isApiScope),
    status: "active",
    expiresAt: optionalStringBody(input.body, "expiresAt"),
    rotatedFromApiKeyId: oldApiKeyId,
    createdAt: now
  };
  await client.query(
    `insert into api_keys
      (id, platform_tenant_id, api_client_id, key_prefix, key_hash, scopes, status, expires_at, rotated_from_api_key_id, created_at)
     values ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10)`,
    [key.id, tenantId, key.apiClientId, key.keyPrefix, key.keyHash, key.scopes, key.status, key.expiresAt, key.rotatedFromApiKeyId, key.createdAt]
  );
  await writeAuditAndOutbox(client, tenantId, input, "api_key.rotated", { apiKeyId: key.id, rotatedFromApiKeyId: oldApiKeyId });
  return {
    status: 201,
    body: {
      client: { id: oldKey.api_client_id, tenantId, clientName: oldKey.client_name, status: "active", createdAt: now },
      key: publicApiKey(key),
      plaintextKey
    }
  };
};

const ensureTenant = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<void> => {
  await client.query(
    `insert into platform_tenants (id, tenant_name)
     values ($1, $2)
     on conflict (id) do nothing`,
    [tenantId, "Demo Tenant"]
  );
};

const getTenantRow = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<Record<string, unknown> | undefined> => {
  const result = await client.query(
    `select id, tenant_name, created_at
       from platform_tenants
      where id = $1`,
    [tenantId]
  );
  return result.rows[0] as Record<string, unknown> | undefined;
};

const getTenantCircleIntegrationRow = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<Record<string, unknown> | undefined> => {
  const result = await client.query(
    `select id,
            platform_tenant_id,
            provider,
            environment,
            wallet_set_id,
            wallet_set_name,
            wallet_blockchain,
            wallet_strategy,
            status,
            activated_at,
            created_at,
            updated_at,
            metadata
       from platform_tenant_circle_integrations
      where platform_tenant_id = $1 and provider = 'circle'
      limit 1`,
    [tenantId]
  );
  return result.rows[0] as Record<string, unknown> | undefined;
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
    usePurpose: stringBody(input.body, "usePurpose", "settlement"),
    status: "pending_activation" as const,
    assetCode: stringBody(input.body, "assetCode", "USDC"),
    assetRail: stringBody(input.body, "assetRail", "circle_internal"),
    createdAt: new Date().toISOString()
  };
  await client.query(
    `insert into accounts_of_digital_asset
      (id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, correlation_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      account.id,
      tenantId,
      account.businessClientId,
      account.accountName,
      account.usePurpose,
      account.status,
      account.assetCode,
      account.assetRail,
      input.correlationId,
      account.createdAt
    ]
  );
  await writeAccountTransition(client, tenantId, input, account.id, "draft", account.status, optionalStringBody(input.body, "justification"));
  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.created", {
    accountOfDigitalAssetId: account.id,
    businessClientId,
    status: account.status
  });
  return { status: 201, body: { account } };
};

const createLinkedInstrument = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string
): Promise<JsonResponse> => {
  const account = await getAccount(client, tenantId, accountId) as Record<string, unknown> | undefined;
  if (!account) return { status: 404, body: { error: "account_not_found" } };

  const railCode = stringBody(input.body, "railCode", "external_usdc");
  const assetCode = stringBody(input.body, "assetCode", "USDC");
  const railName = stringBody(input.body, "railName", railCode);
  const status = stringBody(input.body, "status", "active");
  const instrumentType = stringBody(input.body, "instrumentType", "on_chain");
  const externalReference = stringBody(input.body, "externalReference", railCode);
  const purpose = stringBody(input.body, "purpose", String(account.usePurpose ?? "settlement"));
  const railType = optionalStringBody(input.body, "railType");
  const networkCode = optionalStringBody(input.body, "networkCode") ?? railCode;
  const isDefault = input.body.isDefault === true;
  const accountStatus = String(account.status);
  const accountAssetCode = String(account.assetCode ?? "USDC");

  if (!["pending_activation", "active"].includes(accountStatus)) {
    return { status: 400, body: { error: "account_status_blocks_linked_instrument" } };
  }
  if (!instrumentTypeAllowed(instrumentType)) return { status: 400, body: { error: "linked_instrument_type_not_supported" } };
  if (assetCode !== accountAssetCode) return { status: 400, body: { error: "linked_instrument_asset_mismatch" } };
  if (!purposeAllowedForAccount(String(account.usePurpose ?? "settlement"), purpose)) {
    return { status: 400, body: { error: "linked_instrument_purpose_mismatch" } };
  }

  await client.query(
    `insert into asset_rails (rail_code, asset_code, rail_name, status)
     values ($1, $2, $3, 'active')
     on conflict (rail_code) do update
       set asset_code = excluded.asset_code,
           rail_name = excluded.rail_name,
           status = excluded.status`,
    [railCode, assetCode, railName]
  );

  const normalizedInstrumentType = instrumentType === "on_chain" || instrumentType === "on_chain_wallet"
    ? "external_wallet_address"
    : instrumentType;
  const result = await client.query(
    `insert into linked_instruments
      (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, external_reference, asset_code, rail_type, purpose, provider, provider_reference_id, verification_status, metadata, network_code, is_default, created_by_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $17)
     returning id, account_of_digital_asset_id, instrument_type, status, external_reference, asset_code, rail_type, purpose, provider, provider_reference_id, verification_status, network_code, is_default, created_at`,
    [
      randomUUID(),
      accountId,
      tenantId,
      normalizedInstrumentType,
      status,
      externalReference,
      assetCode,
      railType,
      purpose,
      providerForInstrument(normalizedInstrumentType),
      externalReference,
      status === "active" ? "verified" : "pending_verification",
      JSON.stringify({ isDefault, networkCode }),
      networkCode,
      isDefault,
      asUuidOrNull(input.actorUserId),
      new Date().toISOString()
    ]
  );
  const row = result.rows[0] as Record<string, unknown>;
  const linkedInstrument = {
    id: row.id,
    accountId: row.account_of_digital_asset_id,
    instrumentType: row.instrument_type,
    railCode,
    railName,
    assetCode: row.asset_code,
    purpose: row.purpose,
    provider: row.provider,
    providerReferenceId: row.provider_reference_id,
    verificationStatus: row.verification_status,
    networkCode: row.network_code,
    isDefault: row.is_default,
    externalReference: row.external_reference,
    status: row.status,
    createdAt: toIsoString(row.created_at)
  };
  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.linked_instrument.created", {
    accountOfDigitalAssetId: accountId,
    linkedInstrumentId: linkedInstrument.id,
    instrumentType,
    railCode
  });
  return { status: 201, body: { linkedInstrument } };
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
  const apiKeyId = asUuidOrNull(input.apiKeyId);
  const apiClientId = asUuidOrNull(input.apiClientId);
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
      apiKeyId,
      apiClientId,
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

const listApiKeys = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select
       keys.id,
       keys.platform_tenant_id,
       keys.api_client_id,
       keys.key_prefix,
       keys.scopes,
       keys.status,
       keys.expires_at,
       keys.revoked_at,
       keys.rotated_from_api_key_id,
       keys.last_used_at,
       keys.last_used_ip,
       keys.created_at,
       clients.client_name,
       clients.status as client_status
     from api_keys keys
     join api_clients clients on clients.id = keys.api_client_id
     where keys.platform_tenant_id = $1
     order by keys.created_at desc`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    ...mapApiKeyRow(row),
    clientName: row.client_name,
    clientStatus: row.client_status
  }));
};

const getApiKey = async (client: Pick<PostgresClient, "query">, tenantId: string, apiKeyId: string): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id, platform_tenant_id, api_client_id, key_prefix, scopes, status, expires_at, revoked_at, rotated_from_api_key_id, last_used_at, last_used_ip, created_at
       from api_keys
      where id = $1 and platform_tenant_id = $2`,
    [apiKeyId, tenantId]
  );
  return result.rows[0] ? mapApiKeyRow(result.rows[0]) : undefined;
};

const listBusinessClients = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id, platform_tenant_id, legal_name, country, onboarding_status, circle_client_entity_id, circle_application_id, created_at
       from business_clients
      where platform_tenant_id = $1
      order by created_at desc`,
    [tenantId]
  );
  return result.rows.map(mapBusinessClientRow);
};

const getBusinessClient = async (client: Pick<PostgresClient, "query">, tenantId: string, businessClientId: string): Promise<{ id: string } | undefined> => {
  const result = await client.query(
    `select id, platform_tenant_id, legal_name, country, onboarding_status, circle_client_entity_id, circle_application_id, created_at
       from business_clients
      where id = $1 and platform_tenant_id = $2`,
    [businessClientId, tenantId]
  );
  return result.rows[0] ? mapBusinessClientRow(result.rows[0]) as { id: string } : undefined;
};

const transitionBusinessClient = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  businessClientId: string,
  action: string
): Promise<JsonResponse> => {
  const result = await client.query(
    `select id, onboarding_status from business_clients where id = $1 and platform_tenant_id = $2 for update`,
    [businessClientId, tenantId]
  );
  const current = result.rows[0] as { id: string; onboarding_status: string } | undefined;
  if (!current) return { status: 404, body: { error: "business_client_not_found" } };
  const nextStatus = action === "submit-onboarding" ? "submitted" : action === "map-circle" ? "approved" : action === "restrict" ? "restricted" : "closed";
  if (!businessClientTransitionAllowed(current.onboarding_status, nextStatus)) {
    return { status: 400, body: { error: "business_client_invalid_status_transition" } };
  }
  const circleClientEntityId = action === "map-circle" ? stringBody(input.body, "circleClientEntityId", `circle_${businessClientId}`) : undefined;
  const circleApplicationId = action === "map-circle" ? stringBody(input.body, "circleApplicationId", `app_${businessClientId}`) : undefined;
  await client.query(
    `update business_clients
        set onboarding_status = $3,
            circle_client_entity_id = coalesce($4, circle_client_entity_id),
            circle_application_id = coalesce($5, circle_application_id),
            updated_at = now()
      where id = $1 and platform_tenant_id = $2`,
    [businessClientId, tenantId, nextStatus, circleClientEntityId, circleApplicationId]
  );
  await client.query(
    `insert into business_client_lifecycle_transitions
      (id, platform_tenant_id, business_client_id, from_status, to_status, reason, actor_user_id, actor_role, correlation_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      tenantId,
      businessClientId,
      current.onboarding_status,
      nextStatus,
      optionalStringBody(input.body, "reason"),
      asUuidOrNull(input.actorUserId),
      input.actorRole,
      input.correlationId,
      input.idempotencyKey
    ]
  );
  await writeAuditAndOutbox(client, tenantId, input, `business_client.${nextStatus}`, { businessClientId, fromStatus: current.onboarding_status, toStatus: nextStatus });
  const businessClient = await getBusinessClient(client, tenantId, businessClientId);
  return { status: 200, body: { businessClient } };
};

const listAccounts = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, created_at
       from accounts_of_digital_asset
      where platform_tenant_id = $1
      order by created_at desc`,
    [tenantId]
  );
  return result.rows.map(mapAccountRow);
};

const getAccount = async (client: Pick<PostgresClient, "query">, tenantId: string, accountId: string): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, created_at
       from accounts_of_digital_asset
      where id = $1 and platform_tenant_id = $2`,
    [accountId, tenantId]
  );
  return result.rows[0] ? mapAccountRow(result.rows[0]) : undefined;
};

const transitionAccount = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string,
  action: string
): Promise<JsonResponse> => {
  const result = await client.query(
    `select account.id,
            account.status,
            account.asset_rail,
            client.id as business_client_id,
            client.onboarding_status
       from accounts_of_digital_asset account
       join business_clients client on client.id = account.business_client_id and client.platform_tenant_id = account.platform_tenant_id
      where account.id = $1 and account.platform_tenant_id = $2
      for update`,
    [accountId, tenantId]
  );
  const current = result.rows[0] as {
    id: string;
    status: string;
    asset_rail?: string;
    business_client_id: string;
    onboarding_status: string;
  } | undefined;
  if (!current) return { status: 404, body: { error: "account_not_found" } };
  const nextStatus = accountNextStatus(action, current.status);
  if (!accountTransitionAllowed(current.status, nextStatus)) {
    return { status: 400, body: { error: "account_invalid_status_transition" } };
  }
  if (action === "activate") {
    const gateError = await validateAccountActivationGates(client, tenantId, accountId, current);
    if (gateError) {
      await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.activation_blocked", {
        accountOfDigitalAssetId: accountId,
        businessClientId: current.business_client_id,
        reason: gateError
      });
      return { status: 400, body: { error: gateError } };
    }
  }
  await client.query(
    `update accounts_of_digital_asset set status = $3, updated_at = now() where id = $1 and platform_tenant_id = $2`,
    [accountId, tenantId, nextStatus]
  );
  await writeAccountTransition(client, tenantId, input, accountId, current.status, nextStatus, optionalStringBody(input.body, "reason"));
  await writeAuditAndOutbox(client, tenantId, input, `account_of_digital_asset.${nextStatus}`, {
    accountOfDigitalAssetId: accountId,
    businessClientId: current.business_client_id,
    fromStatus: current.status,
    toStatus: nextStatus
  });
  return { status: 200, body: { account: await getAccount(client, tenantId, accountId) } };
};

const provisionCircleAccount = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string
): Promise<JsonResponse> => {
  const result = await client.query(
    `select account.id, account.status, account.business_client_id, account.use_purpose, client.onboarding_status
       from accounts_of_digital_asset account
       join business_clients client on client.id = account.business_client_id and client.platform_tenant_id = account.platform_tenant_id
      where account.id = $1 and account.platform_tenant_id = $2
      for update`,
    [accountId, tenantId]
  );
  const account = result.rows[0] as {
    id: string;
    status: string;
    business_client_id: string;
    use_purpose: string;
    onboarding_status: string;
  } | undefined;
  if (!account) return { status: 404, body: { error: "account_not_found" } };
  if (account.onboarding_status !== "approved") return { status: 400, body: { error: "business_client_not_approved" } };
  if (["restricted", "frozen", "closed"].includes(account.status)) return { status: 400, body: { error: "account_status_blocks_circle_provisioning" } };

  const existingInstrument = await client.query(
    `select id, account_of_digital_asset_id, instrument_type, status, external_reference, asset_code, rail_type, purpose, provider, provider_reference_id, verification_status, network_code, is_default, metadata, created_at
       from linked_instruments
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
        and instrument_type = 'circle_wallet'
        and provider = 'circle'
        and status in ('active', 'verified')
        and verification_status = 'verified'
      order by created_at desc
      limit 1`,
    [tenantId, accountId]
  );
  const existingRow = existingInstrument.rows[0] as Record<string, unknown> | undefined;
  if (existingRow) {
    const operation = await client.query(
      `select id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_reference_id, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at
         from circle_api_operations
        where linked_instrument_id = $1
        order by created_at desc
        limit 1`,
      [existingRow.id]
    );
    return {
      status: 200,
      body: {
        account: await getAccount(client, tenantId, accountId),
        linkedInstrument: mapLinkedInstrumentRow(existingRow),
        circleOperation: operation.rows[0] ? mapCircleOperationRow(operation.rows[0]) : undefined,
        reusedExistingMapping: true
      }
    };
  }

  const existing = await client.query(
    `select id, operation_type, provider_reference_id, provider_account_id, provider_wallet_id, provider_address_id, status, request_payload, response_payload, created_at
       from circle_api_operations
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
        and operation_type = 'ada_circle_mapping'
        and idempotency_key = $3
      order by created_at desc
      limit 1`,
    [tenantId, accountId, input.idempotencyKey]
  );
  const replayed = existing.rows[0];
  if (replayed) return { status: 200, body: { account: await getAccount(client, tenantId, accountId), circleOperation: mapCircleOperationRow(replayed) } };

  const tenantIntegration = await getTenantCircleIntegrationRow(client, tenantId);
  const tenantWalletSetId = typeof tenantIntegration?.wallet_set_id === "string" ? tenantIntegration.wallet_set_id : undefined;
  const tenantWalletBlockchain = typeof tenantIntegration?.wallet_blockchain === "string" ? tenantIntegration.wallet_blockchain : undefined;
  const provider = await provisionAdaCircleMapping({
    tenantId,
    accountOfDigitalAssetId: accountId,
    businessClientId: account.business_client_id,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    walletSetId: tenantWalletSetId,
    walletBlockchains: tenantWalletBlockchain ? [tenantWalletBlockchain] : undefined,
    payload: input.body
  });
  const providerAccountId = provider.providerAccountId ?? provider.providerReferenceId;
  const providerWalletId = provider.providerWalletId ?? provider.providerReferenceId;
  const providerAddressId = provider.providerAddressId;
  const operationId = randomUUID();
  const responsePayload = {
    providerAccountId,
    providerWalletId,
    providerAddressId,
    providerRequestId: provider.providerRequestId,
    status: provider.status,
    errorCode: provider.errorCode,
    provider: provider.responsePayload
  };
  await client.query(
    `insert into circle_api_operations
      (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, account_of_digital_asset_id, business_client_id, request_payload, response_payload, provider_reference_id, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at)
     values ($1, $2, 'ada_circle_mapping', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, $14, now())`,
    [
      operationId,
      tenantId,
      input.idempotencyKey,
      input.correlationId,
      accountId,
      account.business_client_id,
      JSON.stringify({ accountOfDigitalAssetId: accountId, provider: "circle" }),
      JSON.stringify(responsePayload),
      provider.providerReferenceId,
      providerAccountId,
      providerWalletId,
      providerAddressId,
      provider.status === "complete" ? "succeeded" : "failed",
      provider.errorCode
    ]
  );
  if (provider.status !== "complete") {
    await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.circle_mapping.failed", {
      accountOfDigitalAssetId: accountId,
      businessClientId: account.business_client_id,
      circleOperationId: operationId,
      errorCode: provider.errorCode
    });
    const status = provider.errorCode === "circle_api_key_required" || provider.errorCode === "circle_wallet_configuration_required" ? 400 : 502;
    return {
      status,
      body: {
        error: provider.errorCode ?? "circle_provider_unavailable",
        detail: tenantActivationFailureDetail(provider.responsePayload),
        circleOperation: await getCircleOperation(client, tenantId, operationId)
      }
    };
  }
  const instrumentResult = await client.query(
    `insert into linked_instruments
      (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, external_reference, asset_code, rail_type, purpose, provider, provider_reference_id, verification_status, metadata, network_code, is_default, created_at, updated_at)
     values ($1, $2, $3, 'circle_wallet', 'active', $4, $5, 'on-chain', $6, 'circle', $7, 'verified', $8::jsonb, $9, true, now(), now())
     returning id, account_of_digital_asset_id, instrument_type, status, external_reference, asset_code, rail_type, purpose, provider, provider_reference_id, verification_status, network_code, is_default, metadata, created_at`,
    [
      randomUUID(),
      accountId,
      tenantId,
      providerAddressId ?? providerWalletId,
      providerWalletId,
      account.use_purpose,
      providerWalletId,
      JSON.stringify({
        walletSetId: tenantWalletSetId,
        walletId: providerWalletId,
        address: providerAddressId,
        blockchain: tenantWalletBlockchain,
        providerRequestId: provider.providerRequestId,
        circleOperationId: operationId
      }),
      tenantWalletBlockchain
    ]
  );
  const linkedInstrument = instrumentResult.rows[0] as Record<string, unknown>;
  await client.query(
    `update circle_api_operations set linked_instrument_id = $2 where id = $1`,
    [operationId, linkedInstrument.id]
  );
  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.circle_mapping.provisioned", {
    accountOfDigitalAssetId: accountId,
    businessClientId: account.business_client_id,
    circleOperationId: operationId,
    providerAccountId,
    providerWalletId,
    providerAddressId,
    linkedInstrumentId: linkedInstrument.id
  });
  const circleOperation = await getCircleOperation(client, tenantId, operationId);
  return { status: 200, body: { account: await getAccount(client, tenantId, accountId), linkedInstrument: mapLinkedInstrumentRow(linkedInstrument), circleOperation } };
};

const getTenantActivation = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string
): Promise<unknown> => {
  const tenant = await getTenantRow(client, tenantId);
  const integration = await getTenantCircleIntegrationRow(client, tenantId);
  return {
    tenant,
    circleIntegration: integration ? mapTenantCircleIntegrationRow(integration) : {
      environment: circleEnvironment(),
      walletSetId: process.env.CIRCLE_WALLET_SET_ID,
      walletSetName: `${tenant?.tenant_name ?? "Demo Tenant"} Wallet Set`,
      walletBlockchains: circleWalletBlockchainsFromEnv(),
      walletAccountType: circleWalletAccountType,
      walletStrategy: "omnibus_custodial_set",
      status: "draft"
    }
  };
};

const activateTenant = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const tenant = await getTenantRow(client, tenantId);
  const walletSetName = stringBody(input.body, "walletSetName", `${tenant?.tenant_name ?? "Demo Tenant"} Wallet Set`);
  const walletBlockchains = stringArrayBody(input.body, "walletBlockchains", circleWalletBlockchainsFromEnv());
  const walletBlockchainForStorage = walletBlockchains[0] ?? "MATIC-AMOY";
  const walletStrategy = stringBody(input.body, "walletStrategy", "omnibus_custodial_set");
  const attachedWalletSetId = optionalStringBody(input.body, "walletSetId");
  const environment = circleEnvironment();

  const walletSet = attachedWalletSetId
    ? {
        environment,
        walletSetId: attachedWalletSetId,
        walletSetName,
        walletBlockchains,
        status: "complete" as const,
        responsePayload: { accepted: true, attachedExistingWalletSet: true }
      }
    : await initializeCircleWalletSet({
        idempotencyKey: input.idempotencyKey,
        walletSetName,
        walletBlockchains
      });

  const integrationId = randomUUID();
  const status = walletSet.status === "complete" ? "active" : "failed";
  await client.query(
    `insert into platform_tenant_circle_integrations
      (id, platform_tenant_id, provider, environment, wallet_set_id, wallet_set_name, wallet_blockchain, wallet_strategy, status, activated_at, metadata, created_at, updated_at)
     values ($1, $2, 'circle', $3, $4, $5, $6, $7, $8, case when $8 = 'active' then now() else null end, $9::jsonb, now(), now())
     on conflict (platform_tenant_id, provider)
     do update set environment = excluded.environment,
                   wallet_set_id = excluded.wallet_set_id,
                   wallet_set_name = excluded.wallet_set_name,
                   wallet_blockchain = excluded.wallet_blockchain,
                   wallet_strategy = excluded.wallet_strategy,
                   status = excluded.status,
                   activated_at = case when excluded.status = 'active' then coalesce(platform_tenant_circle_integrations.activated_at, now()) else platform_tenant_circle_integrations.activated_at end,
                   metadata = excluded.metadata,
                   updated_at = now()`,
    [
      integrationId,
      tenantId,
      walletSet.environment,
      walletSet.walletSetId,
      walletSetName,
      walletBlockchainForStorage,
      walletStrategy,
      status,
      JSON.stringify({
        providerRequestId: walletSet.providerRequestId,
        responsePayload: {
          ...walletSet.responsePayload,
          walletBlockchains
        },
        errorCode: walletSet.errorCode
      })
    ]
  );

  await writeAuditAndOutbox(client, tenantId, input, status === "active" ? "platform_tenant.circle_wallet_set.activated" : "platform_tenant.circle_wallet_set.activation_failed", {
    walletSetId: walletSet.walletSetId,
    walletSetName,
    walletBlockchains,
    walletStrategy,
    environment: walletSet.environment,
    errorCode: walletSet.errorCode
  });

  const body = await getTenantActivation(client, tenantId);
  return {
    status: 200,
    body: {
      ...body as Record<string, unknown>,
      activationAccepted: status === "active",
      error: status === "active" ? undefined : walletSet.errorCode,
      detail: status === "active" ? undefined : tenantActivationFailureDetail(walletSet.responsePayload),
      walletSet
    }
  };
};

const getCircleHealth = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown> => {
  const health = await checkCircleHealth({ probe: false });
  const last = await client.query(
    `select id,
            operation_type,
            idempotency_key,
            correlation_id,
            request_payload,
            response_payload,
            provider_reference_id,
            provider_account_id,
            provider_wallet_id,
            provider_address_id,
            status,
            error_code,
            created_at
       from circle_api_operations
      where platform_tenant_id = $1
        and operation_type in ('circle.health_check', 'circle.sandbox_check')
      order by created_at desc
      limit 1`,
    [tenantId]
  );
  return { circle: health, lastDiagnostic: last.rows[0] ? mapCircleOperationRow(last.rows[0]) : undefined };
};

const runCircleSandboxCheck = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const health = await checkCircleHealth({ probe: true });
  const operationId = randomUUID();
  await client.query(
    `insert into circle_api_operations
      (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_reference_id, status, error_code, created_at)
     values ($1, $2, 'circle.sandbox_check', $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, now())`,
    [
      operationId,
      tenantId,
      input.idempotencyKey,
      input.correlationId,
      JSON.stringify({ environment: health.environment, baseUrl: health.baseUrl, probe: true }),
      JSON.stringify(health.responsePayload),
      health.providerRequestId ?? `circle_diagnostic_${health.environment}`,
      health.status === "ready" ? "succeeded" : "failed",
      health.errorCode
    ]
  );
  await writeAuditAndOutbox(client, tenantId, input, health.status === "ready" ? "circle.sandbox_check.succeeded" : "circle.sandbox_check.failed", {
    circleOperationId: operationId,
    environment: health.environment,
    status: health.status,
    errorCode: health.errorCode
  });
  return {
    status: health.status === "ready" ? 200 : health.errorCode === "circle_api_key_required" ? 400 : 502,
    body: { circle: health, diagnostic: await getCircleOperation(client, tenantId, operationId) }
  };
};

const getAccountStatement = async (client: Pick<PostgresClient, "query">, tenantId: string, accountId: string): Promise<unknown> => {
  const result = await client.query(
    `select
       entry.id as journal_entry_id,
       entry.description,
       entry.accounting_event_type,
       entry.correlation_id,
       entry.idempotency_key,
       entry.posted_at,
       ledger.account_code,
       ledger.account_name,
       line.asset_code,
       line.currency,
       line.debit_minor_units,
       line.credit_minor_units
     from treasury_journal_lines line
     join treasury_journal_entries entry on entry.id = line.journal_entry_id
     join ledger_accounts ledger on ledger.id = line.ledger_account_id
     where entry.platform_tenant_id = $1 and line.account_of_digital_asset_id = $2
     order by entry.posted_at desc, line.created_at asc`,
    [tenantId, accountId]
  );
  return {
    accountId,
    journals: result.rows.map((row) => ({
      journalEntryId: row.journal_entry_id,
      description: row.description,
      accountingEventType: row.accounting_event_type,
      correlationId: row.correlation_id,
      idempotencyKey: row.idempotency_key,
      postedAt: toIsoString(row.posted_at),
      accountCode: row.account_code,
      accountName: row.account_name,
      assetCode: row.asset_code,
      currency: row.currency,
      debitMinorUnits: String(row.debit_minor_units),
      creditMinorUnits: String(row.credit_minor_units)
    }))
  };
};

const getAccountLinkedInstruments = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountId: string
): Promise<unknown> => {
  const account = await getAccount(client, tenantId, accountId) as Record<string, unknown> | undefined;
  if (!account) return { accountId, rails: [], fiatLinks: [], activity: [], audit: [], error: "account_not_found" };

  const railsResult = await client.query(
    `select linked.id,
            linked.instrument_type,
            linked.status,
            linked.external_reference,
            linked.asset_code as linked_asset_code,
            linked.rail_type,
            linked.purpose,
            linked.provider,
            linked.provider_reference_id,
            linked.verification_status,
            linked.network_code,
            linked.is_default,
            linked.metadata,
            linked.created_at,
            rail.rail_code,
            rail.rail_name,
            rail.asset_code
       from linked_instruments linked
       left join asset_rails rail on rail.rail_code = linked.external_reference
      where linked.account_of_digital_asset_id = $1
      order by linked.created_at desc`,
    [accountId]
  );

  const fiatResult = await client.query(
    `select id, bank_name, account_number_last4, routing_number, status, created_at
       from fiat_wire_accounts
      where platform_tenant_id = $1 and business_client_id = $2
      order by created_at desc`,
    [tenantId, account.businessClientId]
  );

  const activityResult = await client.query(
    `select id, route_type as activity_type, amount_minor_units, status, created_at, idempotency_key
       from payment_instructions
      where platform_tenant_id = $1 and source_account_of_digital_asset_id = $2
      union all
     select id, 'redemption' as activity_type, amount_minor_units, status, created_at, idempotency_key
       from redemption_instructions
      where platform_tenant_id = $1 and source_account_of_digital_asset_id = $2
      order by created_at desc
      limit 5`,
    [tenantId, accountId]
  );

  const auditResult = await client.query(
    `select event_type, correlation_id, idempotency_key, created_at
       from audit_events
      where platform_tenant_id = $1
        and (payload->>'accountOfDigitalAssetId' = $2 or payload->>'accountId' = $2)
      order by created_at desc
      limit 5`,
    [tenantId, accountId]
  );

  const instruments = railsResult.rows.map((row) => ({
    id: row.id,
    instrumentType: row.instrument_type,
    railCode: row.rail_code ?? row.external_reference,
    railName: row.rail_name ?? row.instrument_type,
    assetCode: row.linked_asset_code ?? row.asset_code ?? account.assetCode ?? "USDC",
    railType: row.rail_type ?? undefined,
    purpose: row.purpose ?? undefined,
    provider: row.provider ?? undefined,
    providerReferenceId: row.provider_reference_id ?? undefined,
    verificationStatus: row.verification_status ?? undefined,
    networkCode: row.network_code ?? undefined,
    isDefault: row.is_default === true,
    externalReference: row.external_reference,
    status: row.status,
    createdAt: toIsoString(row.created_at)
  }));
  const circleWallets = instruments.filter((item) => item.instrumentType === "circle_wallet");
  const rails = instruments.filter((item) => item.instrumentType !== "circle_wallet" && item.railType !== "fiat");
  const linkedFiatLinks = instruments
    .filter((item) => item.railType === "fiat")
    .map((item) => ({
      id: item.id,
      bankName: item.railName ?? "Linked Bank Account",
      accountNumberLast4: String(item.externalReference ?? "").slice(-4) || "----",
      routingNumber: item.networkCode,
      status: item.status,
      createdAt: item.createdAt
    }));
  return {
    accountId,
    account,
    circleWallets,
    rails,
    fiatLinks: [...fiatResult.rows.map((row) => ({
      id: row.id,
      bankName: row.bank_name,
      accountNumberLast4: row.account_number_last4,
      routingNumber: row.routing_number,
      status: row.status,
      createdAt: toIsoString(row.created_at)
    })), ...linkedFiatLinks],
    activity: activityResult.rows.map((row) => ({
      id: row.id,
      activityType: row.activity_type,
      amountMinorUnits: String(row.amount_minor_units),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: toIsoString(row.created_at)
    })),
    audit: auditResult.rows.map((row) => ({
      eventType: row.event_type,
      correlationId: row.correlation_id,
      idempotencyKey: row.idempotency_key,
      createdAt: toIsoString(row.created_at)
    }))
  };
};

const getAccountProviderMappings = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountId: string
): Promise<unknown> => {
  const account = await getAccount(client, tenantId, accountId);
  if (!account) return { accountId, mappings: [], error: "account_not_found" };
  const result = await client.query(
    `select id,
            operation_type,
            idempotency_key,
            correlation_id,
            request_payload,
            response_payload,
            provider_reference_id,
            provider_account_id,
            provider_wallet_id,
            provider_address_id,
            status,
            error_code,
            created_at
       from circle_api_operations
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
      order by created_at desc
      limit 20`,
    [tenantId, accountId]
  );
  return {
    accountId,
    mappings: result.rows.map(mapCircleOperationRow)
  };
};

const getCircleOperation = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  operationId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id,
            operation_type,
            idempotency_key,
            correlation_id,
            request_payload,
            response_payload,
            provider_reference_id,
            provider_account_id,
            provider_wallet_id,
            provider_address_id,
            status,
            error_code,
            created_at
       from circle_api_operations
      where id = $1 and platform_tenant_id = $2`,
    [operationId, tenantId]
  );
  return result.rows[0] ? mapCircleOperationRow(result.rows[0]) : undefined;
};

const validateAccountActivationGates = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountId: string,
  account: { onboarding_status: string; asset_rail?: string }
): Promise<string | undefined> => {
  if (account.onboarding_status !== "approved") return "business_client_not_approved";
  const instrumentResult = await client.query(
    `select count(*)::int as verified_count
       from linked_instruments
      where account_of_digital_asset_id = $1
        and coalesce(platform_tenant_id, $2) = $2
        and status in ('active', 'verified')
        and verification_status = 'verified'`,
    [accountId, tenantId]
  );
  const verifiedCount = Number(instrumentResult.rows[0]?.verified_count ?? 0);
  if (verifiedCount < 1) return "linked_instrument_gate_not_satisfied";
  if ((account.asset_rail ?? "circle_internal") === "circle_internal") {
    const circleResult = await client.query(
      `select count(*)::int as circle_count
         from linked_instruments
        where account_of_digital_asset_id = $1
          and coalesce(platform_tenant_id, $2) = $2
          and instrument_type = 'circle_wallet'
          and provider = 'circle'
          and status in ('active', 'verified')
          and verification_status = 'verified'`,
      [accountId, tenantId]
    );
    if (Number(circleResult.rows[0]?.circle_count ?? 0) < 1) return "circle_mapping_required";
  }
  return undefined;
};

const writeAccountTransition = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string,
  fromStatus: string,
  toStatus: string,
  reason?: string
): Promise<void> => {
  await client.query(
    `insert into account_of_digital_asset_lifecycle_transitions
      (id, platform_tenant_id, account_of_digital_asset_id, from_status, to_status, reason, actor_user_id, actor_role, correlation_id, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      randomUUID(),
      tenantId,
      accountId,
      fromStatus,
      toStatus,
      reason,
      asUuidOrNull(input.actorUserId),
      input.actorRole,
      input.correlationId,
      input.idempotencyKey
    ]
  );
};

const listLedgerAccounts = async (client: Pick<PostgresClient, "query">): Promise<unknown[]> => {
  const result = await client.query(
    `select account_code, account_name, account_class, normal_balance
       from ledger_accounts
      order by account_code`,
    []
  );
  return result.rows.map((row) => ({
    accountCode: row.account_code,
    accountName: row.account_name,
    accountClass: row.account_class,
    normalBalance: row.normal_balance
  }));
};

const listPostingRules = async (client: Pick<PostgresClient, "query">): Promise<unknown[]> => {
  const result = await client.query(
    `select event_type, rule_name, status, debit_ledger_account_code, credit_ledger_account_code
       from posting_rules
      order by event_type`,
    []
  );
  return result.rows.map((row) => ({
    eventType: row.event_type,
    ruleName: row.rule_name,
    status: row.status,
    debitLedgerAccountCode: row.debit_ledger_account_code,
    creditLedgerAccountCode: row.credit_ledger_account_code
  }));
};

const listAuditEvents = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  filter: { businessClientId?: string } = {}
): Promise<unknown[]> => {
  const result = await client.query(
    `select id, platform_tenant_id, event_type, request_path, request_method, api_key_id, api_client_id, actor_user_id, correlation_id, idempotency_key, payload, created_at
       from audit_events
      where platform_tenant_id = $1
        and ($2::text is null or payload->>'businessClientId' = $2)
      order by created_at desc
      limit 200`,
    [tenantId, filter.businessClientId ?? null]
  );
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.platform_tenant_id,
    eventType: row.event_type,
    requestPath: row.request_path ?? undefined,
    requestMethod: row.request_method ?? undefined,
    apiKeyId: row.api_key_id ?? undefined,
    apiClientId: row.api_client_id ?? undefined,
    actorUserId: row.actor_user_id ?? undefined,
    correlationId: row.correlation_id,
    idempotencyKey: row.idempotency_key ?? undefined,
    payload: row.payload,
    createdAt: toIsoString(row.created_at)
  }));
};

const listOutboxEvents = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id, platform_tenant_id, event_type, payload, status, attempt_count, last_error, created_at, processed_at, published_at
       from event_outbox
      where platform_tenant_id = $1
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.platform_tenant_id,
    eventType: row.event_type,
    payload: row.payload,
    status: row.status,
    attemptCount: row.attempt_count,
    failureReason: row.last_error ?? undefined,
    createdAt: toIsoString(row.created_at),
    processedAt: toIsoString(row.processed_at),
    publishedAt: toIsoString(row.published_at)
  }));
};

const listInboxEvents = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id, platform_tenant_id, source, source_event_id, event_type, raw_payload, normalized_payload, status, attempt_count, last_error, created_at, processed_at
       from event_inbox
      where platform_tenant_id = $1
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.platform_tenant_id,
    source: row.source,
    sourceEventId: row.source_event_id,
    eventType: row.event_type,
    payload: row.normalized_payload ?? row.raw_payload,
    rawPayload: row.raw_payload,
    status: row.status,
    attemptCount: row.attempt_count,
    failureReason: row.last_error ?? undefined,
    createdAt: toIsoString(row.created_at),
    processedAt: toIsoString(row.processed_at)
  }));
};

const retryEvent = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  eventKind: string,
  eventId: string
): Promise<JsonResponse> => {
  const table = eventKind === "outbox" ? "event_outbox" : "event_inbox";
  const result = await client.query(
    `update ${table}
        set status = 'pending',
            attempt_count = attempt_count + 1,
            last_error = null
      where id = $1 and platform_tenant_id = $2
      returning id, platform_tenant_id, event_type, status, attempt_count, created_at, processed_at`,
    [eventId, tenantId]
  );
  const event = result.rows[0];
  if (!event) return { status: 404, body: { error: "event_not_found" } };
  return {
    status: 200,
    body: {
      event: {
        id: event.id,
        tenantId: event.platform_tenant_id,
        eventType: event.event_type,
        status: event.status,
        attemptCount: event.attempt_count,
        createdAt: toIsoString(event.created_at),
        processedAt: toIsoString(event.processed_at)
      }
    }
  };
};

const mapApiKeyRow = (row: Record<string, unknown>): Omit<ApiKeyRecord, "keyHash"> => ({
  id: String(row.id),
  tenantId: String(row.platform_tenant_id),
  apiClientId: String(row.api_client_id),
  keyPrefix: String(row.key_prefix),
  scopes: Array.isArray(row.scopes) ? row.scopes.filter(isApiScope) : [],
  status: row.status === "revoked" ? "revoked" : "active",
  expiresAt: toIsoString(row.expires_at),
  revokedAt: toIsoString(row.revoked_at),
  rotatedFromApiKeyId: row.rotated_from_api_key_id ? String(row.rotated_from_api_key_id) : undefined,
  lastUsedAt: toIsoString(row.last_used_at),
  lastUsedIp: row.last_used_ip ? String(row.last_used_ip) : undefined,
  createdAt: toIsoString(row.created_at) ?? new Date().toISOString()
});

const mapBusinessClientRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  legalName: row.legal_name,
  country: row.country,
  onboardingStatus: row.onboarding_status,
  circleClientEntityId: row.circle_client_entity_id ?? undefined,
  circleApplicationId: row.circle_application_id ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const mapAccountRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  businessClientId: row.business_client_id,
  accountName: row.account_name,
  usePurpose: row.use_purpose,
  status: row.status,
  assetCode: row.asset_code,
  assetRail: row.asset_rail,
  createdAt: toIsoString(row.created_at)
});

const mapLinkedInstrumentRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  accountId: row.account_of_digital_asset_id,
  instrumentType: row.instrument_type,
  status: row.status,
  externalReference: row.external_reference ?? undefined,
  assetCode: row.asset_code ?? undefined,
  railType: row.rail_type ?? undefined,
  purpose: row.purpose ?? undefined,
  provider: row.provider ?? undefined,
  providerReferenceId: row.provider_reference_id ?? undefined,
  verificationStatus: row.verification_status ?? undefined,
  networkCode: row.network_code ?? undefined,
  isDefault: row.is_default === true,
  metadata: row.metadata ?? {},
  createdAt: toIsoString(row.created_at)
});

const mapCircleOperationRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  operationType: row.operation_type,
  idempotencyKey: row.idempotency_key ?? undefined,
  correlationId: row.correlation_id ?? undefined,
  requestPayload: row.request_payload ?? {},
  responsePayload: row.response_payload ?? {},
  providerReferenceId: row.provider_reference_id ?? undefined,
  providerAccountId: row.provider_account_id ?? undefined,
  providerWalletId: row.provider_wallet_id ?? undefined,
  providerAddressId: row.provider_address_id ?? undefined,
  status: row.status,
  errorCode: row.error_code ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const mapTenantCircleIntegrationRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  provider: row.provider,
  environment: row.environment,
  walletSetId: row.wallet_set_id ?? undefined,
  walletSetName: row.wallet_set_name,
  walletBlockchains: walletBlockchainsFromRow(row),
  walletAccountType: circleWalletAccountType,
  walletStrategy: row.wallet_strategy,
  status: row.status,
  activatedAt: toIsoString(row.activated_at),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
  metadata: row.metadata ?? {}
});

const businessClientTransitions: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["approved", "restricted"],
  approved: ["restricted", "closed"],
  restricted: ["approved"],
  closed: []
};

const accountTransitions: Record<string, string[]> = {
  draft: ["pending_activation", "closed"],
  pending_activation: ["active", "restricted", "frozen", "closed"],
  active: ["restricted", "frozen", "closed"],
  restricted: ["active", "frozen", "closed"],
  frozen: ["active", "restricted", "closed"],
  closed: []
};

const businessClientTransitionAllowed = (from: string, to: string): boolean => businessClientTransitions[from]?.includes(to) ?? false;

const accountTransitionAllowed = (from: string, to: string): boolean => accountTransitions[from]?.includes(to) ?? false;

const accountNextStatus = (action: string, currentStatus: string): string => {
  if (action === "activate" || action === "unrestrict") return "active";
  if (action === "restrict") return "restricted";
  if (action === "freeze") return "frozen";
  if (action === "unfreeze") return currentStatus === "frozen" ? "active" : currentStatus;
  if (action === "close") return "closed";
  return currentStatus;
};

const instrumentTypeAllowed = (instrumentType: string): boolean =>
  [
    "circle_account",
    "circle_wallet",
    "deposit_address",
    "recipient_address",
    "external_wallet_address",
    "fiat_wire_bank_account",
    "on_chain_wallet",
    "fiat_wire",
    "on_chain"
  ].includes(instrumentType);

const providerForInstrument = (instrumentType: string): string | undefined => {
  if (instrumentType.startsWith("circle_")) return "circle";
  if (instrumentType === "deposit_address") return "circle";
  if (instrumentType === "on_chain_wallet" || instrumentType === "external_wallet_address" || instrumentType === "on_chain") return "external_wallet";
  if (instrumentType === "fiat_wire" || instrumentType === "fiat_wire_bank_account") return "bank";
  return undefined;
};

const purposeAllowedForAccount = (accountPurpose: string, instrumentPurpose: string): boolean => {
  if (!instrumentPurpose) return true;
  if (accountPurpose === instrumentPurpose) return true;
  if (accountPurpose === "settlement" && ["payment", "custody", "settlement"].includes(instrumentPurpose)) return true;
  if (accountPurpose === "operating" && ["payment", "operating", "settlement"].includes(instrumentPurpose)) return true;
  return false;
};

const scopesBody = (body: Record<string, unknown>): ApiScope[] => {
  const scopes = body.scopes;
  if (!Array.isArray(scopes)) return allApiScopes;
  const filtered = scopes.filter((scope): scope is ApiScope => typeof scope === "string" && isApiScope(scope));
  return filtered.length ? filtered : allApiScopes;
};

const optionalStringBody = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const isApiScope = (value: string): value is ApiScope => allApiScopes.includes(value as ApiScope);

const toIsoString = (value: unknown): string | undefined => {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
};

const stringBody = (body: Record<string, unknown>, key: string, fallback = ""): string => {
  const value = body[key];
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : fallback;
};

const stringArrayBody = (body: Record<string, unknown>, key: string, fallback: string[]): string[] => {
  const value = body[key];
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return filtered.length ? filtered : fallback;
};

const walletBlockchainsFromRow = (row: Record<string, unknown>): string[] => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  const responsePayload = metadata.responsePayload && typeof metadata.responsePayload === "object" ? metadata.responsePayload as Record<string, unknown> : {};
  const metadataList = normalizeStringList(responsePayload.walletBlockchains ?? responsePayload.blockchains);
  if (metadataList.length) return metadataList;
  return normalizeStringList(row.wallet_blockchain);
};

const circleWalletBlockchainsFromEnv = (): string[] =>
  normalizeStringList(process.env.CIRCLE_WALLET_BLOCKCHAINS ?? process.env.CIRCLE_WALLET_BLOCKCHAIN ?? "MATIC-AMOY");

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const tenantActivationFailureDetail = (responsePayload: Record<string, unknown>): string | undefined => {
  const providerError = responsePayload.providerError && typeof responsePayload.providerError === "object"
    ? responsePayload.providerError as Record<string, unknown>
    : undefined;
  const message = providerError?.message;
  const code = providerError?.code;
  const httpStatus = providerError?.httpStatus ?? responsePayload.httpStatus;
  const providerRequestId = providerError?.providerRequestId ?? responsePayload.providerRequestId;
  return [
    typeof message === "string" ? message : undefined,
    code !== undefined ? `code=${String(code)}` : undefined,
    httpStatus !== undefined ? `httpStatus=${String(httpStatus)}` : undefined,
    typeof providerRequestId === "string" ? `requestId=${providerRequestId}` : undefined
  ].filter(Boolean).join("; ") || undefined;
};

const asUuidOrNull = (value: string | undefined): string | null => {
  if (!value) return null;
  return isUuid(value) ? value : null;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
