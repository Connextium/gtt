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
import {
  checkCircleHealth,
  circleEnvironment,
  circleWalletAccountType,
  initializeCircleWalletSet,
  initializeTenantCircleWallet,
  mintFiatToCircleWallet,
  provisionAdaCircleMapping,
  provisionSandboxWireFundingInstructions,
  retrieveSandboxWireFundingInstructions,
  verifyCircleWebhook
} from "../modules/circle/index.js";
import { withPostgresTransaction, type PostgresClient } from "./transaction.js";

const defaultTenantId = (): string => process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

export interface Sprint1PostgresCommandInput {
  method: string;
  pathname: string;
  query?: Record<string, string>;
  body: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
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
      || /^\/accounts-of-digital-asset\/[^/]+\/balances$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/statement$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/statements$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/provider-mappings$/.test(pathname)
      || pathname === "/ledger/chart-of-accounts"
      || pathname === "/ledger/posting-rules"
      || pathname === "/ledger/journals"
      || /^\/ledger\/journals\/[^/]+$/.test(pathname)
      || pathname === "/funding-instructions"
      || pathname === "/funding-reservations"
      || /^\/funding-reservations\/[^/]+$/.test(pathname)
      || /^\/funding-instructions\/[^/]+$/.test(pathname)
      || /^\/funding-instructions\/[^/]+\/orders$/.test(pathname)
      || pathname === "/payments"
      || /^\/payments\/[^/]+$/.test(pathname)
      || pathname === "/fiat/wire-accounts"
      || pathname === "/fiat/mints"
      || pathname === "/fiat/redemptions"
      || /^\/fiat\/redemptions\/[^/]+$/.test(pathname)
      || /^\/accounts-of-digital-asset\/[^/]+\/funding-routes$/.test(pathname)
      || pathname === "/reconciliation/breaks"
      || /^\/reconciliation\/breaks\/[^/]+$/.test(pathname)
      || pathname === "/balances/projection-runs"
      || pathname === "/treasury-accounting/trial-balance"
      || pathname === "/treasury-accounting/customer-liability-control"
      || pathname === "/events/outbox"
      || pathname === "/events/inbox"
      || pathname === "/audit-log"
      || pathname === "/audit-events"
      || pathname === "/tenants/current/activation"
      || pathname === "/integrations/circle/health";
  }
  if (method === "PATCH") {
    return /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments\/[^/]+$/.test(pathname);
  }
  return method === "POST" && (
    [
      "/api-keys",
    "/business-clients",
    "/accounts-of-digital-asset",
    "/ledger/events/opening-journal",
    "/ledger/journals"
    ].includes(pathname)
    || /^\/api-keys\/[^/]+\/(revoke|rotate)$/.test(pathname)
    || /^\/business-clients\/[^/]+\/(submit-onboarding|map-circle|restrict|close)$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments\/[^/]+\/(verify|disable)$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/(activate|restrict|unrestrict|freeze|unfreeze|close|provision-circle)$/.test(pathname)
    || pathname === "/tenants/current/activate"
    || pathname === "/integrations/circle/sandbox-check"
    || pathname === "/funding-instructions"
    || pathname === "/funding-reservations"
    || pathname === "/payments/internal"
    || pathname === "/payments/external-usdc"
    || pathname === "/fiat/wire-accounts"
    || pathname === "/fiat/redemptions"
    || /^\/funding-instructions\/[^/]+\/(assign-route|cancel)$/.test(pathname)
    || /^\/funding-reservations\/[^/]+\/(activate|release|expire|cancel)$/.test(pathname)
    || /^\/payments\/[^/]+\/(submit|cancel|retry|refresh-status)$/.test(pathname)
    || /^\/fiat\/wire-accounts\/[^/]+\/mint$/.test(pathname)
    || /^\/fiat\/redemptions\/[^/]+\/(submit|retry|refresh-status)$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/funding-routes$/.test(pathname)
    || /^\/accounts-of-digital-asset\/[^/]+\/funding-routes\/[^/]+\/verify$/.test(pathname)
    || pathname === "/webhooks/circle"
    || /^\/internal\/webhooks\/circle\/[^/]+\/reprocess$/.test(pathname)
    || /^\/reconciliation\/breaks\/[^/]+\/resolve$/.test(pathname)
    || /^\/ledger\/journals\/[^/]+\/reverse$/.test(pathname)
    || /^\/events\/(outbox|inbox)\/[^/]+\/retry$/.test(pathname)
  );
};

export const isSprint1PostgresCommand = isSprint1PostgresRoute;

export const handleSprint1PostgresRoute = async (input: Sprint1PostgresCommandInput): Promise<JsonResponse> => {
  const hash = requestHash({ method: input.method, pathname: input.pathname, body: input.body });
  if (input.method === "GET") return executeSprint1PostgresQuery(input);
  const resolvedIdempotencyKey = input.idempotencyKey
    ?? (input.pathname === "/webhooks/circle" ? webhookIdempotencyKey(input, hash) : undefined);
  if (!resolvedIdempotencyKey) return { status: 400, body: { error: "idempotency_key_required" } };
  const commandInput = resolvedIdempotencyKey === input.idempotencyKey
    ? input
    : { ...input, idempotencyKey: resolvedIdempotencyKey };
  return withPostgresTransaction((client) => executeSprint1PostgresCommand(client, commandInput, hash));
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
    const providerMappingsMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/provider-mappings$/);
    const accountBalancesMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/balances$/);
    if (linkedInstrumentsMatch) {
      return {
        status: 200,
        body: await getAccountLinkedInstruments(client, tenantId, decodeURIComponent(linkedInstrumentsMatch[1]!))
      };
    }
    if (accountBalancesMatch) {
      return {
        status: 200,
        body: await getAccountBalanceProjection(client, tenantId, decodeURIComponent(accountBalancesMatch[1]!))
      };
    }
    if (providerMappingsMatch) return { status: 200, body: await getAccountProviderMappings(client, tenantId, decodeURIComponent(providerMappingsMatch[1]!)) };
    const statementMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/(statement|statements)$/);
    if (statementMatch) return { status: 200, body: await getAccountStatement(client, tenantId, decodeURIComponent(statementMatch[1]!)) };
    const accountMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)$/);
    if (accountMatch) {
      const account = await getAccount(client, tenantId, decodeURIComponent(accountMatch[1]!));
      return account ? { status: 200, body: { account } } : { status: 404, body: { error: "account_not_found" } };
    }
    if (input.pathname === "/ledger/chart-of-accounts") return { status: 200, body: { accounts: await listLedgerAccounts(client) } };
    if (input.pathname === "/ledger/posting-rules") return { status: 200, body: { postingRules: await listPostingRules(client) } };
    if (input.pathname === "/ledger/journals") return { status: 200, body: { journals: await listLedgerJournals(client, tenantId) } };
    const ledgerJournalMatch = input.pathname.match(/^\/ledger\/journals\/([^/]+)$/);
    if (ledgerJournalMatch) {
      const journal = await getLedgerJournal(client, tenantId, decodeURIComponent(ledgerJournalMatch[1]!));
      return journal ? { status: 200, body: { journal } } : { status: 404, body: { error: "journal_not_found" } };
    }
    if (input.pathname === "/funding-instructions") return { status: 200, body: { fundingInstructions: await listFundingInstructions(client, tenantId) } };
    if (input.pathname === "/funding-reservations") return { status: 200, body: { reservations: await listFundingReservations(client, tenantId) } };
    const fundingInstructionMatch = input.pathname.match(/^\/funding-instructions\/([^/]+)$/);
    const fundingInstructionOrdersMatch = input.pathname.match(/^\/funding-instructions\/([^/]+)\/orders$/);
    const fundingReservationMatch = input.pathname.match(/^\/funding-reservations\/([^/]+)$/);
    if (input.pathname === "/payments") return { status: 200, body: { payments: await listPayments(client, tenantId) } };
    const paymentMatch = input.pathname.match(/^\/payments\/([^/]+)$/);
    if (fundingInstructionMatch) {
      const fundingInstruction = await getFundingInstruction(client, tenantId, decodeURIComponent(fundingInstructionMatch[1]!));
      return fundingInstruction ? { status: 200, body: { fundingInstruction } } : { status: 404, body: { error: "funding_instruction_not_found" } };
    }
    if (fundingInstructionOrdersMatch) {
      const fundingInstructionId = decodeURIComponent(fundingInstructionOrdersMatch[1]!);
      return {
        status: 200,
        body: {
          fundingInstructionId,
          orders: await listFundingInstructionOrders(client, tenantId, fundingInstructionId)
        }
      };
    }
    if (fundingReservationMatch) {
      const reservation = await getFundingReservation(client, tenantId, decodeURIComponent(fundingReservationMatch[1]!));
      return reservation ? { status: 200, body: { reservation } } : { status: 404, body: { error: "reservation_not_found" } };
    }
    if (paymentMatch) {
      const payment = await getPayment(client, tenantId, decodeURIComponent(paymentMatch[1]!));
      return payment ? { status: 200, body: { payment } } : { status: 404, body: { error: "payment_not_found" } };
    }
    if (input.pathname === "/fiat/wire-accounts") return { status: 200, body: { wireAccounts: await listFiatWireAccounts(client, tenantId) } };
    if (input.pathname === "/fiat/mints") return { status: 200, body: await listFiatMints(client, tenantId, input.query) };
    if (input.pathname === "/fiat/redemptions") return { status: 200, body: { redemptions: await listFiatRedemptions(client, tenantId) } };
    const fiatRedemptionMatch = input.pathname.match(/^\/fiat\/redemptions\/([^/]+)$/);
    if (fiatRedemptionMatch) {
      const redemption = await getFiatRedemption(client, tenantId, decodeURIComponent(fiatRedemptionMatch[1]!));
      return redemption ? { status: 200, body: { redemption } } : { status: 404, body: { error: "redemption_not_found" } };
    }
    const fundingRoutesMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/funding-routes$/);
    if (fundingRoutesMatch) {
      return {
        status: 200,
        body: {
          accountId: decodeURIComponent(fundingRoutesMatch[1]!),
          routes: await listFundingRoutes(client, tenantId, decodeURIComponent(fundingRoutesMatch[1]!))
        }
      };
    }
    if (input.pathname === "/reconciliation/breaks") return { status: 200, body: { breaks: await listReconciliationBreaks(client, tenantId) } };
    const reconciliationBreakMatch = input.pathname.match(/^\/reconciliation\/breaks\/([^/]+)$/);
    if (reconciliationBreakMatch) {
      const reconciliationBreak = await getReconciliationBreak(client, tenantId, decodeURIComponent(reconciliationBreakMatch[1]!));
      return reconciliationBreak ? { status: 200, body: { break: reconciliationBreak } } : { status: 404, body: { error: "reconciliation_break_not_found" } };
    }
    if (input.pathname === "/balances/projection-runs") return { status: 200, body: { projectionRuns: await listBalanceProjectionRuns(client, tenantId) } };
    if (input.pathname === "/treasury-accounting/trial-balance") return { status: 200, body: await getTrialBalanceReport(client, tenantId) };
    if (input.pathname === "/treasury-accounting/customer-liability-control") return { status: 200, body: await getCustomerLiabilityControlReport(client, tenantId) };
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
  await ensureLegacyIdempotencyKey(client, input.idempotencyKey!, hash);

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
    const linkedInstrumentPatchMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/linked-instruments\/([^/]+)$/);
    const linkedInstrumentActionMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/linked-instruments\/([^/]+)\/(verify|disable)$/);
    const fundingInstructionActionMatch = input.pathname.match(/^\/funding-instructions\/([^/]+)\/(assign-route|cancel)$/);
    const fundingReservationActionMatch = input.pathname.match(/^\/funding-reservations\/([^/]+)\/(activate|release|expire|cancel)$/);
    const paymentActionMatch = input.pathname.match(/^\/payments\/([^/]+)\/(submit|cancel|retry|refresh-status)$/);
    const fiatRedemptionActionMatch = input.pathname.match(/^\/fiat\/redemptions\/([^/]+)\/(submit|retry|refresh-status)$/);
    const fundingRouteCreateMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/funding-routes$/);
    const fundingRouteVerifyMatch = input.pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/funding-routes\/([^/]+)\/verify$/);
    const wireMintMatch = input.pathname.match(/^\/fiat\/wire-accounts\/([^/]+)\/mint$/);
    const webhookReprocessMatch = input.pathname.match(/^\/internal\/webhooks\/circle\/([^/]+)\/reprocess$/);
    const reconciliationBreakResolveMatch = input.pathname.match(/^\/reconciliation\/breaks\/([^/]+)\/resolve$/);
    const journalReverseMatch = input.pathname.match(/^\/ledger\/journals\/([^/]+)\/reverse$/);
    const eventRetryMatch = input.pathname.match(/^\/events\/(outbox|inbox)\/([^/]+)\/retry$/);
    if (revokeMatch) {
      response = await revokeApiKey(client, tenantId, input, decodeURIComponent(revokeMatch[1]!));
    } else if (rotateMatch) {
      response = await rotateApiKey(client, tenantId, input, decodeURIComponent(rotateMatch[1]!));
    } else if (clientLifecycleMatch) {
      response = await transitionBusinessClient(client, tenantId, input, decodeURIComponent(clientLifecycleMatch[1]!), clientLifecycleMatch[2]!);
    } else if (linkedInstrumentMatch) {
      response = await createLinkedInstrument(client, tenantId, input, decodeURIComponent(linkedInstrumentMatch[1]!));
    } else if (linkedInstrumentPatchMatch && input.method === "PATCH") {
      response = await patchLinkedInstrument(
        client,
        tenantId,
        input,
        decodeURIComponent(linkedInstrumentPatchMatch[1]!),
        decodeURIComponent(linkedInstrumentPatchMatch[2]!)
      );
    } else if (linkedInstrumentActionMatch) {
      const action = linkedInstrumentActionMatch[3] === "verify" ? "verify" : "disable";
      response = await updateLinkedInstrumentAction(
        client,
        tenantId,
        input,
        decodeURIComponent(linkedInstrumentActionMatch[1]!),
        decodeURIComponent(linkedInstrumentActionMatch[2]!),
        action
      );
    } else if (input.pathname === "/funding-instructions") {
      response = await createFundingInstruction(client, tenantId, input);
    } else if (input.pathname === "/funding-reservations") {
      response = await createFundingReservation(client, tenantId, input);
    } else if (input.pathname === "/payments/internal") {
      response = await createInternalPayment(client, tenantId, input);
    } else if (input.pathname === "/payments/external-usdc") {
      response = await createExternalPayment(client, tenantId, input);
    } else if (input.pathname === "/fiat/wire-accounts") {
      response = await createFiatWireAccount(client, tenantId, input);
    } else if (input.pathname === "/fiat/redemptions") {
      response = await createFiatRedemption(client, tenantId, input);
    } else if (wireMintMatch) {
      response = await mintFromFiatWireAccount(client, tenantId, input, decodeURIComponent(wireMintMatch[1]!));
    } else if (fundingInstructionActionMatch) {
      response = await transitionFundingInstruction(
        client,
        tenantId,
        input,
        decodeURIComponent(fundingInstructionActionMatch[1]!),
        fundingInstructionActionMatch[2]!
      );
    } else if (fundingReservationActionMatch) {
      response = await transitionFundingReservation(
        client,
        tenantId,
        input,
        decodeURIComponent(fundingReservationActionMatch[1]!),
        fundingReservationActionMatch[2]!
      );
    } else if (paymentActionMatch) {
      response = await transitionPayment(
        client,
        tenantId,
        input,
        decodeURIComponent(paymentActionMatch[1]!),
        paymentActionMatch[2]!
      );
    } else if (fiatRedemptionActionMatch) {
      response = await transitionFiatRedemption(
        client,
        tenantId,
        input,
        decodeURIComponent(fiatRedemptionActionMatch[1]!),
        fiatRedemptionActionMatch[2]!
      );
    } else if (fundingRouteCreateMatch) {
      response = await createFundingRoute(client, tenantId, input, decodeURIComponent(fundingRouteCreateMatch[1]!));
    } else if (fundingRouteVerifyMatch) {
      response = await verifyFundingRoute(
        client,
        tenantId,
        input,
        decodeURIComponent(fundingRouteVerifyMatch[1]!),
        decodeURIComponent(fundingRouteVerifyMatch[2]!)
      );
    } else if (input.pathname === "/webhooks/circle") {
      response = await ingestCircleWebhook(client, tenantId, input);
    } else if (webhookReprocessMatch) {
      response = await reprocessCircleWebhook(client, tenantId, input, decodeURIComponent(webhookReprocessMatch[1]!));
    } else if (reconciliationBreakResolveMatch) {
      response = await resolveReconciliationBreak(client, tenantId, input, decodeURIComponent(reconciliationBreakResolveMatch[1]!));
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
  } else if (input.pathname === "/ledger/journals") {
    response = await postManualJournal(client, tenantId, input);
  } else if (journalReverseMatch) {
    response = await reverseJournal(client, tenantId, input, decodeURIComponent(journalReverseMatch[1]!));
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
  await client.query(
    `update idempotency_keys
        set response_body = $2::jsonb
      where idempotency_key = $1`,
    [input.idempotencyKey, JSON.stringify(responseBody)]
  );
};

const ensureLegacyIdempotencyKey = async (
  client: Pick<PostgresClient, "query">,
  idempotencyKey: string,
  hash: string
): Promise<void> => {
  const existingResult = await client.query(
    `select request_hash
       from idempotency_keys
      where idempotency_key = $1`,
    [idempotencyKey]
  );
  const existing = existingResult.rows[0] as { request_hash?: string } | undefined;
  if (existing?.request_hash && existing.request_hash !== hash) {
    throw new Error("idempotency_key_reused_with_different_request");
  }
  if (existing) return;

  await client.query(
    `insert into idempotency_keys (idempotency_key, request_hash, response_body)
     values ($1, $2, null)`,
    [idempotencyKey, hash]
  );
};

const createBusinessClient = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const businessClientWalletSetId = optionalStringBody(input.body, "circleWalletSetId") ?? optionalStringBody(input.body, "walletSetId");
  const businessClient = {
    id: randomUUID(),
    tenantId,
    legalName: stringBody(input.body, "legalName", "New Client"),
    country: stringBody(input.body, "country", "US"),
    onboardingStatus: "draft" as const,
    circleWalletSetId: businessClientWalletSetId,
    createdAt: new Date().toISOString()
  };
  await client.query(
    `insert into business_clients
      (id, platform_tenant_id, legal_name, country, onboarding_status, circle_wallet_set_id, correlation_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      businessClient.id,
      tenantId,
      businessClient.legalName,
      businessClient.country,
      businessClient.onboardingStatus,
      businessClient.circleWalletSetId,
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
    `select id, legal_name from business_clients
      where id = $1 and platform_tenant_id = $2 and onboarding_status = 'approved'`,
    [businessClientId, tenantId]
  );
  if (!clientResult.rows.length) return { status: 400, body: { error: "business_client_not_approved" } };
  const businessClientName = typeof clientResult.rows[0]?.legal_name === "string" ? clientResult.rows[0].legal_name : undefined;

  const account = {
    id: randomUUID(),
    tenantId,
    businessClientId,
    businessClientName,
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
  let purpose = stringBody(input.body, "purpose", String(account.usePurpose ?? "settlement"));
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

  const normalizedInstrumentType = instrumentType === "on_chain" || instrumentType === "on_chain_wallet"
    ? "external_wallet_address"
    : instrumentType;
  if (normalizedInstrumentType === "circle_wallet") {
    return { status: 400, body: { error: "circle_wallet_must_be_provisioned" } };
  }

  if (isBusinessWireInstrumentType(normalizedInstrumentType)) {
    const normalizedWirePurpose = normalizeLinkedWirePurpose(purpose);
    if (!normalizedWirePurpose) {
      return {
        status: 400,
        body: {
          error: "linked_wire_purpose_invalid",
          detail: `purpose must be one of: ${linkedWirePurposeValues.join(", ")}`
        }
      };
    }
    purpose = normalizedWirePurpose;
  } else if (!purposeAllowedForAccount(String(account.usePurpose ?? "settlement"), purpose)) {
    return { status: 400, body: { error: "linked_instrument_purpose_mismatch" } };
  }

  const linkedInstrumentMetadata: Record<string, unknown> = { isDefault, networkCode };
  if (isBusinessWireInstrumentType(normalizedInstrumentType)) {
    const businessClientId = typeof account.businessClientId === "string" && account.businessClientId.trim().length > 0
      ? account.businessClientId
      : undefined;
    if (!businessClientId) {
      return { status: 400, body: { error: "account_business_client_missing" } };
    }

    const asNonEmptyString = (value: unknown): string | undefined =>
      typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
    const wireAccount = input.body.wireAccount && typeof input.body.wireAccount === "object" && !Array.isArray(input.body.wireAccount)
      ? input.body.wireAccount as Record<string, unknown>
      : undefined;
    const wireBillingDetails = wireAccount?.billingDetails && typeof wireAccount.billingDetails === "object" && !Array.isArray(wireAccount.billingDetails)
      ? wireAccount.billingDetails as Record<string, unknown>
      : undefined;
    const wireBankAddress = wireAccount?.bankAddress && typeof wireAccount.bankAddress === "object" && !Array.isArray(wireAccount.bankAddress)
      ? wireAccount.bankAddress as Record<string, unknown>
      : undefined;

    const accountNumber = optionalStringBody(input.body, "accountNumber")
      ?? asNonEmptyString(wireAccount?.accountNumber);
    const routingNumber = optionalStringBody(input.body, "routingNumber")
      ?? asNonEmptyString(wireAccount?.routingNumber);
    const holderName = optionalStringBody(input.body, "holderName")
      ?? asNonEmptyString(wireBillingDetails?.name);
    const bankName = optionalStringBody(input.body, "bankName")
      ?? asNonEmptyString(wireBankAddress?.bankName);
    const billingLine1 = optionalStringBody(input.body, "billingLine1")
      ?? asNonEmptyString(wireBillingDetails?.line1);
    const billingCity = optionalStringBody(input.body, "billingCity")
      ?? asNonEmptyString(wireBillingDetails?.city);
    const billingDistrict = optionalStringBody(input.body, "billingDistrict")
      ?? asNonEmptyString(wireBillingDetails?.district);
    const billingPostalCode = optionalStringBody(input.body, "billingPostalCode")
      ?? asNonEmptyString(wireBillingDetails?.postalCode);
    const billingCountry = optionalStringBody(input.body, "billingCountry")
      ?? asNonEmptyString(wireBillingDetails?.country);
    const bankAddressLine1 = optionalStringBody(input.body, "bankAddressLine1")
      ?? asNonEmptyString(wireBankAddress?.line1);
    const bankAddressCity = optionalStringBody(input.body, "bankAddressCity")
      ?? asNonEmptyString(wireBankAddress?.city);
    const bankAddressDistrict = optionalStringBody(input.body, "bankAddressDistrict")
      ?? asNonEmptyString(wireBankAddress?.district);
    const bankAddressCountry = optionalStringBody(input.body, "bankAddressCountry")
      ?? asNonEmptyString(wireBankAddress?.country);

    if (!accountNumber) {
      return { status: 400, body: { error: "wire_account_number_required", detail: "accountNumber is required for fiat wire linked instrument registration" } };
    }
    if (!routingNumber) {
      return { status: 400, body: { error: "wire_routing_number_required", detail: "routingNumber is required for fiat wire linked instrument registration" } };
    }
    if (!holderName) {
      return { status: 400, body: { error: "wire_billing_name_required", detail: "billingDetails.name is required for fiat wire linked instrument registration" } };
    }
    if (!billingLine1) {
      return { status: 400, body: { error: "wire_billing_line1_required", detail: "billingDetails.line1 is required for fiat wire linked instrument registration" } };
    }
    if (!billingCity) {
      return { status: 400, body: { error: "wire_billing_city_required", detail: "billingDetails.city is required for fiat wire linked instrument registration" } };
    }
    if (!billingDistrict) {
      return { status: 400, body: { error: "wire_billing_district_required", detail: "billingDetails.district is required for fiat wire linked instrument registration" } };
    }
    if (!billingPostalCode) {
      return { status: 400, body: { error: "wire_billing_postal_code_required", detail: "billingDetails.postalCode is required for fiat wire linked instrument registration" } };
    }
    if (!billingCountry) {
      return { status: 400, body: { error: "wire_billing_country_required", detail: "billingDetails.country is required for fiat wire linked instrument registration" } };
    }
    if (!bankName) {
      return { status: 400, body: { error: "wire_bank_name_required", detail: "bankAddress.bankName is required for fiat wire linked instrument registration" } };
    }
    if (!bankAddressLine1) {
      return { status: 400, body: { error: "wire_bank_line1_required", detail: "bankAddress.line1 is required for fiat wire linked instrument registration" } };
    }
    if (!bankAddressCity) {
      return { status: 400, body: { error: "wire_bank_city_required", detail: "bankAddress.city is required for fiat wire linked instrument registration" } };
    }
    if (!bankAddressDistrict) {
      return { status: 400, body: { error: "wire_bank_district_required", detail: "bankAddress.district is required for fiat wire linked instrument registration" } };
    }
    if (!bankAddressCountry) {
      return { status: 400, body: { error: "wire_bank_country_required", detail: "bankAddress.country is required for fiat wire linked instrument registration" } };
    }

    const normalizedAccountNumber = accountNumber.replace(/\D/g, "");
    const normalizedRoutingNumber = routingNumber.replace(/\D/g, "");
    if (!/^\d{6,17}$/.test(normalizedAccountNumber)) {
      return {
        status: 400,
        body: {
          error: "wire_account_number_invalid",
          detail: "accountNumber must contain 6-17 digits"
        }
      };
    }
    if (!/^\d{9}$/.test(normalizedRoutingNumber)) {
      return {
        status: 400,
        body: {
          error: "wire_routing_number_invalid",
          detail: "routingNumber must contain exactly 9 digits"
        }
      };
    }

    const billingDetails: Record<string, unknown> = {
      name: holderName,
      line1: billingLine1,
      city: billingCity,
      district: billingDistrict,
      postalCode: billingPostalCode,
      country: billingCountry
    };
    const bankAddress: Record<string, unknown> = {
      bankName,
      line1: bankAddressLine1,
      city: bankAddressCity,
      district: bankAddressDistrict,
      country: bankAddressCountry
    };

    const wireSetup = await provisionSandboxWireFundingInstructions({
      tenantId,
      accountOfDigitalAssetId: accountId,
      businessClientId,
      idempotencyKey: input.idempotencyKey,
      payload: {
        wireAccount: {
          accountNumber: normalizedAccountNumber,
          routingNumber: normalizedRoutingNumber,
          billingDetails,
          bankAddress
        }
      }
    });

    if (wireSetup.status !== "complete") {
      const statusCode = wireSetup.errorCode === "circle_api_key_required"
        || wireSetup.errorCode === "circle_auth_failed"
        || wireSetup.errorCode === "circle_validation_failed"
        ? 400
        : 502;
      const detail = typeof (wireSetup.responsePayload as { detail?: unknown } | undefined)?.detail === "string"
        ? (wireSetup.responsePayload as { detail: string }).detail
        : undefined;
      const providerRequestId = typeof (wireSetup.responsePayload as { providerRequestId?: unknown } | undefined)?.providerRequestId === "string"
        ? (wireSetup.responsePayload as { providerRequestId: string }).providerRequestId
        : wireSetup.providerRequestId;
      const step = typeof (wireSetup.responsePayload as { step?: unknown } | undefined)?.step === "string"
        ? (wireSetup.responsePayload as { step: string }).step
        : undefined;
      return {
        status: statusCode,
        body: {
          error: wireSetup.errorCode ?? "circle_provider_unavailable",
          detail,
          ...(providerRequestId ? { providerRequestId } : {}),
          ...(step ? { step } : {})
        }
      };
    }

    const wireSetupPayload = wireSetup.responsePayload && typeof wireSetup.responsePayload === "object"
      ? wireSetup.responsePayload as Record<string, unknown>
      : undefined;
    const providerWireAccountId = typeof wireSetupPayload?.wireAccountId === "string" ? wireSetupPayload.wireAccountId : undefined;
    const businessWireAccountId = typeof wireSetupPayload?.businessWireAccountId === "string"
      ? wireSetupPayload.businessWireAccountId
      : providerWireAccountId;
    const trackingRef = typeof wireSetupPayload?.trackingRef === "string" ? wireSetupPayload.trackingRef : undefined;
    const beneficiaryBankAccountNumber = typeof wireSetupPayload?.beneficiaryBankAccountNumber === "string"
      ? wireSetupPayload.beneficiaryBankAccountNumber
      : undefined;
    const wireInstructions = wireSetupPayload?.wireInstructions && typeof wireSetupPayload.wireInstructions === "object"
      ? wireSetupPayload.wireInstructions
      : undefined;

    if (businessWireAccountId) linkedInstrumentMetadata.businessWireAccountId = businessWireAccountId;
    if (trackingRef) {
      linkedInstrumentMetadata.trackingRef = trackingRef;
      linkedInstrumentMetadata.wireTrackingRef = trackingRef;
    }
    if (beneficiaryBankAccountNumber) linkedInstrumentMetadata.beneficiaryBankAccountNumber = beneficiaryBankAccountNumber;
    if (wireInstructions) linkedInstrumentMetadata.wireInstructions = wireInstructions;
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

  const result = await client.query(
    `insert into linked_instruments
      (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_by_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $15)
     returning id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at`,
    [
      randomUUID(),
      accountId,
      tenantId,
      normalizedInstrumentType,
      status,
      assetCode,
      railType,
      purpose,
      providerForInstrument(normalizedInstrumentType),
      status === "active" ? "verified" : "pending_verification",
      JSON.stringify(linkedInstrumentMetadata),
      networkCode,
      isDefault,
      asUuidOrNull(input.actorUserId),
      new Date().toISOString()
    ]
  );
  const row = result.rows[0] as Record<string, unknown>;

  const linkedInstrument = {
    ...mapLinkedInstrumentRow(row),
    railCode,
    railName,
    businessWireAccountId: businessWireAccountIdFromLinkedInstrument(row)
  };
  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.linked_instrument.created", {
    accountOfDigitalAssetId: accountId,
    linkedInstrumentId: row.id,
    instrumentType,
    railCode,
    ...(linkedInstrument.businessWireAccountId ? { businessWireAccountId: linkedInstrument.businessWireAccountId } : {})
  });
  return { status: 201, body: { linkedInstrument } };
};

const patchLinkedInstrument = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string,
  instrumentId: string
): Promise<JsonResponse> => {
  const account = await getAccount(client, tenantId, accountId);
  if (!account) return { status: 404, body: { error: "account_not_found" } };
  const accountRecord = account as Record<string, unknown>;
  const accountUsePurpose = typeof accountRecord.usePurpose === "string"
    ? accountRecord.usePurpose
    : "settlement";

  const currentResult = await client.query(
    `select id, account_of_digital_asset_id, instrument_type, status, purpose, rail_type, verification_status
       from linked_instruments
      where id = $1 and platform_tenant_id = $2 and account_of_digital_asset_id = $3
      for update`,
    [instrumentId, tenantId, accountId]
  );
  const current = currentResult.rows[0] as {
    id: string;
    account_of_digital_asset_id: string;
    instrument_type: string;
    status: string;
    purpose?: string;
    rail_type?: string;
    verification_status?: string;
  } | undefined;
  if (!current) return { status: 404, body: { error: "linked_instrument_not_found" } };

  const status = optionalStringBody(input.body, "status");
  const purpose = optionalStringBody(input.body, "purpose");
  const networkCode = optionalStringBody(input.body, "networkCode");
  const setDefault = input.body.isDefault === true;
  let normalizedPurpose = purpose;

  if (purpose !== undefined) {
    if (isBusinessWireInstrumentType(current.instrument_type)) {
      const wirePurpose = normalizeLinkedWirePurpose(purpose);
      if (!wirePurpose) {
        return {
          status: 400,
          body: {
            error: "linked_wire_purpose_invalid",
            detail: `purpose must be one of: ${linkedWirePurposeValues.join(", ")}`
          }
        };
      }
      normalizedPurpose = wirePurpose;
    } else if (!purposeAllowedForAccount(accountUsePurpose, purpose)) {
      return { status: 400, body: { error: "linked_instrument_purpose_mismatch" } };
    }
  }

  if (setDefault) {
    await client.query(
      `update linked_instruments
          set is_default = false,
              updated_at = now()
        where account_of_digital_asset_id = $1
          and id <> $2
          and purpose = coalesce($3, purpose)
          and coalesce(rail_type, '') = coalesce($4, '')
          and status in ('active', 'verified')`,
      [accountId, instrumentId, normalizedPurpose ?? current.purpose ?? null, current.rail_type ?? null]
    );
  }

  const result = await client.query(
    `update linked_instruments
        set status = coalesce($4, status),
            purpose = coalesce($5, purpose),
            network_code = coalesce($6, network_code),
            metadata = metadata,
            is_default = case when $7 then true else is_default end,
            updated_at = now()
      where id = $1 and platform_tenant_id = $2 and account_of_digital_asset_id = $3
      returning id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at`,
    [instrumentId, tenantId, accountId, status, normalizedPurpose, networkCode, setDefault]
  );
  const updated = result.rows[0] as Record<string, unknown> | undefined;
  if (!updated) return { status: 404, body: { error: "linked_instrument_not_found" } };

  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.linked_instrument.updated", {
    accountOfDigitalAssetId: accountId,
    linkedInstrumentId: instrumentId,
    status: status ?? current.status,
    purpose: normalizedPurpose ?? current.purpose,
    networkCode: networkCode ?? undefined,
    isDefault: setDefault
  });

  return { status: 200, body: { linkedInstrument: mapLinkedInstrumentRow(updated) } };
};

const updateLinkedInstrumentAction = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string,
  instrumentId: string,
  action: "verify" | "disable"
): Promise<JsonResponse> => {
  const account = await getAccount(client, tenantId, accountId);
  if (!account) return { status: 404, body: { error: "account_not_found" } };

  const nextStatus = action === "verify" ? "active" : "restricted";
  const nextVerificationStatus = action === "verify" ? "verified" : "disabled";
  const eventType = action === "verify"
    ? "account_of_digital_asset.linked_instrument.verified"
    : "account_of_digital_asset.linked_instrument.disabled";
  const result = await client.query(
    `update linked_instruments
        set status = $4,
            verification_status = $5,
            is_default = case when $6 then false else is_default end,
            updated_at = now()
      where id = $1 and platform_tenant_id = $2 and account_of_digital_asset_id = $3
      returning id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at`,
    [instrumentId, tenantId, accountId, nextStatus, nextVerificationStatus, action === "disable"]
  );
  const updated = result.rows[0] as Record<string, unknown> | undefined;
  if (!updated) return { status: 404, body: { error: "linked_instrument_not_found" } };

  await writeAuditAndOutbox(client, tenantId, input, eventType, {
    accountOfDigitalAssetId: accountId,
    linkedInstrumentId: instrumentId,
    status: nextStatus,
    verificationStatus: nextVerificationStatus
  });

  return { status: 200, body: { linkedInstrument: mapLinkedInstrumentRow(updated) } };
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

const postManualJournal = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const amountMinorUnits = stringBody(input.body, "amountMinorUnits", "0");
  if (BigInt(amountMinorUnits) <= 0n) return { status: 400, body: { error: "money_amount_must_be_positive" } };

  const debitLedgerAccountCode = stringBody(input.body, "debitLedgerAccountCode", "10020");
  const creditLedgerAccountCode = stringBody(input.body, "creditLedgerAccountCode", "20400");
  if (debitLedgerAccountCode === creditLedgerAccountCode) {
    return { status: 400, body: { error: "journal_requires_distinct_debit_credit_accounts" } };
  }

  const ledgerResult = await client.query(
    `select id, account_code from ledger_accounts where account_code = any($1::text[])`,
    [[debitLedgerAccountCode, creditLedgerAccountCode]]
  );
  const debitLedgerId = ledgerResult.rows.find((row: { account_code: string }) => row.account_code === debitLedgerAccountCode)?.id;
  const creditLedgerId = ledgerResult.rows.find((row: { account_code: string }) => row.account_code === creditLedgerAccountCode)?.id;
  if (!debitLedgerId || !creditLedgerId) return { status: 400, body: { error: "posting_rule_ledger_account_missing" } };

  const accountOfDigitalAssetId = optionalStringBody(input.body, "accountOfDigitalAssetId") ?? null;
  const accountingEventType = stringBody(input.body, "eventType", "treasury.manual_journal.posted");
  const journal = {
    id: randomUUID(),
    tenantId,
    description: stringBody(input.body, "description", "Manual journal"),
    amountMinorUnits,
    debitLedgerAccountCode,
    creditLedgerAccountCode,
    accountOfDigitalAssetId: accountOfDigitalAssetId ?? undefined,
    createdAt: new Date().toISOString()
  };

  await client.query(
    `insert into treasury_journal_entries
      (id, platform_tenant_id, source_event_id, accounting_event_type, idempotency_key, description, correlation_id, posted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [journal.id, tenantId, input.idempotencyKey, accountingEventType, input.idempotencyKey, journal.description, input.correlationId, journal.createdAt]
  );
  await client.query(
    `insert into treasury_journal_lines
      (id, journal_entry_id, ledger_account_id, account_of_digital_asset_id, asset_code, currency, debit_minor_units, credit_minor_units)
     values
      ($1, $2, $3, $4, 'USDC', 'USD', $5, 0),
      ($6, $2, $7, $4, 'USDC', 'USD', 0, $5)`,
    [randomUUID(), journal.id, debitLedgerId, accountOfDigitalAssetId, amountMinorUnits, randomUUID(), creditLedgerId]
  );

  await writeAuditAndOutbox(client, tenantId, input, "treasury.journal_entry.posted", {
    journalEntryId: journal.id,
    eventType: accountingEventType
  });
  return { status: 201, body: { journal } };
};

const reverseJournal = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  journalId: string
): Promise<JsonResponse> => {
  const existingReverse = await client.query(
    `select id from treasury_journal_entries
      where platform_tenant_id = $1 and reversal_of_journal_entry_id = $2
      limit 1`,
    [tenantId, journalId]
  );
  if (existingReverse.rows[0]?.id) {
    const journal = await getLedgerJournal(client, tenantId, String(existingReverse.rows[0].id));
    return { status: 200, body: { journal } };
  }

  const entryResult = await client.query(
    `select id, description, posted_at
       from treasury_journal_entries
      where id = $1 and platform_tenant_id = $2`,
    [journalId, tenantId]
  );
  const entry = entryResult.rows[0] as { id: string; description: string; posted_at: unknown } | undefined;
  if (!entry) return { status: 404, body: { error: "journal_not_found" } };

  const linesResult = await client.query(
    `select ledger_account_id, account_of_digital_asset_id, asset_code, currency, debit_minor_units, credit_minor_units
       from treasury_journal_lines
      where journal_entry_id = $1
      order by created_at asc`,
    [journalId]
  );
  if (linesResult.rows.length === 0) return { status: 400, body: { error: "journal_lines_missing" } };

  const reversalId = randomUUID();
  const reversalDescription = stringBody(input.body, "description", `Reversal of ${journalId}`);
  await client.query(
    `insert into treasury_journal_entries
      (id, platform_tenant_id, source_event_id, accounting_event_type, idempotency_key, description, correlation_id, reversal_of_journal_entry_id, posted_at)
     values ($1, $2, $3, 'treasury.journal.reversal.posted', $4, $5, $6, $7, $8)`,
    [reversalId, tenantId, input.idempotencyKey, input.idempotencyKey, reversalDescription, input.correlationId, journalId, new Date().toISOString()]
  );

  for (const row of linesResult.rows as Array<Record<string, unknown>>) {
    await client.query(
      `insert into treasury_journal_lines
        (id, journal_entry_id, ledger_account_id, account_of_digital_asset_id, asset_code, currency, debit_minor_units, credit_minor_units)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        randomUUID(),
        reversalId,
        row.ledger_account_id,
        row.account_of_digital_asset_id ?? null,
        row.asset_code ?? "USDC",
        row.currency ?? "USD",
        row.credit_minor_units,
        row.debit_minor_units
      ]
    );
  }

  await writeAuditAndOutbox(client, tenantId, input, "treasury.journal_entry.reversed", {
    journalEntryId: reversalId,
    reversalOfJournalEntryId: journalId
  });
  const journal = await getLedgerJournal(client, tenantId, reversalId);
  return { status: 201, body: { journal } };
};

const createFundingInstruction = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const destinationAccountOfDigitalAssetId = optionalStringBody(input.body, "destinationAccountOfDigitalAssetId")
    ?? optionalStringBody(input.body, "accountOfDigitalAssetId");
  const sourceAccountOfDigitalAssetId = optionalStringBody(input.body, "sourceAccountOfDigitalAssetId")
    ?? destinationAccountOfDigitalAssetId;
  const amountMinorUnits = stringBody(input.body, "amountMinorUnits");
  const fundingType = stringBody(input.body, "fundingType", "usdc_payin");
  const instructionRole = normalizeFundingInstructionRole(optionalStringBody(input.body, "instructionRole"), fundingType);
  const transferKind = stringBody(input.body, "transferKind", defaultTransferKindForRole(instructionRole));
  const provider = stringBody(input.body, "provider", "circle");
  const assetCode = stringBody(input.body, "assetCode", "USDC");
  const currency = stringBody(input.body, "currency", "USD");
  const providerReferenceId = optionalStringBody(input.body, "providerReferenceId");
  const bankName = stringBody(input.body, "bankName", provider.toUpperCase());
  const routingNumber = stringBody(input.body, "routingNumber", "000000000");
  const accountNumberLast4 = stringBody(input.body, "accountNumberLast4", "0000");
  if (!destinationAccountOfDigitalAssetId || !amountMinorUnits) return { status: 400, body: { error: "account_and_amount_required" } };
  if (asBigInt(amountMinorUnits) <= 0n) return { status: 400, body: { error: "amount_must_be_positive" } };

  const destinationAccount = await getAccount(client, tenantId, destinationAccountOfDigitalAssetId) as Record<string, unknown> | undefined;
  if (!destinationAccount) return { status: 404, body: { error: "destination_account_not_found" } };
  if (sourceAccountOfDigitalAssetId && sourceAccountOfDigitalAssetId !== destinationAccountOfDigitalAssetId) {
    const sourceAccount = await getAccount(client, tenantId, sourceAccountOfDigitalAssetId);
    if (!sourceAccount && transferKind !== "external_to_ada_exception") {
      return { status: 404, body: { error: "source_account_not_found" } };
    }
  }

  const businessClientId = typeof destinationAccount.businessClientId === "string"
    ? destinationAccount.businessClientId
    : (typeof destinationAccount.business_client_id === "string" ? destinationAccount.business_client_id : null);

  const fundingInstructionId = randomUUID();
  const requestedAt = new Date().toISOString();
  await client.query(
    `insert into wire_funding_instructions
      (id, platform_tenant_id, account_of_digital_asset_id, source_account_of_digital_asset_id, destination_account_of_digital_asset_id, business_client_id, funding_type, instruction_role, transfer_kind, asset_code, currency, amount_minor_units, pending_usdc_minor_units, available_usdc_minor_units, status, provider, provider_reference_id, idempotency_key, correlation_id, requested_by, requested_at, updated_at, bank_name, routing_number, account_number_last4, beneficiary_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, 0, 'created', $13, $14, $15, $16, $17, $18, $18, $19, $20, $21, $22)`,
    [
      fundingInstructionId,
      tenantId,
      destinationAccountOfDigitalAssetId,
      sourceAccountOfDigitalAssetId,
      destinationAccountOfDigitalAssetId,
      businessClientId,
      fundingType,
      instructionRole,
      transferKind,
      assetCode,
      currency,
      amountMinorUnits,
      provider,
      providerReferenceId,
      input.idempotencyKey,
      input.correlationId,
      asUuidOrNull(input.actorUserId),
      requestedAt,
      bankName,
      routingNumber,
      accountNumberLast4,
      stringBody(input.body, "beneficiaryName", String(destinationAccount.accountName ?? "Treasury Beneficiary"))
    ]
  );

  await writeFundingInstructionOrders(client, tenantId, {
    fundingInstructionId,
    sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId,
    amountMinorUnits,
    currency,
    instructionRole
  });

  await writeAuditAndOutbox(client, tenantId, input, "funding_instruction.created", {
    fundingInstructionId,
    sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId,
    instructionRole,
    transferKind,
    fundingType,
    amountMinorUnits,
    provider
  });
  return {
    status: 201,
    body: {
      fundingInstruction: await getFundingInstruction(client, tenantId, fundingInstructionId)
    }
  };
};

const createFiatWireAccount = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const wireAccountId = randomUUID();
  const businessClientIdInput = optionalStringBody(input.body, "businessClientId");
  const businessClientId = asUuidOrNull(businessClientIdInput) ?? await ensureTenantPseudoBusinessClient(client, tenantId, input);
  const bankName = stringBody(input.body, "bankName", "Supplier Bank");
  const accountNumberLast4 = stringBody(input.body, "accountNumberLast4", "7788");
  const routingNumber = stringBody(input.body, "routingNumber", "000000001");
  const purpose = normalizeLinkedWirePurpose(optionalStringBody(input.body, "purpose")) ?? "minting";
  const status = "active";

  let targetAccountOfDigitalAssetId = optionalStringBody(input.body, "targetAccountOfDigitalAssetId");
  if (!targetAccountOfDigitalAssetId) {
    const accountLookup = await client.query(
      `select id
         from accounts_of_digital_asset
        where platform_tenant_id = $1
          and business_client_id = $2
          and status in ('pending_activation', 'active')
        order by case when use_purpose = 'tenant_central' then 0 else 1 end,
                 created_at desc
        limit 1`,
      [tenantId, businessClientId]
    );
    targetAccountOfDigitalAssetId = accountLookup.rows[0]?.id ? String(accountLookup.rows[0].id) : undefined;
  }
  if (!targetAccountOfDigitalAssetId) {
    return {
      status: 400,
      body: {
        error: "target_account_of_digital_asset_required",
        detail: "Provide targetAccountOfDigitalAssetId or create an ADA account for the selected business client first."
      }
    };
  }

  const targetAccount = await getAccount(client, tenantId, targetAccountOfDigitalAssetId);
  if (!targetAccount) return { status: 404, body: { error: "account_not_found" } };

  let businessWireAccountId: string | undefined;
  const fullAccountNumber = optionalStringBody(input.body, "accountNumber");
  if (circleEnvironment() === "circle-sandbox" && fullAccountNumber) {
    const circleWireRegistration = await provisionSandboxWireFundingInstructions({
      tenantId,
      accountOfDigitalAssetId: targetAccountOfDigitalAssetId,
      businessClientId,
      idempotencyKey: input.idempotencyKey,
      payload: input.body
    });
    if (circleWireRegistration.status !== "complete") {
      const statusCode = circleWireRegistration.errorCode === "circle_api_key_required"
        || circleWireRegistration.errorCode === "circle_auth_failed"
        || circleWireRegistration.errorCode === "circle_validation_failed"
        ? 400
        : 502;
      const detail = typeof (circleWireRegistration.responsePayload as { detail?: unknown } | undefined)?.detail === "string"
        ? (circleWireRegistration.responsePayload as { detail: string }).detail
        : undefined;
      return {
        status: statusCode,
        body: {
          error: circleWireRegistration.errorCode ?? "circle_provider_unavailable",
          detail
        }
      };
    }
    const wireSetupPayload = circleWireRegistration.responsePayload
      && typeof circleWireRegistration.responsePayload === "object"
      ? circleWireRegistration.responsePayload as Record<string, unknown>
      : undefined;
    businessWireAccountId = typeof wireSetupPayload?.businessWireAccountId === "string"
      ? wireSetupPayload.businessWireAccountId
      : (typeof wireSetupPayload?.wireAccountId === "string" ? wireSetupPayload.wireAccountId : undefined);
  }

  const railCode = `fiat_wire_${routingNumber}_${accountNumberLast4}`.toLowerCase();
  const linkedInstrumentMetadata: Record<string, unknown> = {
    accountNumberLast4,
    routingNumber,
    bankName,
    ...(businessWireAccountId ? { businessWireAccountId } : {})
  };

  await client.query(
    `insert into asset_rails (rail_code, asset_code, rail_name, status)
     values ($1, 'USDC', $2, 'active')
     on conflict (rail_code) do update
       set rail_name = excluded.rail_name,
           status = excluded.status`,
    [railCode, bankName]
  );

  await client.query(
    `insert into linked_instruments
      (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_by_user_id, created_at, updated_at)
     values ($1, $2, $3, 'fiat_wire_bank_account', $4, 'USDC', 'fiat', $5, 'bank', 'verified', $6::jsonb, $7, false, $8, now(), now())`,
    [
      wireAccountId,
      targetAccountOfDigitalAssetId,
      tenantId,
      status,
      purpose,
      JSON.stringify(linkedInstrumentMetadata),
      routingNumber,
      asUuidOrNull(input.actorUserId)
    ]
  );

  const wireAccount = await getFiatWireAccount(client, tenantId, wireAccountId);
  if (!wireAccount) return { status: 500, body: { error: "wire_account_create_failed" } };

  await writeAuditAndOutbox(client, tenantId, input, "fiat.wire_account.created", {
    wireAccountId,
    linkedInstrumentId: wireAccountId,
    accountOfDigitalAssetId: targetAccountOfDigitalAssetId,
    businessClientId,
    ...(businessWireAccountId ? { businessWireAccountId } : {}),
    bankName,
    accountNumberLast4,
    routingNumber,
    status
  });
  return { status: 201, body: { wireAccount } };
};

const ensureTenantPseudoBusinessClient = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<string> => {
  const pseudoLegalName = "Platform Internal Treasury Client";
  const existing = await client.query(
    `select id, onboarding_status
       from business_clients
      where platform_tenant_id = $1
        and legal_name = $2
      order by created_at asc
      limit 1`,
    [tenantId, pseudoLegalName]
  );
  const existingId = existing.rows[0]?.id;
  if (typeof existingId === "string") {
    const onboardingStatus = String(existing.rows[0]?.onboarding_status ?? "");
    if (onboardingStatus !== "approved") {
      await client.query(
        `update business_clients
            set onboarding_status = 'approved',
                updated_at = now()
          where id = $1 and platform_tenant_id = $2`,
        [existingId, tenantId]
      );
      await writeAuditAndOutbox(client, tenantId, input, "business_client.pseudo_internal.normalized", {
        businessClientId: existingId,
        legalName: pseudoLegalName,
        onboardingStatus: "approved"
      });
    }
    return existingId;
  }

  const businessClientId = randomUUID();
  const createdAt = new Date().toISOString();
  await client.query(
    `insert into business_clients
      (id, platform_tenant_id, legal_name, country, onboarding_status, correlation_id, created_at, updated_at)
     values ($1, $2, $3, 'US', 'approved', $4, $5, $5)`,
    [businessClientId, tenantId, pseudoLegalName, input.correlationId, createdAt]
  );
  await writeAuditAndOutbox(client, tenantId, input, "business_client.pseudo_internal.created", {
    businessClientId,
    legalName: pseudoLegalName,
    onboardingStatus: "approved"
  });
  return businessClientId;
};

const mintFromFiatWireAccount = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  wireAccountId: string
): Promise<JsonResponse> => {
  const wireAccount = await getFiatWireAccount(client, tenantId, wireAccountId) as Record<string, unknown> | undefined;
  if (!wireAccount) return { status: 404, body: { error: "wire_account_not_found" } };
  if (wireAccount.status !== "active") return { status: 400, body: { error: "wire_account_not_active" } };
  const sourceAccountOfDigitalAssetId = typeof wireAccount.accountOfDigitalAssetId === "string"
    ? wireAccount.accountOfDigitalAssetId
    : undefined;
  if (!sourceAccountOfDigitalAssetId) {
    return { status: 400, body: { error: "source_account_of_digital_asset_missing" } };
  }

  const targetAccountOfDigitalAssetId = stringBody(input.body, "targetAccountOfDigitalAssetId", "ada_platform_treasury");
  const amountMinorUnits = asBigInt(stringBody(input.body, "amountMinorUnits", "0"));
  if (amountMinorUnits <= 0n) return { status: 400, body: { error: "mint_amount_must_be_positive" } };

  const targetAccount = await getAccount(client, tenantId, targetAccountOfDigitalAssetId);
  if (!targetAccount) return { status: 404, body: { error: "account_not_found" } };
  const targetAccountRecord = targetAccount as Record<string, unknown>;
  const fundingInstructionId = optionalStringBody(input.body, "fundingInstructionId");
  const targetBusinessClientId = typeof targetAccountRecord.businessClientId === "string"
    ? targetAccountRecord.businessClientId
    : undefined;
  if (!targetBusinessClientId) return { status: 400, body: { error: "account_business_client_missing" } };

  let linkedWalletRow = await getLatestVerifiedCircleWalletLinkedInstrument(client, tenantId, targetAccountOfDigitalAssetId);
  if (!linkedWalletRow) {
    const targetUsePurpose = String(targetAccountRecord.usePurpose ?? "");
    const targetStatus = String(targetAccountRecord.status ?? "");
    const shouldAutoProvision = targetUsePurpose === "tenant_central" || targetStatus === "pending_activation";
    if (shouldAutoProvision) {
      const autoProvisionResult = await provisionCircleAccount(client, tenantId, input, targetAccountOfDigitalAssetId);
      if (autoProvisionResult.status >= 400) {
        return autoProvisionResult;
      }
      linkedWalletRow = await getLatestVerifiedCircleWalletLinkedInstrument(client, tenantId, targetAccountOfDigitalAssetId);
    }
  }
  if (!linkedWalletRow) return { status: 400, body: { error: "account_circle_wallet_not_linked" } };

  const destinationWalletId = walletIdFromLinkedInstrument(linkedWalletRow);
  if (!destinationWalletId) {
    return { status: 400, body: { error: "account_circle_wallet_reference_missing" } };
  }
  const destinationWalletAddress = walletAddressFromLinkedInstrument(linkedWalletRow);
  if (!destinationWalletAddress) {
    return { status: 400, body: { error: "account_circle_wallet_address_missing" } };
  }
  const sourceFiatWireLinkedRow = await getDefaultFiatWireLinkedInstrument(client, tenantId, sourceAccountOfDigitalAssetId);
  if (!sourceFiatWireLinkedRow) {
    return {
      status: 400,
      body: {
        error: "source_default_fiat_wire_account_not_found",
        sourceAccountOfDigitalAssetId
      }
    };
  }
  const sourceFiatWireLinkedInstrumentId = String(sourceFiatWireLinkedRow.id);
  let resolvedTrackingRef = trackingRefFromLinkedInstrument(sourceFiatWireLinkedRow);
  let resolvedBeneficiaryBankAccountNumber = beneficiaryBankAccountNumberFromLinkedInstrument(sourceFiatWireLinkedRow);
  let resolvedWireInstructions = wireInstructionsFromLinkedInstrument(sourceFiatWireLinkedRow);
  const businessWireAccountId = businessWireAccountIdFromLinkedInstrument(sourceFiatWireLinkedRow);

  // Keep wire instruction fields sourced from linked-wire metadata so sandbox mock mint payload
  // does not depend on top-level mint request fields.
  const hydrateWireInstructionsFromMetadata = (): Record<string, unknown> | undefined => {
    const base = resolvedWireInstructions && typeof resolvedWireInstructions === "object" && !Array.isArray(resolvedWireInstructions)
      ? { ...resolvedWireInstructions }
      : {};
    const currentTrackingRef = typeof base.trackingRef === "string" && base.trackingRef.trim().length > 0
      ? base.trackingRef
      : undefined;
    if (!currentTrackingRef && resolvedTrackingRef) {
      base.trackingRef = resolvedTrackingRef;
    }

    const beneficiaryBank = base.beneficiaryBank && typeof base.beneficiaryBank === "object" && !Array.isArray(base.beneficiaryBank)
      ? { ...(base.beneficiaryBank as Record<string, unknown>) }
      : {};
    const currentBeneficiaryAccountNumber = typeof beneficiaryBank.accountNumber === "string" && beneficiaryBank.accountNumber.trim().length > 0
      ? beneficiaryBank.accountNumber
      : undefined;
    if (!currentBeneficiaryAccountNumber && resolvedBeneficiaryBankAccountNumber) {
      beneficiaryBank.accountNumber = resolvedBeneficiaryBankAccountNumber;
    }
    if (Object.keys(beneficiaryBank).length > 0) {
      base.beneficiaryBank = beneficiaryBank;
    }

    return Object.keys(base).length > 0 ? base : undefined;
  };

  const maskedAccountNumber = (value: string | undefined): string | undefined => {
    if (!value) return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length <= 4 ? `****${trimmed}` : `****${trimmed.slice(-4)}`;
  };

  const logLinkedWireContext = (stage: string): void => {
    const instructions = resolvedWireInstructions && typeof resolvedWireInstructions === "object" && !Array.isArray(resolvedWireInstructions)
      ? resolvedWireInstructions
      : undefined;
    const instructionsBeneficiaryBank = instructions?.beneficiaryBank && typeof instructions.beneficiaryBank === "object" && !Array.isArray(instructions.beneficiaryBank)
      ? instructions.beneficiaryBank as Record<string, unknown>
      : undefined;
    const instructionsTrackingRef = typeof instructions?.trackingRef === "string"
      ? instructions.trackingRef
      : undefined;
    const instructionsBeneficiaryAccount = typeof instructionsBeneficiaryBank?.accountNumber === "string"
      ? instructionsBeneficiaryBank.accountNumber
      : undefined;

    console.info("[circle] Linked wire account context for mint", {
      stage,
      tenantId,
      sourceAccountOfDigitalAssetId,
      sourceFiatWireLinkedInstrumentId,
      targetAccountOfDigitalAssetId,
      linkedInstrumentId: String(linkedWalletRow.id),
      businessWireAccountId,
      metadataTrackingRef: resolvedTrackingRef,
      metadataBeneficiaryBankAccountNumber: maskedAccountNumber(resolvedBeneficiaryBankAccountNumber),
      wireInstructionsTrackingRef: instructionsTrackingRef,
      wireInstructionsBeneficiaryBankAccountNumber: maskedAccountNumber(instructionsBeneficiaryAccount),
      hasWireInstructions: Boolean(instructions)
    });
  };

  resolvedWireInstructions = hydrateWireInstructionsFromMetadata();
  logLinkedWireContext("pre_runtime_refresh");

  if (fundingInstructionId) {
    const instructionResult = await client.query(
      `select id, instruction_role, status
         from wire_funding_instructions
        where id = $1 and platform_tenant_id = $2
        limit 1
        for update`,
      [fundingInstructionId, tenantId]
    );
    const instruction = instructionResult.rows[0] as Record<string, unknown> | undefined;
    if (!instruction) return { status: 404, body: { error: "funding_instruction_not_found" } };
    if (String(instruction.instruction_role ?? "") !== "internal_treasury_mint") {
      return { status: 400, body: { error: "funding_instruction_mint_role_required" } };
    }

    await client.query(
      `update wire_funding_instructions
          set status = 'pending_provider',
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [fundingInstructionId, tenantId]
    );
    await client.query(
      `update funding_instruction_orders
          set status = 'pending_provider',
              updated_at = now()
        where platform_tenant_id = $1
          and funding_instruction_id = $2
          and order_kind = 'internal_mint_ada_transfer'
          and status in ('created', 'route_resolved', 'route_assigned', 'failed', 'exception')`,
      [tenantId, fundingInstructionId]
    );
  }

  if (circleEnvironment() === "circle-sandbox" && businessWireAccountId) {
    const runtimeWireInstructions = await retrieveSandboxWireFundingInstructions({
      tenantId,
      wireAccountId: businessWireAccountId,
      linkedWireAccount: {
        trackingRef: resolvedTrackingRef,
        beneficiaryBankAccountNumber: resolvedBeneficiaryBankAccountNumber,
        wireInstructions: resolvedWireInstructions
      }
    });
    if (runtimeWireInstructions.status === "complete") {
      const runtimePayload = runtimeWireInstructions.responsePayload as Record<string, unknown>;
      const runtimeTrackingRef = typeof runtimePayload.trackingRef === "string" ? runtimePayload.trackingRef : undefined;
      const runtimeBeneficiaryAccountNumber = typeof runtimePayload.beneficiaryBankAccountNumber === "string"
        ? runtimePayload.beneficiaryBankAccountNumber
        : undefined;
      const runtimeWireInstructionsPayload = runtimePayload.wireInstructions && typeof runtimePayload.wireInstructions === "object" && !Array.isArray(runtimePayload.wireInstructions)
        ? runtimePayload.wireInstructions as Record<string, unknown>
        : undefined;

      if (runtimeTrackingRef) resolvedTrackingRef = runtimeTrackingRef;
      if (runtimeBeneficiaryAccountNumber) resolvedBeneficiaryBankAccountNumber = runtimeBeneficiaryAccountNumber;
      if (runtimeWireInstructionsPayload) resolvedWireInstructions = runtimeWireInstructionsPayload;
      resolvedWireInstructions = hydrateWireInstructionsFromMetadata();
      logLinkedWireContext("post_runtime_refresh");

      await client.query(
        `update linked_instruments
            set metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          where id = $1 and platform_tenant_id = $2`,
        [
          String(linkedWalletRow.id),
          tenantId,
          JSON.stringify({
            businessWireAccountId,
            ...(runtimeTrackingRef ? { trackingRef: runtimeTrackingRef, wireTrackingRef: runtimeTrackingRef } : {}),
            ...(runtimeBeneficiaryAccountNumber ? { beneficiaryBankAccountNumber: runtimeBeneficiaryAccountNumber } : {}),
            ...(runtimeWireInstructionsPayload ? { wireInstructions: runtimeWireInstructionsPayload } : {})
          })
        ]
      );
    }
    if (runtimeWireInstructions.status !== "complete") {
      console.warn("[circle] Runtime wire instruction refresh failed before mint", {
        tenantId,
        sourceAccountOfDigitalAssetId,
        sourceFiatWireLinkedInstrumentId,
        targetAccountOfDigitalAssetId,
        linkedInstrumentId: String(linkedWalletRow.id),
        businessWireAccountId,
        errorCode: runtimeWireInstructions.errorCode,
        detail: typeof runtimeWireInstructions.responsePayload?.detail === "string"
          ? runtimeWireInstructions.responsePayload.detail
          : undefined
      });
    }
  }

  console.log(`Minting ${amountMinorUnits} USDC from source default wire account ${sourceFiatWireLinkedInstrumentId} to Circle wallet ${destinationWalletId} (${destinationWalletAddress}) for account ${targetAccountOfDigitalAssetId}`);
  const providerMint = await mintFiatToCircleWallet({
    tenantId,
    accountOfDigitalAssetId: targetAccountOfDigitalAssetId,
    businessClientId: targetBusinessClientId,
    walletId: destinationWalletId,
    walletAddress: destinationWalletAddress,
    amountMinorUnits: amountMinorUnits.toString(),
    assetCode: "USDC",
    currency: "USD",
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    payload: {
      wireAccountId: sourceFiatWireLinkedInstrumentId,
      ...(businessWireAccountId ? { businessWireAccountId } : {}),
      linkedInstrumentId: String(linkedWalletRow.id),
      sourceAccountOfDigitalAssetId,
      sourceFiatWireLinkedInstrumentId,
      ...(resolvedWireInstructions ? { wireInstructions: resolvedWireInstructions } : {})
    }
  });

  const mintOperationId = randomUUID();
  const mintOperationResponsePayload = {
    providerWalletId: providerMint.providerWalletId,
    providerAddressId: providerMint.providerAddressId,
    providerRequestId: providerMint.providerRequestId,
    status: providerMint.status,
    errorCode: providerMint.errorCode,
    provider: providerMint.responsePayload
  };

  await client.query(
    `insert into circle_api_operations
      (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, account_of_digital_asset_id, business_client_id, linked_instrument_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at)
     values ($1, $2, 'fiat_wire_mint', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, now())`,
    [
      mintOperationId,
      tenantId,
      input.idempotencyKey,
      input.correlationId,
      targetAccountOfDigitalAssetId,
      asUuidOrNull(targetBusinessClientId),
      asUuidOrNull(String(linkedWalletRow.id)),
      JSON.stringify({
        wireAccountId: sourceFiatWireLinkedInstrumentId,
        sourceAccountOfDigitalAssetId,
        sourceFiatWireLinkedInstrumentId,
        accountOfDigitalAssetId: targetAccountOfDigitalAssetId,
        linkedInstrumentId: linkedWalletRow.id,
        destinationWalletId,
        destinationWalletAddress,
        amountMinorUnits: amountMinorUnits.toString(),
        assetCode: "USDC",
        currency: "USD"
      }),
      JSON.stringify(mintOperationResponsePayload),
      undefined,
      providerMint.providerWalletId ?? destinationWalletId,
      providerMint.providerAddressId,
      providerMint.status === "complete" ? "succeeded" : "failed",
      providerMint.errorCode
    ]
  );

  if (providerMint.status !== "complete") {
    console.error("[circle] Mint failed with linked wire context", {
      tenantId,
      sourceAccountOfDigitalAssetId,
      sourceFiatWireLinkedInstrumentId,
      targetAccountOfDigitalAssetId,
      linkedInstrumentId: String(linkedWalletRow.id),
      businessWireAccountId,
      errorCode: providerMint.errorCode,
      detail: typeof providerMint.responsePayload?.detail === "string"
        ? providerMint.responsePayload.detail
        : undefined,
      metadataTrackingRef: resolvedTrackingRef,
      metadataBeneficiaryBankAccountNumber: maskedAccountNumber(resolvedBeneficiaryBankAccountNumber),
      wireInstructionsTrackingRef: typeof resolvedWireInstructions?.trackingRef === "string"
        ? resolvedWireInstructions.trackingRef
        : undefined,
      wireInstructionsBeneficiaryBankAccountNumber: maskedAccountNumber(
        typeof (resolvedWireInstructions?.beneficiaryBank as Record<string, unknown> | undefined)?.accountNumber === "string"
          ? (resolvedWireInstructions?.beneficiaryBank as Record<string, unknown>).accountNumber as string
          : undefined
      )
    });
    if (fundingInstructionId) {
      await client.query(
        `update wire_funding_instructions
            set status = 'failed',
                updated_at = now()
          where id = $1 and platform_tenant_id = $2`,
        [fundingInstructionId, tenantId]
      );
      await client.query(
        `update funding_instruction_orders
            set status = 'failed',
                updated_at = now()
          where platform_tenant_id = $1
            and funding_instruction_id = $2
            and order_kind = 'internal_mint_ada_transfer'`,
        [tenantId, fundingInstructionId]
      );
    }
    await writeAuditAndOutbox(client, tenantId, input, "fiat.mint.failed", {
      wireAccountId,
      targetAccountOfDigitalAssetId,
      amountMinorUnits: amountMinorUnits.toString(),
      destinationWalletId,
      circleOperationId: mintOperationId,
      errorCode: providerMint.errorCode
    });
    const status = providerMint.errorCode === "circle_api_key_required"
      || providerMint.errorCode === "circle_wallet_configuration_required"
      || providerMint.errorCode === "circle_auth_failed"
      || providerMint.errorCode === "circle_validation_failed"
      || providerMint.errorCode === "circle_fiat_mint_endpoint_not_configured"
      ? 400
      : 502;
    const detail = typeof (providerMint.responsePayload as { detail?: unknown } | undefined)?.detail === "string"
      ? (providerMint.responsePayload as { detail: string }).detail
      : undefined;
    return {
      status,
      body: {
        error: providerMint.errorCode ?? "circle_provider_unavailable",
        detail,
        destinationWalletId,
        circleOperation: await getCircleOperation(client, tenantId, mintOperationId)
      }
    };
  }

  if (fundingInstructionId) {
    await client.query(
      `update wire_funding_instructions
          set status = 'pending_confirmation',
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [fundingInstructionId, tenantId]
    );
  }

  const balanceResult = await client.query(
    `select id, available_minor_units
       from account_of_digital_asset_balances
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
        and asset_code = 'USDC'
        and currency = 'USD'
      order by updated_at desc
      limit 1
      for update`,
    [tenantId, targetAccountOfDigitalAssetId]
  );
  const balanceRow = balanceResult.rows[0] as Record<string, unknown> | undefined;
  if (!balanceRow) {
    await client.query(
      `insert into account_of_digital_asset_balances
        (id, platform_tenant_id, account_of_digital_asset_id, asset_code, currency, available_minor_units, pending_minor_units, reserved_minor_units, locked_minor_units, suspense_minor_units, version, projected_at, created_at, updated_at)
       values ($1, $2, $3, 'USDC', 'USD', $4, 0, 0, 0, 0, 1, now(), now(), now())`,
      [randomUUID(), tenantId, targetAccountOfDigitalAssetId, amountMinorUnits.toString()]
    );
  } else {
    const availableMinorUnits = asBigInt(balanceRow.available_minor_units);
    await client.query(
      `update account_of_digital_asset_balances
          set available_minor_units = $3,
              version = version + 1,
              projected_at = now(),
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [String(balanceRow.id), tenantId, (availableMinorUnits + amountMinorUnits).toString()]
    );
  }

  const mint = {
    id: randomUUID(),
    wireAccountId,
    targetAccountOfDigitalAssetId,
    amountMinorUnits: amountMinorUnits.toString(),
    status: "completed",
    providerMintId: providerMint.providerRequestId ?? providerMint.providerWalletId,
    providerWalletId: providerMint.providerWalletId ?? destinationWalletId,
    destinationWalletAddress,
    destinationWalletId,
    circleOperationId: mintOperationId,
    createdAt: new Date().toISOString()
  };

  await writeAuditAndOutbox(client, tenantId, input, "fiat.mint.completed", mint);
  return { status: 201, body: { mint } };
};

const createFundingReservation = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const settlementObligationId = stringBody(input.body, "settlementObligationId");
  const accountOfDigitalAssetId = stringBody(input.body, "accountOfDigitalAssetId");
  const amountMinorUnits = asBigInt(stringBody(input.body, "amountMinorUnits", "0"));

  if (!settlementObligationId || !accountOfDigitalAssetId) {
    return { status: 400, body: { error: "settlement_obligation_and_account_required" } };
  }
  if (amountMinorUnits <= 0n) return { status: 400, body: { error: "amount_must_be_positive" } };

  const obligationResult = await client.query(
    `select id
       from settlement_obligations
      where id = $1 and platform_tenant_id = $2`,
    [settlementObligationId, tenantId]
  );
  if (!obligationResult.rows[0]) return { status: 404, body: { error: "obligation_not_found" } };

  const account = await getAccount(client, tenantId, accountOfDigitalAssetId);
  if (!account) return { status: 404, body: { error: "account_not_found" } };

  const balanceResult = await client.query(
    `select available_minor_units, reserved_minor_units
       from account_of_digital_asset_balances
      where platform_tenant_id = $1 and account_of_digital_asset_id = $2
      order by updated_at desc
      limit 1
      for update`,
    [tenantId, accountOfDigitalAssetId]
  );
  const balanceRow = balanceResult.rows[0] as Record<string, unknown> | undefined;
  if (!balanceRow) return { status: 400, body: { error: "account_balance_not_found" } };

  const availableMinorUnits = asBigInt(balanceRow.available_minor_units);
  const reservedMinorUnits = asBigInt(balanceRow.reserved_minor_units);
  if (availableMinorUnits < amountMinorUnits) {
    return { status: 400, body: { error: "reservation_exceeds_available_balance" } };
  }

  const reservationId = randomUUID();
  await client.query(
    `insert into funding_reservations
      (id, platform_tenant_id, settlement_obligation_id, account_of_digital_asset_id, amount_minor_units, consumed_minor_units, priority, status, activated_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 0, 100, 'active', now(), now(), now())`,
    [reservationId, tenantId, settlementObligationId, accountOfDigitalAssetId, amountMinorUnits.toString()]
  );
  await client.query(
    `update account_of_digital_asset_balances
        set available_minor_units = $3,
            reserved_minor_units = $4,
            version = version + 1,
            projected_at = now(),
            updated_at = now()
      where platform_tenant_id = $1 and account_of_digital_asset_id = $2`,
    [tenantId, accountOfDigitalAssetId, (availableMinorUnits - amountMinorUnits).toString(), (reservedMinorUnits + amountMinorUnits).toString()]
  );

  await writeAuditAndOutbox(client, tenantId, input, "funding_reservation.activated", {
    reservationId,
    settlementObligationId,
    accountOfDigitalAssetId,
    amountMinorUnits: amountMinorUnits.toString(),
    status: "active"
  });

  return {
    status: 201,
    body: {
      reservation: await getFundingReservation(client, tenantId, reservationId)
    }
  };
};

const transitionFundingReservation = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  reservationId: string,
  action: string
): Promise<JsonResponse> => {
  const reservationResult = await client.query(
    `select id,
            settlement_obligation_id,
            account_of_digital_asset_id,
            amount_minor_units,
            consumed_minor_units,
            status
       from funding_reservations
      where id = $1 and platform_tenant_id = $2
      for update`,
    [reservationId, tenantId]
  );
  const reservationRow = reservationResult.rows[0] as Record<string, unknown> | undefined;
  if (!reservationRow) return { status: 404, body: { error: "reservation_not_found" } };

  const currentStatus = String(reservationRow.status ?? "");
  const nextStatus = action === "activate"
    ? "active"
    : action === "release"
      ? "released"
      : action === "expire"
        ? "expired"
        : "cancelled";

  const accountOfDigitalAssetId = String(reservationRow.account_of_digital_asset_id);
  const amountMinorUnits = asBigInt(reservationRow.amount_minor_units);
  const consumedMinorUnits = asBigInt(reservationRow.consumed_minor_units);
  const releasableMinorUnits = amountMinorUnits > consumedMinorUnits ? amountMinorUnits - consumedMinorUnits : 0n;

  if (currentStatus !== nextStatus) {
    const balanceResult = await client.query(
      `select available_minor_units, reserved_minor_units
         from account_of_digital_asset_balances
        where platform_tenant_id = $1 and account_of_digital_asset_id = $2
        order by updated_at desc
        limit 1
        for update`,
      [tenantId, accountOfDigitalAssetId]
    );
    const balanceRow = balanceResult.rows[0] as Record<string, unknown> | undefined;
    if (!balanceRow) return { status: 400, body: { error: "account_balance_not_found" } };

    let availableMinorUnits = asBigInt(balanceRow.available_minor_units);
    let reservedMinorUnits = asBigInt(balanceRow.reserved_minor_units);

    if (currentStatus !== "active" && nextStatus === "active") {
      if (availableMinorUnits < releasableMinorUnits) {
        return { status: 400, body: { error: "reservation_exceeds_available_balance" } };
      }
      availableMinorUnits -= releasableMinorUnits;
      reservedMinorUnits += releasableMinorUnits;
    } else if (currentStatus === "active" && nextStatus !== "active") {
      availableMinorUnits += releasableMinorUnits;
      reservedMinorUnits = reservedMinorUnits >= releasableMinorUnits ? reservedMinorUnits - releasableMinorUnits : 0n;
    }

    await client.query(
      `update account_of_digital_asset_balances
          set available_minor_units = $3,
              reserved_minor_units = $4,
              version = version + 1,
              projected_at = now(),
              updated_at = now()
        where platform_tenant_id = $1 and account_of_digital_asset_id = $2`,
      [tenantId, accountOfDigitalAssetId, availableMinorUnits.toString(), reservedMinorUnits.toString()]
    );
  }

  const timestampColumn = nextStatus === "active"
    ? "activated_at"
    : nextStatus === "released"
      ? "released_at"
      : nextStatus === "expired"
        ? "expired_at"
        : "cancelled_at";

  await client.query(
    `update funding_reservations
        set status = $3,
            ${timestampColumn} = now(),
            updated_at = now()
      where id = $1 and platform_tenant_id = $2`,
    [reservationId, tenantId, nextStatus]
  );

  const eventType = action === "release" ? "funding_reservation.released" : `funding_reservation.${nextStatus}`;
  await writeAuditAndOutbox(client, tenantId, input, eventType, {
    reservationId,
    settlementObligationId: String(reservationRow.settlement_obligation_id),
    accountOfDigitalAssetId,
    fromStatus: currentStatus,
    toStatus: nextStatus
  });

  return {
    status: 200,
    body: {
      reservation: await getFundingReservation(client, tenantId, reservationId)
    }
  };
};

const createInternalPayment = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const sourceAccountOfDigitalAssetId = stringBody(input.body, "sourceAccountOfDigitalAssetId", "ada_buyer");
  const destinationAccountOfDigitalAssetId = stringBody(input.body, "destinationAccountOfDigitalAssetId", sourceAccountOfDigitalAssetId);
  const amountMinorUnits = asBigInt(stringBody(input.body, "amountMinorUnits", "0"));
  if (amountMinorUnits <= 0n) return { status: 400, body: { error: "amount_must_be_positive" } };

  const paymentId = randomUUID();
  await client.query(
    `insert into payment_instructions
      (id, platform_tenant_id, source_account_of_digital_asset_id, destination_account_of_digital_asset_id, settlement_obligation_id, funding_reservation_id, amount_minor_units, route_type, status, idempotency_key, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 'internal', 'created', $8, now())`,
    [
      paymentId,
      tenantId,
      sourceAccountOfDigitalAssetId,
      destinationAccountOfDigitalAssetId,
      asUuidOrNull(optionalStringBody(input.body, "settlementObligationId")),
      asUuidOrNull(optionalStringBody(input.body, "fundingReservationId")),
      amountMinorUnits.toString(),
      input.idempotencyKey
    ]
  );

  const payment = await getPayment(client, tenantId, paymentId);
  if (!payment) return { status: 500, body: { error: "payment_create_failed" } };
  return { status: 201, body: { payment } };
};

const createExternalPayment = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const sourceAccountOfDigitalAssetId = stringBody(input.body, "sourceAccountOfDigitalAssetId", "ada_buyer");
  const amountMinorUnits = asBigInt(stringBody(input.body, "amountMinorUnits", "0"));
  if (amountMinorUnits <= 0n) return { status: 400, body: { error: "amount_must_be_positive" } };

  const recipientAddress = stringBody(input.body, "recipientAddress");
  if (!recipientAddress) return { status: 400, body: { error: "recipient_address_required" } };
  const recipientChain = stringBody(input.body, "recipientChain", "ARC");
  const recipientLabel = stringBody(input.body, "recipientLabel", "External USDC Recipient");

  const recipientId = randomUUID();
  const recipientResult = await client.query(
    `insert into external_recipients
      (id, platform_tenant_id, label, asset_code, chain, address, status, created_at)
     values ($1, $2, $3, 'USDC', $4, $5, 'active', now())
     on conflict (platform_tenant_id, chain, address)
     do update set label = excluded.label
     returning id`,
    [recipientId, tenantId, recipientLabel, recipientChain, recipientAddress]
  );
  const externalRecipientId = String(recipientResult.rows[0]?.id ?? recipientId);

  const paymentId = randomUUID();
  await client.query(
    `insert into external_payment_executions
      (id, platform_tenant_id, source_account_of_digital_asset_id, external_recipient_id, settlement_obligation_id, funding_reservation_id, amount_minor_units, fee_minor_units, idempotency_key, status, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, 0, $8, 'created', now())`,
    [
      paymentId,
      tenantId,
      sourceAccountOfDigitalAssetId,
      externalRecipientId,
      asUuidOrNull(optionalStringBody(input.body, "settlementObligationId")),
      asUuidOrNull(optionalStringBody(input.body, "fundingReservationId")),
      amountMinorUnits.toString(),
      input.idempotencyKey
    ]
  );

  const payment = await getPayment(client, tenantId, paymentId);
  if (!payment) return { status: 500, body: { error: "payment_create_failed" } };
  return { status: 201, body: { payment } };
};

const transitionPayment = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  paymentId: string,
  action: string
): Promise<JsonResponse> => {
  const internalResult = await client.query(
    `select id, status
       from payment_instructions
      where id = $1 and platform_tenant_id = $2
      for update`,
    [paymentId, tenantId]
  );
  const internal = internalResult.rows[0] as Record<string, unknown> | undefined;
  if (internal) {
    const nextStatus = action === "cancel"
      ? "cancelled"
      : action === "refresh-status"
        ? "complete"
        : "submitted";

    await client.query(
      `update payment_instructions
          set status = $3,
              terminal_at = case when $3 in ('complete', 'failed', 'cancelled') then now() else terminal_at end
        where id = $1 and platform_tenant_id = $2`,
      [paymentId, tenantId, nextStatus]
    );

    if (action !== "cancel") {
      const executionResult = await client.query(
        `select id, provider_transfer_id
           from internal_transfer_executions
          where payment_instruction_id = $1 and platform_tenant_id = $2
          order by created_at desc
          limit 1
          for update`,
        [paymentId, tenantId]
      );
      const execution = executionResult.rows[0] as Record<string, unknown> | undefined;
      const providerTransferId = String(execution?.provider_transfer_id ?? randomUUID());
      if (execution?.id) {
        await client.query(
          `update internal_transfer_executions
              set status = $3,
                  provider_transfer_id = coalesce(provider_transfer_id, $4)
            where id = $1 and platform_tenant_id = $2`,
          [execution.id, tenantId, nextStatus, providerTransferId]
        );
      } else {
        await client.query(
          `insert into internal_transfer_executions
            (id, platform_tenant_id, payment_instruction_id, provider, provider_transfer_id, status, created_at)
           values ($1, $2, $3, 'circle', $4, $5, now())`,
          [randomUUID(), tenantId, paymentId, providerTransferId, nextStatus]
        );
      }

      await writeAuditAndOutbox(
        client,
        tenantId,
        input,
        nextStatus === "complete" ? "payment_execution.completed" : "payment_execution.submitted",
        { paymentId, providerTransferId }
      );
    }

    const payment = await getPayment(client, tenantId, paymentId);
    return { status: 200, body: { payment } };
  }

  const externalResult = await client.query(
    `select id, status, provider_transfer_id
       from external_payment_executions
      where id = $1 and platform_tenant_id = $2
      for update`,
    [paymentId, tenantId]
  );
  const external = externalResult.rows[0] as Record<string, unknown> | undefined;
  if (!external) return { status: 404, body: { error: "payment_not_found" } };

  const nextStatus = action === "cancel"
    ? "cancelled"
    : action === "refresh-status"
      ? "complete"
      : "submitted";
  const providerTransferId = action === "cancel"
    ? external.provider_transfer_id
    : (external.provider_transfer_id ?? randomUUID());

  await client.query(
    `update external_payment_executions
        set status = $3,
            provider_transfer_id = coalesce(provider_transfer_id, $4),
            terminal_at = case when $3 in ('complete', 'failed', 'cancelled') then now() else terminal_at end
      where id = $1 and platform_tenant_id = $2`,
    [paymentId, tenantId, nextStatus, providerTransferId]
  );

  if (action !== "cancel") {
    await writeAuditAndOutbox(
      client,
      tenantId,
      input,
      nextStatus === "complete" ? "payment_execution.completed" : "payment_execution.submitted",
      { paymentId, providerTransferId }
    );
  }

  const payment = await getPayment(client, tenantId, paymentId);
  return { status: 200, body: { payment } };
};

const createFiatRedemption = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const sourceAccountOfDigitalAssetId = stringBody(input.body, "sourceAccountOfDigitalAssetId", "ada_supplier");
  const amountMinorUnits = asBigInt(stringBody(input.body, "amountMinorUnits", "0"));
  if (amountMinorUnits <= 0n) return { status: 400, body: { error: "amount_must_be_positive" } };

  let linkedInstrumentId = optionalStringBody(input.body, "linkedInstrumentId")
    ?? optionalStringBody(input.body, "fiatWireAccountId");
  if (!linkedInstrumentId) {
    const wireResult = await client.query(
      `select id
         from linked_instruments
        where platform_tenant_id = $1
          and account_of_digital_asset_id = $2
          and rail_type = 'fiat'
        order by created_at desc
        limit 1`,
      [tenantId, sourceAccountOfDigitalAssetId]
    );
    linkedInstrumentId = wireResult.rows[0]?.id ? String(wireResult.rows[0].id) : undefined;
  }
  if (!linkedInstrumentId) return { status: 400, body: { error: "wire_account_not_found" } };

  const redemptionId = randomUUID();
  await client.query(
    `insert into redemption_instructions
      (id, platform_tenant_id, source_account_of_digital_asset_id, linked_instrument_id, amount_minor_units, idempotency_key, status, created_at)
     values ($1, $2, $3, $4, $5, $6, 'created', now())`,
    [redemptionId, tenantId, sourceAccountOfDigitalAssetId, linkedInstrumentId, amountMinorUnits.toString(), input.idempotencyKey]
  );

  const redemption = await getFiatRedemption(client, tenantId, redemptionId);
  if (!redemption) return { status: 500, body: { error: "redemption_create_failed" } };
  return { status: 201, body: { redemption } };
};

const transitionFiatRedemption = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  redemptionId: string,
  action: string
): Promise<JsonResponse> => {
  const result = await client.query(
    `select id, status, provider_withdrawal_id
       from redemption_instructions
      where id = $1 and platform_tenant_id = $2
      for update`,
    [redemptionId, tenantId]
  );
  const current = result.rows[0] as Record<string, unknown> | undefined;
  if (!current) return { status: 404, body: { error: "redemption_not_found" } };

  const nextStatus = action === "refresh-status" ? "complete" : "submitted";
  const providerWithdrawalId = String(current.provider_withdrawal_id ?? randomUUID());

  await client.query(
    `update redemption_instructions
        set status = $3,
            provider_withdrawal_id = coalesce(provider_withdrawal_id, $4),
            terminal_at = case when $3 in ('complete', 'failed', 'unknown_suspense') then now() else terminal_at end
      where id = $1 and platform_tenant_id = $2`,
    [redemptionId, tenantId, nextStatus, providerWithdrawalId]
  );
  await client.query(
    `insert into redemption_execution_events
      (id, platform_tenant_id, redemption_instruction_id, event_type, payload, created_at)
     values ($1, $2, $3, $4, $5::jsonb, now())`,
    [
      randomUUID(),
      tenantId,
      redemptionId,
      nextStatus === "complete" ? "redemption.completed" : "redemption.submitted",
      JSON.stringify({ redemptionId, providerWithdrawalId, action })
    ]
  );
  await writeAuditAndOutbox(
    client,
    tenantId,
    input,
    nextStatus === "complete" ? "redemption.completed" : "redemption.submitted",
    { redemptionId, providerWithdrawalId }
  );

  const redemption = await getFiatRedemption(client, tenantId, redemptionId);
  return { status: 200, body: { redemption } };
};

const transitionFundingInstruction = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  fundingInstructionId: string,
  action: string
): Promise<JsonResponse> => {
  const currentResult = await client.query(
    `select id,
            coalesce(source_account_of_digital_asset_id, account_of_digital_asset_id) as source_account_of_digital_asset_id,
            coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) as destination_account_of_digital_asset_id,
            status
       from wire_funding_instructions
      where id = $1 and platform_tenant_id = $2`,
    [fundingInstructionId, tenantId]
  );
  const current = currentResult.rows[0];
  if (!current) return { status: 404, body: { error: "funding_instruction_not_found" } };

  const nextStatus = action === "assign-route" ? "route_resolved" : "cancelled";
  const routeEvidence = action === "assign-route"
    ? await deriveInstructionRouteEvidence(
      client,
      tenantId,
      String(current.source_account_of_digital_asset_id ?? ""),
      String(current.destination_account_of_digital_asset_id ?? "")
    )
    : undefined;
  await client.query(
    `update wire_funding_instructions
        set status = $3,
            route_evidence_json = case when $4::jsonb is null then route_evidence_json else $4::jsonb end,
            updated_at = now()
      where id = $1 and platform_tenant_id = $2`,
    [
      fundingInstructionId,
      tenantId,
      nextStatus,
      routeEvidence ? JSON.stringify(routeEvidence) : null
    ]
  );
  if (action === "assign-route") {
    await client.query(
      `update funding_instruction_orders
          set status = case
                when order_kind in ('internal_mint_ada_transfer', 'ada_wire_transfer') then 'route_resolved'
                else status
              end,
              updated_at = now()
        where platform_tenant_id = $1
          and funding_instruction_id = $2
          and status in ('created', 'route_assigned', 'route_resolved')`,
      [tenantId, fundingInstructionId]
    );
  }
  await writeAuditAndOutbox(client, tenantId, input, `funding_instruction.${action}`, {
    fundingInstructionId,
    sourceAccountOfDigitalAssetId: current.source_account_of_digital_asset_id,
    destinationAccountOfDigitalAssetId: current.destination_account_of_digital_asset_id,
    routeEvidence,
    fromStatus: current.status,
    toStatus: nextStatus
  });
  return {
    status: 200,
    body: {
      fundingInstruction: await getFundingInstruction(client, tenantId, fundingInstructionId)
    }
  };
};

const createFundingRoute = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string
): Promise<JsonResponse> => {
  const routeId = randomUUID();
  const routeType = stringBody(input.body, "routeType", "circle_deposit_address");
  const provider = stringBody(input.body, "provider", "circle");
  const status = stringBody(input.body, "status", "pending_verification");
  const verificationStatus = stringBody(input.body, "verificationStatus", "pending");
  await client.query(
    `insert into funding_routes
      (id, platform_tenant_id, account_of_digital_asset_id, route_type, provider, chain, asset_code, bank_rail, deposit_address, bank_account_ref, status, verification_status, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
    [
      routeId,
      tenantId,
      accountId,
      routeType,
      provider,
      optionalStringBody(input.body, "chain"),
      stringBody(input.body, "assetCode", "USDC"),
      optionalStringBody(input.body, "bankRail"),
      optionalStringBody(input.body, "depositAddress"),
      optionalStringBody(input.body, "bankAccountRef"),
      status,
      verificationStatus,
      JSON.stringify(input.body.metadata ?? {})
    ]
  );
  await writeAuditAndOutbox(client, tenantId, input, "funding_route.created", {
    routeId,
    accountOfDigitalAssetId: accountId,
    routeType,
    provider
  });
  return { status: 201, body: { route: await getFundingRoute(client, tenantId, routeId) } };
};

const verifyFundingRoute = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  accountId: string,
  routeId: string
): Promise<JsonResponse> => {
  const result = await client.query(
    `update funding_routes
        set status = 'active',
            verification_status = 'verified',
            updated_at = now()
      where id = $1 and platform_tenant_id = $2 and account_of_digital_asset_id = $3
      returning id`,
    [routeId, tenantId, accountId]
  );
  if (!result.rows[0]) return { status: 404, body: { error: "funding_route_not_found" } };
  await writeAuditAndOutbox(client, tenantId, input, "funding_route.verified", {
    routeId,
    accountOfDigitalAssetId: accountId
  });
  return { status: 200, body: { route: await getFundingRoute(client, tenantId, routeId) } };
};

const ingestCircleWebhook = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput
): Promise<JsonResponse> => {
  const rawBody = input.rawBody ?? JSON.stringify(input.body);
  const signature = input.headers?.["circle-signature"] ?? input.headers?.["x-circle-signature"];
  const keyId = input.headers?.["circle-key-id"] ?? input.headers?.["x-circle-key-id"];
  const verification = await verifyCircleWebhook(rawBody, signature, undefined, keyId);
  const providerEventId = stringBody(input.body, "providerEventId")
    || stringBody(input.body, "eventId")
    || stringBody(input.body, "id")
    || verification.providerEventId;
  const eventType = stringBody(input.body, "eventType")
    || stringBody(input.body, "type")
    || verification.eventType;
  if (!providerEventId || !eventType) return { status: 400, body: { error: "provider_event_id_and_event_type_required" } };

  const existing = await client.query(
    `select id, status
       from provider_webhook_events
      where platform_tenant_id = $1 and provider = 'circle' and provider_event_id = $2
      limit 1`,
    [tenantId, providerEventId]
  );
  if (existing.rows[0]) {
    return { status: 200, body: { webhookEventId: existing.rows[0].id, duplicate: true, status: existing.rows[0].status } };
  }

  const signatureValid = input.body.signatureValid === false ? false : verification.valid;
  const normalized = normalizeCircleWebhookPayload(input.body, providerEventId, eventType);

  if (!signatureValid) {
    const webhookEventId = randomUUID();
    const deadLetterId = randomUUID();
    await client.query(
      `insert into provider_webhook_events
        (id, platform_tenant_id, provider, provider_event_id, event_type, signature_valid, status, payload_json, normalized_json, error_code, error_message)
       values ($1, $2, 'circle', $3, $4, false, 'failed', $5::jsonb, $6::jsonb, 'invalid_signature', 'Circle webhook signature verification failed')`,
      [webhookEventId, tenantId, providerEventId, eventType, JSON.stringify(input.body), JSON.stringify(normalized)]
    );
    await client.query(
      `insert into provider_webhook_dead_letters
        (id, platform_tenant_id, provider, provider_event_id, event_type, payload_json, error_code, error_message, retry_count)
       values ($1, $2, 'circle', $3, $4, $5::jsonb, 'invalid_signature', 'Circle webhook signature verification failed', 0)`,
      [deadLetterId, tenantId, providerEventId, eventType, JSON.stringify(input.body)]
    );
    await writeAuditAndOutbox(client, tenantId, input, "circle.webhook.dead_lettered", {
      webhookEventId,
      providerEventId,
      eventType,
      deadLetterId,
      reason: "invalid_signature"
    });
    return { status: 400, body: { error: "invalid_signature", webhookEventId, deadLetterId } };
  }

  const webhookEventId = randomUUID();
  await client.query(
    `insert into provider_webhook_events
      (id, platform_tenant_id, provider, provider_event_id, event_type, signature_valid, status, payload_json, normalized_json)
     values ($1, $2, 'circle', $3, $4, true, 'received', $5::jsonb, $6::jsonb)`,
    [webhookEventId, tenantId, providerEventId, eventType, JSON.stringify(input.body), JSON.stringify(normalized)]
  );

  let processingStatus: "processed" | "failed" = "processed";
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  let deadLetterId: string | undefined;

  try {
    await processFundingInstructionWebhookEvent(client, tenantId, input, webhookEventId, normalized);
  } catch (error) {
    processingStatus = "failed";
    errorCode = "webhook_processing_failed";
    errorMessage = error instanceof Error ? error.message : "circle_webhook_processing_failed";
    deadLetterId = randomUUID();
    await client.query(
      `insert into provider_webhook_dead_letters
        (id, platform_tenant_id, provider, provider_event_id, event_type, payload_json, error_code, error_message, retry_count)
       values ($1, $2, 'circle', $3, $4, $5::jsonb, $6, $7, 1)`,
      [deadLetterId, tenantId, providerEventId, eventType, JSON.stringify(input.body), errorCode, errorMessage]
    );
  }

  await client.query(
    `update provider_webhook_events
        set status = $3,
            processed_at = now(),
            error_code = $4,
            error_message = $5,
            normalized_json = $6::jsonb
      where id = $1 and platform_tenant_id = $2`,
    [
      webhookEventId,
      tenantId,
      processingStatus,
      errorCode ?? null,
      errorMessage ?? null,
      JSON.stringify(normalized)
    ]
  );

  if (processingStatus === "failed") {
    await writeAuditAndOutbox(client, tenantId, input, "circle.webhook.processing_failed", {
      webhookEventId,
      providerEventId,
      eventType,
      errorCode,
      errorMessage,
      deadLetterId
    });
    return {
      status: 500,
      body: {
        error: errorCode,
        message: errorMessage,
        webhookEventId,
        deadLetterId
      }
    };
  }

  await writeAuditAndOutbox(client, tenantId, input, "circle.webhook.processed", {
    webhookEventId,
    providerEventId,
    eventType
  });
  return { status: 202, body: { webhookEventId, providerEventId, eventType, status: "processed" } };
};

const webhookIdempotencyKey = (input: Sprint1PostgresCommandInput, hash: string): string => {
  const providerEventId = stringBody(input.body, "providerEventId")
    || stringBody(input.body, "eventId")
    || stringBody(input.body, "id");
  return providerEventId ? `circle_webhook_${providerEventId}` : `circle_webhook_${hash}`;
};

const reprocessCircleWebhook = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  webhookEventId: string
): Promise<JsonResponse> => {
  const result = await client.query(
    `update provider_webhook_events
        set status = 'processed',
            retry_count = coalesce(retry_count, 0) + 1,
            processed_at = now(),
            error_code = null,
            error_message = null
      where id = $1 and platform_tenant_id = $2
      returning id, provider_event_id, event_type, status, retry_count, processed_at`,
    [webhookEventId, tenantId]
  );
  const event = result.rows[0];
  if (!event) return { status: 404, body: { error: "webhook_event_not_found" } };
  await writeAuditAndOutbox(client, tenantId, input, "circle.webhook.reprocessed", {
    webhookEventId,
    providerEventId: event.provider_event_id,
    eventType: event.event_type,
    retryCount: event.retry_count
  });
  return {
    status: 200,
    body: {
      webhookEvent: {
        id: event.id,
        providerEventId: event.provider_event_id,
        eventType: event.event_type,
        status: event.status,
        retryCount: event.retry_count,
        processedAt: toIsoString(event.processed_at)
      }
    }
  };
};

const resolveReconciliationBreak = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  breakId: string
): Promise<JsonResponse> => {
  const resolutionNote = stringBody(input.body, "resolutionNote", "Resolved by operator");
  const result = await client.query(
    `update reconciliation_breaks
        set status = 'resolved',
            resolution_note = $3,
            resolved_by = $4,
            resolved_at = now(),
            updated_at = now()
      where id = $1 and platform_tenant_id = $2
      returning id, status, reason, webhook_event_id, suspense_case_id, resolution_note, resolved_at`,
    [breakId, tenantId, resolutionNote, asUuidOrNull(input.actorUserId)]
  );
  const row = result.rows[0];
  if (!row) return { status: 404, body: { error: "reconciliation_break_not_found" } };
  await writeAuditAndOutbox(client, tenantId, input, "reconciliation.break.resolved", {
    reconciliationBreakId: breakId,
    resolutionNote
  });
  return {
    status: 200,
    body: {
      break: {
        id: row.id,
        status: row.status,
        reason: row.reason,
        webhookEventId: row.webhook_event_id ?? undefined,
        suspenseCaseId: row.suspense_case_id ?? undefined,
        resolutionNote: row.resolution_note ?? undefined,
        resolvedAt: toIsoString(row.resolved_at)
      }
    }
  };
};

interface FundingInstructionOrderSeed {
  fundingInstructionId: string;
  sourceAccountOfDigitalAssetId?: string;
  destinationAccountOfDigitalAssetId?: string;
  amountMinorUnits: string;
  currency: string;
  instructionRole: "internal_treasury_mint" | "client_exchange";
}

interface NormalizedCircleWebhookEvent {
  providerEventId: string;
  eventType: string;
  fundingInstructionId?: string;
  providerReferenceId?: string;
  accountOfDigitalAssetId?: string;
  sourceAccountOfDigitalAssetId?: string;
  destinationAccountOfDigitalAssetId?: string;
  amountMinorUnits: string;
  payload: Record<string, unknown>;
}

const normalizeFundingInstructionRole = (
  instructionRole: string | undefined,
  fundingType: string
): "internal_treasury_mint" | "client_exchange" => {
  if (instructionRole === "internal_treasury_mint" || instructionRole === "client_exchange") return instructionRole;
  const normalizedFundingType = fundingType.trim().toLowerCase();
  if (["internal_treasury_mint", "internal_mint", "tenant_self_mint"].includes(normalizedFundingType)) {
    return "internal_treasury_mint";
  }
  return "client_exchange";
};

const defaultTransferKindForRole = (instructionRole: "internal_treasury_mint" | "client_exchange"): string => {
  if (instructionRole === "internal_treasury_mint") return "ada_to_ada_internal";
  return "ada_to_ada_payin_underlying";
};

const writeFundingInstructionOrders = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  seed: FundingInstructionOrderSeed
): Promise<void> => {
  if (seed.instructionRole === "internal_treasury_mint") {
    await insertFundingInstructionOrder(client, tenantId, {
      fundingInstructionId: seed.fundingInstructionId,
      orderKind: "internal_mint_ada_transfer",
      sourceAccountOfDigitalAssetId: seed.sourceAccountOfDigitalAssetId,
      destinationAccountOfDigitalAssetId: seed.destinationAccountOfDigitalAssetId,
      amountMinorUnits: seed.amountMinorUnits,
      currency: seed.currency,
      status: "created"
    });
    return;
  }

  const wireOrderId = await insertFundingInstructionOrder(client, tenantId, {
    fundingInstructionId: seed.fundingInstructionId,
    orderKind: "ada_wire_transfer",
    sourceAccountOfDigitalAssetId: seed.sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId: seed.destinationAccountOfDigitalAssetId,
    amountMinorUnits: seed.amountMinorUnits,
    currency: seed.currency,
    status: "created"
  });

  await insertFundingInstructionOrder(client, tenantId, {
    fundingInstructionId: seed.fundingInstructionId,
    orderKind: "ada_usdc_transfer",
    dependencyOrderId: wireOrderId,
    sourceAccountOfDigitalAssetId: seed.sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId: seed.destinationAccountOfDigitalAssetId,
    amountMinorUnits: seed.amountMinorUnits,
    currency: seed.currency,
    status: "blocked_dependency"
  });
};

const insertFundingInstructionOrder = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: {
    fundingInstructionId: string;
    orderKind: string;
    dependencyOrderId?: string;
    sourceAccountOfDigitalAssetId?: string;
    destinationAccountOfDigitalAssetId?: string;
    amountMinorUnits: string;
    currency: string;
    status: string;
  }
): Promise<string> => {
  const orderId = randomUUID();
  await client.query(
    `insert into funding_instruction_orders
      (id, platform_tenant_id, funding_instruction_id, order_kind, dependency_order_id, source_account_of_digital_asset_id, destination_account_of_digital_asset_id, amount_minor_units, currency, status, provider_payload_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb)`,
    [
      orderId,
      tenantId,
      input.fundingInstructionId,
      input.orderKind,
      input.dependencyOrderId ?? null,
      input.sourceAccountOfDigitalAssetId ?? null,
      input.destinationAccountOfDigitalAssetId ?? null,
      input.amountMinorUnits,
      input.currency,
      input.status
    ]
  );
  return orderId;
};

const deriveInstructionRouteEvidence = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  sourceAccountOfDigitalAssetId: string,
  destinationAccountOfDigitalAssetId: string
): Promise<Record<string, unknown>> => {
  const sourceRoutes = await deriveLinkedInstrumentSnapshot(client, tenantId, sourceAccountOfDigitalAssetId);
  const destinationRoutes = await deriveLinkedInstrumentSnapshot(client, tenantId, destinationAccountOfDigitalAssetId);
  return {
    sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId,
    sourceLinkedInstruments: sourceRoutes,
    destinationLinkedInstruments: destinationRoutes,
    capturedAt: new Date().toISOString()
  };
};

const deriveLinkedInstrumentSnapshot = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountOfDigitalAssetId: string
): Promise<Array<Record<string, unknown>>> => {
  if (!accountOfDigitalAssetId || !isUuid(accountOfDigitalAssetId)) return [];
  const result = await client.query(
    `select id,
            instrument_type,
            rail_type,
            purpose,
            provider,
            status,
            verification_status,
            network_code,
            metadata,
            created_at
       from linked_instruments
      where platform_tenant_id = $1 and account_of_digital_asset_id = $2
      order by created_at desc
      limit 10`,
    [tenantId, accountOfDigitalAssetId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    instrumentType: row.instrument_type,
    railType: row.rail_type,
    purpose: row.purpose,
    provider: row.provider,
    status: row.status,
    verificationStatus: row.verification_status,
    networkCode: row.network_code,
    metadata: row.metadata ?? {},
    createdAt: toIsoString(row.created_at)
  }));
};

const normalizeCircleWebhookPayload = (
  payload: Record<string, unknown>,
  providerEventId: string,
  eventType: string
): NormalizedCircleWebhookEvent => {
  const payloadRecord = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload as Record<string, unknown>
    : undefined;

  const accountOfDigitalAssetId = optionalStringBody(payload, "accountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "accountOfDigitalAssetId")
    ?? optionalStringBody(payload, "destinationAccountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "destinationAccountOfDigitalAssetId");
  const sourceAccountOfDigitalAssetId = optionalStringBody(payload, "sourceAccountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "sourceAccountOfDigitalAssetId");
  const destinationAccountOfDigitalAssetId = optionalStringBody(payload, "destinationAccountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "destinationAccountOfDigitalAssetId")
    ?? accountOfDigitalAssetId;

  return {
    providerEventId,
    eventType,
    fundingInstructionId: optionalStringBody(payload, "fundingInstructionId")
      ?? optionalStringBody(payloadRecord ?? {}, "fundingInstructionId"),
    providerReferenceId: optionalStringBody(payload, "providerReferenceId")
      ?? optionalStringBody(payloadRecord ?? {}, "providerReferenceId")
      ?? optionalStringBody(payload, "transactionId")
      ?? optionalStringBody(payloadRecord ?? {}, "transactionId"),
    accountOfDigitalAssetId,
    sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId,
    amountMinorUnits: stringBody(payload, "amountMinorUnits", stringBody(payloadRecord ?? {}, "amountMinorUnits", "0")),
    payload
  };
};

const processFundingInstructionWebhookEvent = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  webhookEventId: string,
  event: NormalizedCircleWebhookEvent
): Promise<void> => {
  const instruction = await resolveFundingInstructionForWebhook(client, tenantId, event);
  if (!instruction) {
    await registerOrphanWebhookBreak(client, tenantId, webhookEventId, event, undefined);
    return;
  }

  const amountMinorUnits = asBigInt(event.amountMinorUnits) > 0n
    ? asBigInt(event.amountMinorUnits)
    : asBigInt(instruction.amount_minor_units);
  const amountMinorUnitsString = amountMinorUnits.toString();
  const providerReference = event.providerReferenceId ?? event.providerEventId;
  const instructionRole = String(instruction.instruction_role ?? "client_exchange");

  if (isWireConfirmationEvent(event.eventType) && instructionRole !== "internal_treasury_mint") {
    await markFundingInstructionOrderStatus(
      client,
      tenantId,
      String(instruction.id),
      "ada_wire_transfer",
      "completed",
      providerReference,
      event.payload
    );

    await client.query(
      `update funding_instruction_orders
          set status = 'pending_provider',
              updated_at = now()
        where platform_tenant_id = $1
          and funding_instruction_id = $2
          and dependency_order_id in (
            select id
              from funding_instruction_orders
             where platform_tenant_id = $1
               and funding_instruction_id = $2
               and order_kind = 'ada_wire_transfer'
          )
          and status in ('blocked_dependency', 'pending_dependency')`,
      [tenantId, String(instruction.id)]
    );

    await client.query(
      `update wire_funding_instructions
          set pending_usdc_minor_units = coalesce(pending_usdc_minor_units, 0::numeric) + $3::numeric,
              status = 'pending_usdc_reserved',
              provider_reference_id = coalesce(provider_reference_id, $4),
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [String(instruction.id), tenantId, amountMinorUnitsString, providerReference]
    );
    return;
  }

  const shouldFinalize = isUsdcConfirmationEvent(event.eventType) || instructionRole === "internal_treasury_mint";
  if (!shouldFinalize) return;

  if (instructionRole === "internal_treasury_mint") {
    await markFundingInstructionOrderStatus(
      client,
      tenantId,
      String(instruction.id),
      "internal_mint_ada_transfer",
      "completed",
      providerReference,
      event.payload
    );

    await client.query(
      `update wire_funding_instructions
          set available_usdc_minor_units = coalesce(available_usdc_minor_units, 0::numeric) + $3::numeric,
              status = 'posted_available',
              provider_reference_id = coalesce(provider_reference_id, $4),
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [String(instruction.id), tenantId, amountMinorUnitsString, providerReference]
    );
  } else {
    const wireOrderResult = await client.query(
      `select status
         from funding_instruction_orders
        where platform_tenant_id = $1 and funding_instruction_id = $2 and order_kind = 'ada_wire_transfer'
        limit 1`,
      [tenantId, String(instruction.id)]
    );
    const wireOrderStatus = String(wireOrderResult.rows[0]?.status ?? "");
    if (wireOrderStatus !== "completed") {
      await client.query(
        `update wire_funding_instructions
            set status = 'exception_suspense',
                updated_at = now()
          where id = $1 and platform_tenant_id = $2`,
        [String(instruction.id), tenantId]
      );
      await registerOrphanWebhookBreak(client, tenantId, webhookEventId, event, String(instruction.id));
      return;
    }

    await markFundingInstructionOrderStatus(
      client,
      tenantId,
      String(instruction.id),
      "ada_usdc_transfer",
      "completed",
      providerReference,
      event.payload
    );

    await client.query(
      `update wire_funding_instructions
          set pending_usdc_minor_units = greatest(coalesce(pending_usdc_minor_units, 0::numeric) - $3::numeric, 0::numeric),
              available_usdc_minor_units = coalesce(available_usdc_minor_units, 0::numeric) + $3::numeric,
              status = 'posted_available',
              provider_reference_id = coalesce(provider_reference_id, $4),
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [String(instruction.id), tenantId, amountMinorUnitsString, providerReference]
    );
  }

  const destinationAccountOfDigitalAssetId = typeof instruction.destination_account_of_digital_asset_id === "string"
    ? instruction.destination_account_of_digital_asset_id
    : (typeof instruction.account_of_digital_asset_id === "string" ? instruction.account_of_digital_asset_id : undefined);
  if (destinationAccountOfDigitalAssetId && amountMinorUnits > 0n) {
    const postingResult = await postManualJournal(client, tenantId, {
      ...input,
      idempotencyKey: `${input.idempotencyKey ?? "webhook"}:${event.providerEventId}:posting`,
      body: {
        accountOfDigitalAssetId: destinationAccountOfDigitalAssetId,
        amountMinorUnits: amountMinorUnitsString,
        debitLedgerAccountCode: "10020",
        creditLedgerAccountCode: "20430",
        description: `Funding confirmed from webhook ${event.providerEventId}`
      }
    });
    if (postingResult.status >= 400) {
      throw new Error(`funding_posting_failed:${String((postingResult.body as { error?: unknown }).error ?? postingResult.status)}`);
    }
  }
};

const resolveFundingInstructionForWebhook = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  event: NormalizedCircleWebhookEvent
): Promise<Record<string, unknown> | undefined> => {
  const selectSql = `select id,
                            platform_tenant_id,
                            account_of_digital_asset_id,
                            coalesce(source_account_of_digital_asset_id, account_of_digital_asset_id) as source_account_of_digital_asset_id,
                            coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) as destination_account_of_digital_asset_id,
                            amount_minor_units,
                            pending_usdc_minor_units,
                            available_usdc_minor_units,
                            instruction_role,
                            status
                       from wire_funding_instructions`;

  if (event.fundingInstructionId && isUuid(event.fundingInstructionId)) {
    const result = await client.query(
      `${selectSql}
       where id = $1 and platform_tenant_id = $2
       limit 1`,
      [event.fundingInstructionId, tenantId]
    );
    if (result.rows[0]) return result.rows[0] as Record<string, unknown>;
  }

  if (event.providerReferenceId) {
    const result = await client.query(
      `${selectSql}
       where platform_tenant_id = $1 and provider_reference_id = $2
       order by created_at desc
       limit 1`,
      [tenantId, event.providerReferenceId]
    );
    if (result.rows[0]) return result.rows[0] as Record<string, unknown>;
  }

  const destinationAccountOfDigitalAssetId = event.destinationAccountOfDigitalAssetId ?? event.accountOfDigitalAssetId;
  if (destinationAccountOfDigitalAssetId && isUuid(destinationAccountOfDigitalAssetId)) {
    const result = await client.query(
      `${selectSql}
       where platform_tenant_id = $1
         and coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) = $2
         and status not in ('cancelled', 'failed')
       order by created_at desc
       limit 1`,
      [tenantId, destinationAccountOfDigitalAssetId]
    );
    if (result.rows[0]) return result.rows[0] as Record<string, unknown>;
  }

  return undefined;
};

const isWireConfirmationEvent = (eventType: string): boolean => {
  const normalized = eventType.trim().toLowerCase();
  return normalized.includes("wire")
    && (normalized.includes("confirm") || normalized.includes("complete") || normalized.includes("received") || normalized.includes("credited"));
};

const isUsdcConfirmationEvent = (eventType: string): boolean => {
  const normalized = eventType.trim().toLowerCase();
  if (normalized.includes("usdc") && (normalized.includes("confirm") || normalized.includes("complete") || normalized.includes("credited"))) {
    return true;
  }
  if (normalized.includes("mint") && (normalized.includes("confirm") || normalized.includes("complete"))) return true;
  if (normalized === "funding.confirmed" || normalized === "payment.confirmed") return true;
  return false;
};

const markFundingInstructionOrderStatus = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  fundingInstructionId: string,
  orderKind: string,
  status: string,
  providerReferenceId: string,
  payload: Record<string, unknown>
): Promise<void> => {
  await client.query(
    `update funding_instruction_orders
        set status = $4,
            provider_reference_id = coalesce(provider_reference_id, $5),
            provider_payload_json = coalesce(provider_payload_json, '{}'::jsonb) || $6::jsonb,
            updated_at = now()
      where platform_tenant_id = $1 and funding_instruction_id = $2 and order_kind = $3`,
    [tenantId, fundingInstructionId, orderKind, status, providerReferenceId, JSON.stringify(payload)]
  );
};

const registerOrphanWebhookBreak = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  webhookEventId: string,
  event: NormalizedCircleWebhookEvent,
  fundingInstructionId: string | undefined
): Promise<void> => {
  const amountMinorUnits = asBigInt(event.amountMinorUnits);
  const now = new Date().toISOString();
  const reconciliationRunId = randomUUID();
  await client.query(
    `insert into reconciliation_runs (id, platform_tenant_id, run_type, status, started_at, completed_at)
     values ($1, $2, 'webhook_orphan', 'completed', $3, $3)`,
    [reconciliationRunId, tenantId, now]
  );

  const suspenseCaseId = randomUUID();
  await client.query(
    `insert into suspense_cases
      (id, platform_tenant_id, reason, webhook_event_id, status, note, created_at, updated_at)
     values ($1, $2, 'orphan_circle_transaction', $3, 'open', $4, $5, $5)`,
    [
      suspenseCaseId,
      tenantId,
      webhookEventId,
      fundingInstructionId
        ? `Webhook could not complete workflow for funding instruction ${fundingInstructionId}`
        : `Webhook could not be matched to a funding instruction`,
      now
    ]
  );

  const reconciliationBreakId = randomUUID();
  await client.query(
    `insert into reconciliation_breaks
      (id, platform_tenant_id, reconciliation_run_id, account_of_digital_asset_id, break_type, severity, platform_amount_minor_units, circle_amount_minor_units, delta_minor_units, status, reason, webhook_event_id, suspense_case_id, created_at, updated_at)
     values ($1, $2, $3, $4, 'orphan_webhook_event', 'high', 0, $5::numeric, $5::numeric, 'open', 'orphan_circle_transaction', $6, $7, $8, $8)`,
    [
      reconciliationBreakId,
      tenantId,
      reconciliationRunId,
      asUuidOrNull(event.accountOfDigitalAssetId ?? event.destinationAccountOfDigitalAssetId),
      amountMinorUnits.toString(),
      webhookEventId,
      suspenseCaseId,
      now
    ]
  );

  await client.query(
    `update suspense_cases
        set reconciliation_break_id = $3,
            updated_at = now()
      where id = $1 and platform_tenant_id = $2`,
    [suspenseCaseId, tenantId, reconciliationBreakId]
  );
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
    `select id, platform_tenant_id, legal_name, country, onboarding_status, circle_client_entity_id, circle_application_id, circle_wallet_set_id, created_at
       from business_clients
      where platform_tenant_id = $1
      order by created_at desc`,
    [tenantId]
  );
  return result.rows.map(mapBusinessClientRow);
};

const getBusinessClient = async (client: Pick<PostgresClient, "query">, tenantId: string, businessClientId: string): Promise<{ id: string } | undefined> => {
  const result = await client.query(
    `select id, platform_tenant_id, legal_name, country, onboarding_status, circle_client_entity_id, circle_application_id, circle_wallet_set_id, created_at
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
  const circleWalletSetId = action === "map-circle"
    ? optionalStringBody(input.body, "circleWalletSetId") ?? optionalStringBody(input.body, "walletSetId")
    : undefined;
  await client.query(
    `update business_clients
        set onboarding_status = $3,
            circle_client_entity_id = coalesce($4, circle_client_entity_id),
            circle_application_id = coalesce($5, circle_application_id),
            circle_wallet_set_id = coalesce($6, circle_wallet_set_id),
            updated_at = now()
      where id = $1 and platform_tenant_id = $2`,
    [businessClientId, tenantId, nextStatus, circleClientEntityId, circleApplicationId, circleWalletSetId]
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
    `select id, platform_tenant_id, business_client_id,
            (
              select legal_name
                from business_clients client
               where client.id = accounts_of_digital_asset.business_client_id
                 and client.platform_tenant_id = accounts_of_digital_asset.platform_tenant_id
               limit 1
            ) as business_client_name,
            account_name,
            use_purpose,
            status,
            asset_code,
            asset_rail,
              metadata,
            created_at
       from accounts_of_digital_asset
      where platform_tenant_id = $1
      order by created_at desc`,
    [tenantId]
  );
  return result.rows.map(mapAccountRow);
};

const getAccount = async (client: Pick<PostgresClient, "query">, tenantId: string, accountId: string): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id, platform_tenant_id, business_client_id,
            (
              select legal_name
                from business_clients client
               where client.id = accounts_of_digital_asset.business_client_id
                 and client.platform_tenant_id = accounts_of_digital_asset.platform_tenant_id
               limit 1
            ) as business_client_name,
            account_name,
            use_purpose,
            status,
            asset_code,
            asset_rail,
              metadata,
            created_at
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
            account.use_purpose,
            account.account_name,
            client.id as business_client_id,
            client.onboarding_status,
            client.legal_name as business_client_legal_name
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
    use_purpose?: string;
    account_name?: string;
    business_client_id: string;
    onboarding_status: string;
    business_client_legal_name?: string;
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
    `select account.id, account.status, account.business_client_id, account.use_purpose, client.onboarding_status, client.circle_wallet_set_id, client.legal_name
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
    circle_wallet_set_id?: string;
    legal_name?: string;
  } | undefined;
  if (!account) return { status: 404, body: { error: "account_not_found" } };
  if (account.onboarding_status !== "approved") return { status: 400, body: { error: "business_client_not_approved" } };
  if (["restricted", "frozen", "closed"].includes(account.status)) return { status: 400, body: { error: "account_status_blocks_circle_provisioning" } };

  const requestWalletSetId = optionalStringBody(input.body, "walletSetId");
  const businessClientWalletSetId = typeof account.circle_wallet_set_id === "string" ? account.circle_wallet_set_id : undefined;
  const requestedWalletBlockchains = stringArrayBody(input.body, "walletBlockchains", circleWalletBlockchainsFromEnv());
  const requestedWalletBlockchain = requestedWalletBlockchains[0];
  const expectedExistingWalletSetId = requestWalletSetId ?? businessClientWalletSetId;

  const existingInstrument = await client.query(
    `select id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at
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
  const existingInstrumentWalletSetId = existingRow ? walletSetIdFromLinkedInstrument(existingRow) : undefined;
  const existingInstrumentMatchesWalletSet = expectedExistingWalletSetId
    ? existingInstrumentWalletSetId === expectedExistingWalletSetId
    : false;
  if (existingRow && existingInstrumentMatchesWalletSet) {
    const operation = await client.query(
      `select id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at
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

  const existingSuccessful = await client.query(
    `select id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at
       from circle_api_operations
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
        and operation_type = 'ada_circle_mapping'
        and status = 'succeeded'
      order by created_at desc
      limit 1`,
    [tenantId, accountId]
  );
  const successfulRow = existingSuccessful.rows[0] as Record<string, unknown> | undefined;
  const successfulWalletSetId = typeof successfulRow?.provider_account_id === "string" ? successfulRow.provider_account_id : undefined;
  const successfulRowMatchesWalletSet = expectedExistingWalletSetId
    ? successfulWalletSetId === expectedExistingWalletSetId
    : false;
  if (successfulRow && successfulRowMatchesWalletSet) {
    const providerWalletId = typeof successfulRow.provider_wallet_id === "string" && successfulRow.provider_wallet_id.trim()
      ? successfulRow.provider_wallet_id
      : undefined;
    const providerAddressId = typeof successfulRow.provider_address_id === "string" && successfulRow.provider_address_id.trim()
      ? successfulRow.provider_address_id
      : undefined;

    if (providerWalletId) {
      const recoveredWalletSetId = businessClientWalletSetId
        ?? (typeof successfulRow.provider_account_id === "string" ? successfulRow.provider_account_id : undefined);
      const linkedInstrumentId = randomUUID();
      const recoveredInstrumentResult = await client.query(
        `insert into linked_instruments
          (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
         values ($1, $2, $3, 'circle_wallet', 'active', $4, 'on-chain', $5, 'circle', 'verified', $6::jsonb, $7, true, now(), now())
         returning id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at`,
        [
          linkedInstrumentId,
          accountId,
          tenantId,
          providerWalletId,
          account.use_purpose,
          JSON.stringify({
            walletSetId: recoveredWalletSetId,
            walletId: providerWalletId,
            address: providerAddressId,
            blockchain: requestedWalletBlockchain,
            recoveredExistingWallet: true,
            recoveredFromCircleOperationId: successfulRow.id
          }),
          requestedWalletBlockchain
        ]
      );
      await client.query(
        `update circle_api_operations set linked_instrument_id = $2 where id = $1 and linked_instrument_id is null`,
        [successfulRow.id, linkedInstrumentId]
      );
      await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.circle_mapping.recovered", {
        accountOfDigitalAssetId: accountId,
        businessClientId: account.business_client_id,
        circleOperationId: successfulRow.id,
        providerWalletId,
        providerAddressId,
        linkedInstrumentId
      });
      return {
        status: 200,
        body: {
          account: await getAccount(client, tenantId, accountId),
          linkedInstrument: mapLinkedInstrumentRow(recoveredInstrumentResult.rows[0] as Record<string, unknown>),
          circleOperation: mapCircleOperationRow(successfulRow),
          reusedExistingMapping: true
        }
      };
    }

    return {
      status: 200,
      body: {
        account: await getAccount(client, tenantId, accountId),
        circleOperation: mapCircleOperationRow(successfulRow),
        reusedExistingMapping: true
      }
    };
  }

  const existing = await client.query(
    `select id, operation_type, provider_account_id, provider_wallet_id, provider_address_id, status, request_payload, response_payload, created_at
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

  let effectiveWalletSetId = requestWalletSetId ?? businessClientWalletSetId;
  if (!effectiveWalletSetId) {
    const walletSetName = `${account.legal_name ?? "Business Client"} Wallet Set`;
    const walletSet = await initializeCircleWalletSet({
      idempotencyKey: input.idempotencyKey,
      walletSetName,
      walletBlockchains: requestedWalletBlockchains
    });
    if (walletSet.status !== "complete" || !walletSet.walletSetId) {
      const operationId = randomUUID();
      const responsePayload = {
        walletSet,
        authDebug: walletSet.responsePayload.authDebug,
        provider: walletSet.responsePayload
      };
      await client.query(
        `insert into circle_api_operations
          (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, account_of_digital_asset_id, business_client_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at)
         values ($1, $2, 'ada_circle_mapping', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, 'failed', $12, now())`,
        [
          operationId,
          tenantId,
          input.idempotencyKey,
          input.correlationId,
          accountId,
          account.business_client_id,
          JSON.stringify({ accountOfDigitalAssetId: accountId, provider: "circle", walletSetName, walletBlockchains: requestedWalletBlockchains }),
          JSON.stringify(responsePayload),
          undefined,
          undefined,
          undefined,
          walletSet.errorCode
        ]
      );
      await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.circle_mapping.failed", {
        accountOfDigitalAssetId: accountId,
        businessClientId: account.business_client_id,
        circleOperationId: operationId,
        errorCode: walletSet.errorCode
      });
      const status = walletSet.errorCode === "circle_api_key_required"
        || walletSet.errorCode === "circle_wallet_configuration_required"
        || walletSet.errorCode === "circle_fiat_mint_endpoint_not_configured"
        ? 400
        : 502;
      return {
        status,
        body: {
          error: walletSet.errorCode ?? "circle_provider_unavailable",
          detail: tenantActivationFailureDetail(walletSet.responsePayload),
          authDebug: walletSet.responsePayload.authDebug,
          walletSet,
          circleOperation: await getCircleOperation(client, tenantId, operationId)
        }
      };
    }
    effectiveWalletSetId = walletSet.walletSetId;
    await client.query(
      `update business_clients
          set circle_wallet_set_id = $3,
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [account.business_client_id, tenantId, effectiveWalletSetId]
    );
    await writeAuditAndOutbox(client, tenantId, input, "business_client.circle_wallet_set.provisioned", {
      businessClientId: account.business_client_id,
      walletSetId: effectiveWalletSetId,
      walletSetName,
      walletBlockchains: requestedWalletBlockchains
    });
  }

  if (!effectiveWalletSetId) {
    return { status: 502, body: { error: "circle_wallet_configuration_required", detail: "walletSetId missing after business client wallet set provisioning" } };
  }

  const mappingPayload = { ...input.body };
  delete mappingPayload.wireAccount;
  delete mappingPayload.wireFunding;

  const provider = await provisionAdaCircleMapping({
    tenantId,
    accountOfDigitalAssetId: accountId,
    businessClientId: account.business_client_id,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    walletSetId: effectiveWalletSetId,
    walletBlockchains: requestedWalletBlockchains,
    payload: mappingPayload
  });

  const needsSandboxWireSetup = circleEnvironment() === "circle-sandbox";
  const sandboxWireSetup = provider.status === "complete" && needsSandboxWireSetup
    ? await provisionSandboxWireFundingInstructions({
        tenantId,
        accountOfDigitalAssetId: accountId,
        businessClientId: account.business_client_id,
        idempotencyKey: input.idempotencyKey,
        payload: input.body
      })
    : undefined;

  const provisioningStatus = provider.status === "complete" && (sandboxWireSetup?.status ?? "complete") === "complete"
    ? "complete"
    : "failed";
  const provisioningErrorCode = provider.status === "complete"
    ? sandboxWireSetup?.errorCode
    : provider.errorCode;
  const failedProviderPayload = provider.status === "complete"
    ? sandboxWireSetup?.responsePayload
    : provider.responsePayload;

  const providerAccountId = provider.providerAccountId ?? provider.providerWalletId ?? provider.providerRequestId;
  const providerWalletId = provider.providerWalletId ?? provider.providerAccountId ?? provider.providerRequestId;
  const providerAddressId = provider.providerAddressId;
  const operationId = randomUUID();
  const failedAuthDebug = failedProviderPayload && typeof failedProviderPayload === "object"
    ? (failedProviderPayload as Record<string, unknown>).authDebug
    : undefined;
  const responsePayload = {
    providerAccountId,
    providerWalletId,
    providerAddressId,
    providerRequestId: provider.providerRequestId,
    status: provisioningStatus,
    errorCode: provisioningErrorCode,
    authDebug: failedAuthDebug,
    provider: provider.responsePayload,
    wireSetup: sandboxWireSetup?.responsePayload
  };
  await client.query(
    `insert into circle_api_operations
      (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, account_of_digital_asset_id, business_client_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at)
     values ($1, $2, 'ada_circle_mapping', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, now())`,
    [
      operationId,
      tenantId,
      input.idempotencyKey,
      input.correlationId,
      accountId,
      account.business_client_id,
      JSON.stringify({ accountOfDigitalAssetId: accountId, provider: "circle", walletSetId: effectiveWalletSetId, walletBlockchains: requestedWalletBlockchains }),
      JSON.stringify(responsePayload),
      providerAccountId,
      providerWalletId,
      providerAddressId,
      provisioningStatus === "complete" ? "succeeded" : "failed",
      provisioningErrorCode
    ]
  );
  if (provisioningStatus !== "complete") {
    await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.circle_mapping.failed", {
      accountOfDigitalAssetId: accountId,
      businessClientId: account.business_client_id,
      circleOperationId: operationId,
      errorCode: provisioningErrorCode
    });
    const status = provisioningErrorCode === "circle_api_key_required"
      || provisioningErrorCode === "circle_wallet_configuration_required"
      || provisioningErrorCode === "circle_auth_failed"
      || provisioningErrorCode === "circle_validation_failed"
      || provisioningErrorCode === "circle_fiat_mint_endpoint_not_configured"
      ? 400
      : 502;
    return {
      status,
      body: {
        error: provisioningErrorCode ?? "circle_provider_unavailable",
        detail: failedProviderPayload ? tenantActivationFailureDetail(failedProviderPayload as Record<string, unknown>) : undefined,
        authDebug: failedAuthDebug,
        circleOperation: await getCircleOperation(client, tenantId, operationId)
      }
    };
  }

  const wireSetupPayload = sandboxWireSetup?.responsePayload && typeof sandboxWireSetup.responsePayload === "object"
    ? sandboxWireSetup.responsePayload as Record<string, unknown>
    : undefined;
  const wireTrackingRef = typeof wireSetupPayload?.trackingRef === "string"
    ? wireSetupPayload.trackingRef
    : undefined;
  const wireBeneficiaryBankAccountNumber = typeof wireSetupPayload?.beneficiaryBankAccountNumber === "string"
    ? wireSetupPayload.beneficiaryBankAccountNumber
    : undefined;
  const providerWireAccountId = typeof wireSetupPayload?.wireAccountId === "string"
    ? wireSetupPayload.wireAccountId
    : undefined;
  const businessWireAccountId = typeof wireSetupPayload?.businessWireAccountId === "string"
    ? wireSetupPayload.businessWireAccountId
    : providerWireAccountId;
  const wireInstructions = wireSetupPayload?.wireInstructions && typeof wireSetupPayload.wireInstructions === "object"
    ? wireSetupPayload.wireInstructions
    : undefined;
  const linkedInstrumentMetadata = {
    walletSetId: effectiveWalletSetId,
    walletId: providerWalletId,
    address: providerAddressId,
    blockchain: requestedWalletBlockchain,
    providerRequestId: provider.providerRequestId,
    circleOperationId: operationId,
    ...(businessWireAccountId ? { businessWireAccountId } : {}),
    ...(wireTrackingRef ? { trackingRef: wireTrackingRef, wireTrackingRef } : {}),
    ...(wireBeneficiaryBankAccountNumber ? { beneficiaryBankAccountNumber: wireBeneficiaryBankAccountNumber } : {}),
    ...(wireInstructions ? { wireInstructions } : {})
  };
  const instrumentResult = await client.query(
    `insert into linked_instruments
      (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
     values ($1, $2, $3, 'circle_wallet', 'active', $4, 'on-chain', $5, 'circle', 'verified', $6::jsonb, $7, true, now(), now())
     returning id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at`,
    [
      randomUUID(),
      accountId,
      tenantId,
      providerWalletId,
      account.use_purpose,
      JSON.stringify(linkedInstrumentMetadata),
      requestedWalletBlockchain
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
  const existingIntegration = await getTenantCircleIntegrationRow(client, tenantId);
  const existingWalletSetId = typeof existingIntegration?.wallet_set_id === "string" && existingIntegration.wallet_set_id.trim()
    ? existingIntegration.wallet_set_id
    : undefined;
  const existingWalletSetName = typeof existingIntegration?.wallet_set_name === "string" && existingIntegration.wallet_set_name.trim()
    ? existingIntegration.wallet_set_name
    : undefined;
  const existingWalletBlockchains = existingIntegration ? walletBlockchainsFromRow(existingIntegration) : [];

  const walletSetName = stringBody(
    input.body,
    "walletSetName",
    existingWalletSetName ?? `${tenant?.tenant_name ?? "Demo Tenant"} Wallet Set`
  );
  const walletBlockchains = stringArrayBody(
    input.body,
    "walletBlockchains",
    existingWalletBlockchains.length ? existingWalletBlockchains : circleWalletBlockchainsFromEnv()
  );
  const walletBlockchainForStorage = walletBlockchains[0] ?? defaultCircleBlockchainByEnvironment();
  const walletStrategy = stringBody(input.body, "walletStrategy", "omnibus_custodial_set");
  const requestedWalletSetId = optionalStringBody(input.body, "walletSetId");
  const attachedWalletSetId = requestedWalletSetId ?? existingWalletSetId;
  const environment = circleEnvironment();
  const existingMetadata = existingIntegration?.metadata && typeof existingIntegration.metadata === "object"
    ? existingIntegration.metadata as Record<string, unknown>
    : {};
  const existingResponsePayload = existingMetadata.responsePayload && typeof existingMetadata.responsePayload === "object"
    ? existingMetadata.responsePayload as Record<string, unknown>
    : {};
  const existingTenantWallet = existingResponsePayload.tenantWallet && typeof existingResponsePayload.tenantWallet === "object"
    ? existingResponsePayload.tenantWallet as Record<string, unknown>
    : undefined;
  const existingTenantWalletId = typeof existingTenantWallet?.walletId === "string" ? existingTenantWallet.walletId : undefined;
  const existingTenantWalletAddress = typeof existingTenantWallet?.address === "string" ? existingTenantWallet.address : undefined;
  const existingTenantWalletRequestId = typeof existingTenantWallet?.providerRequestId === "string" ? existingTenantWallet.providerRequestId : undefined;

  const walletSet = attachedWalletSetId
    ? {
        environment,
        walletSetId: attachedWalletSetId,
        walletSetName,
        walletBlockchains,
        status: "complete" as const,
        responsePayload: {
          accepted: true,
          attachedExistingWalletSet: true,
          reusedStoredWalletSet: !requestedWalletSetId && Boolean(existingWalletSetId)
        }
      }
    : await initializeCircleWalletSet({
        idempotencyKey: input.idempotencyKey,
        walletSetName,
        walletBlockchains
      });

  const shouldReuseTenantWallet =
    walletSet.status === "complete"
    && walletSet.walletSetId
    && existingWalletSetId
    && existingWalletSetId === walletSet.walletSetId
    && Boolean(existingTenantWalletId);

  const tenantWallet = walletSet.status !== "complete" || !walletSet.walletSetId
    ? undefined
    : shouldReuseTenantWallet
      ? {
          providerAccountId: walletSet.walletSetId,
          providerWalletId: existingTenantWalletId,
          providerAddressId: existingTenantWalletAddress,
          providerRequestId: existingTenantWalletRequestId,
          status: "complete" as const,
          errorCode: undefined,
          responsePayload: {
            accepted: true,
            attachedExistingTenantWallet: true,
            reusedStoredTenantWallet: true
          }
        }
      : await initializeTenantCircleWallet({
          tenantId,
          walletSetId: walletSet.walletSetId,
          walletSetName,
          walletBlockchains,
          idempotencyKey: input.idempotencyKey
        });

  const integrationId = randomUUID();
  const activationErrorCode = walletSet.status !== "complete"
    ? walletSet.errorCode
    : tenantWallet && tenantWallet.status !== "complete"
      ? tenantWallet.errorCode
      : undefined;
  const status = activationErrorCode ? "failed" : "active";
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
          walletBlockchains,
          tenantWallet: tenantWallet
            ? {
                walletSetId: walletSet.walletSetId,
              walletId: tenantWallet.providerWalletId ?? tenantWallet.providerAccountId ?? tenantWallet.providerRequestId,
                address: tenantWallet.providerAddressId,
                providerRequestId: tenantWallet.providerRequestId,
                status: tenantWallet.status,
                errorCode: tenantWallet.errorCode,
                provider: tenantWallet.responsePayload
              }
            : undefined
        },
        errorCode: activationErrorCode
      })
    ]
  );

  await writeAuditAndOutbox(client, tenantId, input, status === "active" ? "platform_tenant.circle_wallet_set.activated" : "platform_tenant.circle_wallet_set.activation_failed", {
    walletSetId: walletSet.walletSetId,
    walletSetName,
    walletBlockchains,
    walletStrategy,
    environment: walletSet.environment,
    tenantWalletId: tenantWallet?.providerWalletId ?? tenantWallet?.providerAccountId ?? tenantWallet?.providerRequestId,
    tenantWalletAddress: tenantWallet?.providerAddressId,
    errorCode: activationErrorCode
  });

  if (status === "active") {
    const tenantInternalBusinessClientId = await ensureTenantPseudoBusinessClient(client, tenantId, input);
    await ensureTenantCentralAdaAccount(client, tenantId, input, tenantInternalBusinessClientId);
  }

  const body = await getTenantActivation(client, tenantId);
  return {
    status: 200,
    body: {
      ...body as Record<string, unknown>,
      activationAccepted: status === "active",
      error: status === "active" ? undefined : activationErrorCode,
      detail: status === "active"
        ? undefined
        : tenantActivationFailureDetail(
            tenantWallet && tenantWallet.status !== "complete"
              ? tenantWallet.responsePayload
              : walletSet.responsePayload
          ),
      walletSet,
      tenantWallet
    }
  };
};

const ensureTenantCentralAdaAccount = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  input: Sprint1PostgresCommandInput,
  businessClientId: string
): Promise<string> => {
  const usePurpose = "tenant_central";
  const existing = await client.query(
    `select id, business_client_id, status, account_name
       from accounts_of_digital_asset
      where platform_tenant_id = $1
        and use_purpose = $2
      order by created_at asc
      limit 1`,
    [tenantId, usePurpose]
  );
  const existingRow = existing.rows[0] as Record<string, unknown> | undefined;
  if (existingRow && typeof existingRow.id === "string") {
    const existingId = existingRow.id;
    const linkedBusinessClientId = typeof existingRow.business_client_id === "string" ? existingRow.business_client_id : undefined;
    const currentStatus = typeof existingRow.status === "string" ? existingRow.status : undefined;
    const currentName = typeof existingRow.account_name === "string" ? existingRow.account_name : undefined;
    const needsRelink = linkedBusinessClientId !== businessClientId;
    const needsNameReset = currentName !== "Tenant ADA (central)";
    const needsStatusReset = currentStatus !== "active";
    if (needsRelink || needsNameReset || needsStatusReset) {
      await client.query(
        `update accounts_of_digital_asset
            set business_client_id = $3,
                account_name = 'Tenant ADA (central)',
                status = 'active',
                updated_at = now()
          where id = $1 and platform_tenant_id = $2`,
        [existingId, tenantId, businessClientId]
      );
      await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.tenant_central.linked", {
        accountOfDigitalAssetId: existingId,
        businessClientId,
        usePurpose,
        status: "active"
      });
    }
    return existingId;
  }

  const accountId = randomUUID();
  const createdAt = new Date().toISOString();
  await client.query(
    `insert into accounts_of_digital_asset
      (id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, correlation_id, created_at, updated_at)
     values ($1, $2, $3, 'Tenant ADA (central)', $4, 'active', 'USDC', 'circle_internal', $5, $6, $6)`,
    [accountId, tenantId, businessClientId, usePurpose, input.correlationId, createdAt]
  );
  await writeAuditAndOutbox(client, tenantId, input, "account_of_digital_asset.tenant_central.created", {
    accountOfDigitalAssetId: accountId,
    businessClientId,
    usePurpose,
    status: "active"
  });
  return accountId;
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
      (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_account_id, status, error_code, created_at)
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

const getAccountBalanceProjection = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountId: string
): Promise<unknown> => {
  const result = await client.query(
    `select account_of_digital_asset_id, asset_code, currency, available_minor_units, pending_minor_units, reserved_minor_units, locked_minor_units, suspense_minor_units, version, projected_at, updated_at
       from account_of_digital_asset_balances
      where platform_tenant_id = $1 and account_of_digital_asset_id = $2
      order by updated_at desc`,
    [tenantId, accountId]
  );

  const balances = result.rows.map((row) => ({
    accountId: row.account_of_digital_asset_id,
    assetCode: row.asset_code,
    currency: row.currency,
    availableMinorUnits: String(row.available_minor_units ?? 0),
    pendingMinorUnits: String(row.pending_minor_units ?? 0),
    reservedMinorUnits: String(row.reserved_minor_units ?? 0),
    lockedMinorUnits: String(row.locked_minor_units ?? 0),
    suspenseMinorUnits: String(row.suspense_minor_units ?? 0),
    version: Number(row.version ?? 1),
    projectedAt: toIsoString(row.projected_at),
    updatedAt: toIsoString(row.updated_at)
  }));

  return {
    accountId,
    balances,
    source: "account_of_digital_asset_balances"
  };
};

const listLedgerJournals = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select entry.id,
            entry.description,
            entry.accounting_event_type,
            entry.reversal_of_journal_entry_id,
            entry.correlation_id,
            entry.idempotency_key,
            entry.posted_at,
            coalesce(sum(line.debit_minor_units), 0) as total_debit_minor_units,
            coalesce(sum(line.credit_minor_units), 0) as total_credit_minor_units
       from treasury_journal_entries entry
       left join treasury_journal_lines line on line.journal_entry_id = entry.id
      where entry.platform_tenant_id = $1
      group by entry.id
      order by entry.posted_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    description: row.description,
    eventType: row.accounting_event_type,
    reversalOfJournalEntryId: row.reversal_of_journal_entry_id ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    postedAt: toIsoString(row.posted_at),
    totalDebitMinorUnits: String(row.total_debit_minor_units ?? 0),
    totalCreditMinorUnits: String(row.total_credit_minor_units ?? 0)
  }));
};

const getLedgerJournal = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  journalId: string
): Promise<unknown | undefined> => {
  const entryResult = await client.query(
    `select id, description, accounting_event_type, reversal_of_journal_entry_id, correlation_id, idempotency_key, posted_at
       from treasury_journal_entries
      where id = $1 and platform_tenant_id = $2`,
    [journalId, tenantId]
  );
  const entry = entryResult.rows[0] as Record<string, unknown> | undefined;
  if (!entry) return undefined;

  const linesResult = await client.query(
    `select line.id,
            line.account_of_digital_asset_id,
            line.asset_code,
            line.currency,
            line.debit_minor_units,
            line.credit_minor_units,
            ledger.account_code,
            ledger.account_name
       from treasury_journal_lines line
       join ledger_accounts ledger on ledger.id = line.ledger_account_id
      where line.journal_entry_id = $1
      order by line.created_at asc`,
    [journalId]
  );

  return {
    id: entry.id,
    description: entry.description,
    eventType: entry.accounting_event_type,
    reversalOfJournalEntryId: entry.reversal_of_journal_entry_id ?? undefined,
    correlationId: entry.correlation_id ?? undefined,
    idempotencyKey: entry.idempotency_key ?? undefined,
    postedAt: toIsoString(entry.posted_at),
    lines: linesResult.rows.map((line) => ({
      id: line.id,
      accountOfDigitalAssetId: line.account_of_digital_asset_id ?? undefined,
      ledgerAccountCode: line.account_code,
      ledgerAccountName: line.account_name,
      assetCode: line.asset_code,
      currency: line.currency,
      debitMinorUnits: String(line.debit_minor_units ?? 0),
      creditMinorUnits: String(line.credit_minor_units ?? 0)
    }))
  };
};

const listBalanceProjectionRuns = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id, account_of_digital_asset_id, status, started_at, completed_at, source_journal_count
       from balance_projection_runs
      where platform_tenant_id = $1
      order by started_at desc
      limit 100`,
    [tenantId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    accountId: row.account_of_digital_asset_id ?? undefined,
    status: row.status,
    startedAt: toIsoString(row.started_at),
    completedAt: toIsoString(row.completed_at),
    sourceJournalCount: Number(row.source_journal_count ?? 0)
  }));
};

const getTrialBalanceReport = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown> => {
  const result = await client.query(
    `select ledger.account_code,
            ledger.account_name,
            coalesce(sum(case when entry.platform_tenant_id = $1 then line.debit_minor_units else 0 end), 0) as total_debit_minor_units,
            coalesce(sum(case when entry.platform_tenant_id = $1 then line.credit_minor_units else 0 end), 0) as total_credit_minor_units
       from ledger_accounts ledger
       left join treasury_journal_lines line on line.ledger_account_id = ledger.id
       left join treasury_journal_entries entry on entry.id = line.journal_entry_id
      group by ledger.account_code, ledger.account_name
      order by ledger.account_code`,
    [tenantId]
  );

  let totalDebitMinorUnits = 0n;
  let totalCreditMinorUnits = 0n;
  const lines = result.rows.map((row) => {
    const debit = asBigInt(row.total_debit_minor_units);
    const credit = asBigInt(row.total_credit_minor_units);
    totalDebitMinorUnits += debit;
    totalCreditMinorUnits += credit;
    return {
      accountCode: row.account_code,
      accountName: row.account_name,
      totalDebitMinorUnits: debit.toString(),
      totalCreditMinorUnits: credit.toString(),
      netMinorUnits: (debit - credit).toString()
    };
  });

  return {
    lines,
    totalDebitMinorUnits: totalDebitMinorUnits.toString(),
    totalCreditMinorUnits: totalCreditMinorUnits.toString(),
    balanced: totalDebitMinorUnits === totalCreditMinorUnits
  };
};

const getCustomerLiabilityControlReport = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown> => {
  const liabilityResult = await client.query(
    `select coalesce(sum(line.credit_minor_units - line.debit_minor_units), 0) as control_minor_units
       from treasury_journal_lines line
       join ledger_accounts ledger on ledger.id = line.ledger_account_id
       join treasury_journal_entries entry on entry.id = line.journal_entry_id
      where entry.platform_tenant_id = $1
        and ledger.account_code in ('20430', '20440', '20500', '20510', '20520')`,
    [tenantId]
  );

  const subledgerResult = await client.query(
    `select coalesce(sum(available_minor_units + pending_minor_units + reserved_minor_units + locked_minor_units + suspense_minor_units), 0) as subledger_minor_units
       from account_of_digital_asset_balances
      where platform_tenant_id = $1`,
    [tenantId]
  );

  const controlMinorUnits = asBigInt(liabilityResult.rows[0]?.control_minor_units);
  const subledgerMinorUnits = asBigInt(subledgerResult.rows[0]?.subledger_minor_units);
  return {
    customerLiabilityMinorUnits: controlMinorUnits.toString(),
    adaSubledgerMinorUnits: subledgerMinorUnits.toString(),
    deltaMinorUnits: (controlMinorUnits - subledgerMinorUnits).toString(),
    balanced: controlMinorUnits === subledgerMinorUnits
  };
};

const listFundingInstructions = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id,
            coalesce(source_account_of_digital_asset_id, account_of_digital_asset_id) as source_account_of_digital_asset_id,
            coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) as destination_account_of_digital_asset_id,
            coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) as account_of_digital_asset_id,
            business_client_id,
            coalesce(funding_type, 'wire') as funding_type,
            instruction_role,
            transfer_kind,
            coalesce(asset_code, 'USDC') as asset_code,
            coalesce(currency, 'USD') as currency,
            coalesce(amount_minor_units, 0::numeric) as amount_minor_units,
            coalesce(pending_usdc_minor_units, 0::numeric) as pending_usdc_minor_units,
            coalesce(available_usdc_minor_units, 0::numeric) as available_usdc_minor_units,
            status,
            coalesce(provider, bank_name, 'circle') as provider,
            provider_reference_id,
            idempotency_key,
            correlation_id,
            route_evidence_json,
            coalesce(requested_at, created_at) as created_at,
            coalesce(updated_at, created_at) as updated_at
       from wire_funding_instructions
      where platform_tenant_id = $1
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map(mapFundingInstructionRow);
};

const getFundingInstruction = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  fundingInstructionId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id,
            coalesce(source_account_of_digital_asset_id, account_of_digital_asset_id) as source_account_of_digital_asset_id,
            coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) as destination_account_of_digital_asset_id,
            coalesce(destination_account_of_digital_asset_id, account_of_digital_asset_id) as account_of_digital_asset_id,
            business_client_id,
            coalesce(funding_type, 'wire') as funding_type,
            instruction_role,
            transfer_kind,
            coalesce(asset_code, 'USDC') as asset_code,
            coalesce(currency, 'USD') as currency,
            coalesce(amount_minor_units, 0::numeric) as amount_minor_units,
            coalesce(pending_usdc_minor_units, 0::numeric) as pending_usdc_minor_units,
            coalesce(available_usdc_minor_units, 0::numeric) as available_usdc_minor_units,
            status,
            coalesce(provider, bank_name, 'circle') as provider,
            provider_reference_id,
            idempotency_key,
            correlation_id,
            route_evidence_json,
            coalesce(requested_at, created_at) as created_at,
            coalesce(updated_at, created_at) as updated_at
       from wire_funding_instructions
      where id = $1 and platform_tenant_id = $2`,
    [fundingInstructionId, tenantId]
  );
  const row = result.rows[0];
  return row ? mapFundingInstructionRow(row) : undefined;
};

const listFundingInstructionOrders = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  fundingInstructionId: string
): Promise<unknown[]> => {
  const result = await client.query(
    `select id,
            funding_instruction_id,
            order_kind,
            dependency_order_id,
            source_account_of_digital_asset_id,
            destination_account_of_digital_asset_id,
            amount_minor_units,
            currency,
            status,
            provider_reference_id,
            provider_payload_json,
            created_at,
            updated_at
       from funding_instruction_orders
      where platform_tenant_id = $1 and funding_instruction_id = $2
      order by created_at asc`,
    [tenantId, fundingInstructionId]
  );
  return result.rows.map(mapFundingInstructionOrderRow);
};

const listFundingReservations = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string
): Promise<unknown[]> => {
  const result = await client.query(
    `select id,
            platform_tenant_id,
            settlement_obligation_id,
            account_of_digital_asset_id,
            amount_minor_units,
            status,
            created_at
       from funding_reservations
      where platform_tenant_id = $1
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map(mapFundingReservationRow);
};

const getFundingReservation = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  reservationId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id,
            platform_tenant_id,
            settlement_obligation_id,
            account_of_digital_asset_id,
            amount_minor_units,
            status,
            created_at
       from funding_reservations
      where id = $1 and platform_tenant_id = $2`,
    [reservationId, tenantId]
  );
  const row = result.rows[0];
  return row ? mapFundingReservationRow(row) : undefined;
};

const listPayments = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string
): Promise<unknown[]> => {
  const internal = await client.query(
    `select payment.id,
            payment.platform_tenant_id,
            payment.source_account_of_digital_asset_id,
            payment.destination_account_of_digital_asset_id,
            null::text as recipient_address,
            payment.amount_minor_units,
            payment.status,
            coalesce(execution.provider_transfer_id, null) as provider_transfer_id,
            payment.idempotency_key,
            payment.created_at,
            'internal'::text as payment_type
       from payment_instructions payment
       left join lateral (
         select provider_transfer_id
           from internal_transfer_executions
          where payment_instruction_id = payment.id and platform_tenant_id = payment.platform_tenant_id
          order by created_at desc
          limit 1
       ) execution on true
      where payment.platform_tenant_id = $1`,
    [tenantId]
  );
  const external = await client.query(
    `select payment.id,
            payment.platform_tenant_id,
            payment.source_account_of_digital_asset_id,
            null::uuid as destination_account_of_digital_asset_id,
            recipient.address as recipient_address,
            payment.amount_minor_units,
            payment.status,
            payment.provider_transfer_id,
            payment.idempotency_key,
            payment.created_at,
            'external_usdc'::text as payment_type
       from external_payment_executions payment
       join external_recipients recipient on recipient.id = payment.external_recipient_id
      where payment.platform_tenant_id = $1`,
    [tenantId]
  );

  return [...internal.rows, ...external.rows]
    .map(mapPaymentRow)
    .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
};

const getPayment = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  paymentId: string
): Promise<unknown | undefined> => {
  const internal = await client.query(
    `select payment.id,
            payment.platform_tenant_id,
            payment.source_account_of_digital_asset_id,
            payment.destination_account_of_digital_asset_id,
            null::text as recipient_address,
            payment.amount_minor_units,
            payment.status,
            coalesce(execution.provider_transfer_id, null) as provider_transfer_id,
            payment.idempotency_key,
            payment.created_at,
            'internal'::text as payment_type
       from payment_instructions payment
       left join lateral (
         select provider_transfer_id
           from internal_transfer_executions
          where payment_instruction_id = payment.id and platform_tenant_id = payment.platform_tenant_id
          order by created_at desc
          limit 1
       ) execution on true
      where payment.id = $1 and payment.platform_tenant_id = $2`,
    [paymentId, tenantId]
  );
  if (internal.rows[0]) return mapPaymentRow(internal.rows[0] as Record<string, unknown>);

  const external = await client.query(
    `select payment.id,
            payment.platform_tenant_id,
            payment.source_account_of_digital_asset_id,
            null::uuid as destination_account_of_digital_asset_id,
            recipient.address as recipient_address,
            payment.amount_minor_units,
            payment.status,
            payment.provider_transfer_id,
            payment.idempotency_key,
            payment.created_at,
            'external_usdc'::text as payment_type
       from external_payment_executions payment
       join external_recipients recipient on recipient.id = payment.external_recipient_id
      where payment.id = $1 and payment.platform_tenant_id = $2`,
    [paymentId, tenantId]
  );
  if (external.rows[0]) return mapPaymentRow(external.rows[0] as Record<string, unknown>);
  return undefined;
};

const listFiatRedemptions = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string
): Promise<unknown[]> => {
  const result = await client.query(
    `select id,
            platform_tenant_id,
            source_account_of_digital_asset_id,
            linked_instrument_id,
            amount_minor_units,
            status,
            provider_withdrawal_id,
            created_at
       from redemption_instructions
      where platform_tenant_id = $1
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map(mapFiatRedemptionRow);
};

const getFiatRedemption = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  redemptionId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id,
            platform_tenant_id,
            source_account_of_digital_asset_id,
            linked_instrument_id,
            amount_minor_units,
            status,
            provider_withdrawal_id,
            created_at
       from redemption_instructions
      where id = $1 and platform_tenant_id = $2`,
    [redemptionId, tenantId]
  );
  const row = result.rows[0];
  return row ? mapFiatRedemptionRow(row) : undefined;
};

const listFiatWireAccounts = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string
): Promise<unknown[]> => {
  const result = await client.query(
    `select linked.id,
            account.business_client_id,
            coalesce(rail.rail_name, linked.instrument_type) as bank_name,
            coalesce(linked.metadata->>'accountNumberLast4', '----') as account_number_last4,
            coalesce(linked.network_code, linked.metadata->>'routingNumber') as routing_number,
            coalesce(linked.metadata->>'businessWireAccountId', linked.metadata->>'wireAccountId') as business_wire_account_id,
            linked.status,
            linked.account_of_digital_asset_id,
            linked.created_at
       from linked_instruments linked
       join accounts_of_digital_asset account
         on account.id = linked.account_of_digital_asset_id
      left join asset_rails rail
         on rail.rail_code = linked.network_code
      where linked.platform_tenant_id = $1
        and linked.rail_type = 'fiat'
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map(mapFiatWireAccountRow);
};

const getFiatWireAccount = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  wireAccountId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select linked.id,
            account.business_client_id,
            coalesce(rail.rail_name, linked.instrument_type) as bank_name,
            coalesce(linked.metadata->>'accountNumberLast4', '----') as account_number_last4,
            coalesce(linked.network_code, linked.metadata->>'routingNumber') as routing_number,
            coalesce(linked.metadata->>'businessWireAccountId', linked.metadata->>'wireAccountId') as business_wire_account_id,
            linked.status,
            linked.account_of_digital_asset_id,
            linked.created_at
       from linked_instruments linked
       join accounts_of_digital_asset account
         on account.id = linked.account_of_digital_asset_id
      left join asset_rails rail
         on rail.rail_code = linked.network_code
      where linked.id = $1
        and linked.platform_tenant_id = $2
        and linked.rail_type = 'fiat'`,
    [wireAccountId, tenantId]
  );
  const row = result.rows[0];
  return row ? mapFiatWireAccountRow(row) : undefined;
};

const listFiatMints = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  query: Record<string, string> | undefined
): Promise<unknown> => {
  const page = positiveIntQuery(query, "page", 1, 1);
  const pageSize = positiveIntQuery(query, "pageSize", 25, 1, 200);
  const search = stringQuery(query, "search")?.toLowerCase();
  const status = stringQuery(query, "status")?.toLowerCase();

  const result = await client.query(
    `select id, payload, created_at
       from audit_events
      where platform_tenant_id = $1 and event_type = 'fiat.mint.completed'
      order by created_at desc
      limit 5000`,
    [tenantId]
  );

  const allMints = result.rows.map(mapFiatMintAuditEventRow);
  const circleOperationIds = Array.from(new Set(
    allMints
      .map((item) => typeof item.circleOperationId === "string" ? item.circleOperationId : undefined)
      .filter((item): item is string => Boolean(item))
  ));
  let operationsById = new Map<string, unknown>();
  if (circleOperationIds.length) {
    const operations = await client.query(
      `select id,
              operation_type,
              idempotency_key,
              correlation_id,
              request_payload,
              response_payload,
              provider_account_id,
              provider_wallet_id,
              provider_address_id,
              status,
              error_code,
              created_at
         from circle_api_operations
        where platform_tenant_id = $1
          and id::text = any($2::text[])`,
      [tenantId, circleOperationIds]
    );
    operationsById = new Map(
      operations.rows.map((row) => [String(row.id), mapCircleOperationRow(row as Record<string, unknown>)])
    );
  }
  const hydratedMints = allMints.map((item) => {
    const mintRecord = item as Record<string, unknown>;
    const circleOperationId = typeof mintRecord.circleOperationId === "string" ? mintRecord.circleOperationId : undefined;
    return {
      ...mintRecord,
      circleOperation: circleOperationId ? operationsById.get(circleOperationId) : undefined
    };
  });
  const filtered = hydratedMints.filter((item) => {
    const mintRecord = item as Record<string, unknown>;
    if (status && status !== "all" && String(mintRecord.status ?? "").toLowerCase() !== status) return false;
    if (!search) return true;
    const haystack = [
      String(mintRecord.id ?? ""),
      String(mintRecord.wireAccountId ?? ""),
      String(mintRecord.targetAccountOfDigitalAssetId ?? ""),
      String(mintRecord.providerMintId ?? ""),
      String(mintRecord.status ?? ""),
      String(mintRecord.createdAt ?? ""),
      String(mintRecord.amountMinorUnits ?? "")
    ].join(" ").toLowerCase();
    return haystack.includes(search);
  });

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const normalizedPage = Math.min(page, totalPages);
  const start = (normalizedPage - 1) * pageSize;
  const mints = filtered.slice(start, start + pageSize);

  return {
    mints,
    page: normalizedPage,
    pageSize,
    total,
    totalPages,
    hasNextPage: start + pageSize < total,
    hasPreviousPage: normalizedPage > 1
  };
};

const listFundingRoutes = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountId: string
): Promise<unknown[]> => {
  const result = await client.query(
    `select id, account_of_digital_asset_id, route_type, provider, chain, asset_code, bank_rail, deposit_address, bank_account_ref, status, verification_status, metadata, created_at, updated_at
       from funding_routes
      where platform_tenant_id = $1 and account_of_digital_asset_id = $2
      order by created_at desc
      limit 100`,
    [tenantId, accountId]
  );
  return result.rows.map(mapFundingRouteRow);
};

const getFundingRoute = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  routeId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id, account_of_digital_asset_id, route_type, provider, chain, asset_code, bank_rail, deposit_address, bank_account_ref, status, verification_status, metadata, created_at, updated_at
       from funding_routes
      where id = $1 and platform_tenant_id = $2`,
    [routeId, tenantId]
  );
  const row = result.rows[0];
  return row ? mapFundingRouteRow(row) : undefined;
};

const listReconciliationBreaks = async (client: Pick<PostgresClient, "query">, tenantId: string): Promise<unknown[]> => {
  const result = await client.query(
    `select id, status, reason, webhook_event_id, suspense_case_id, resolution_note, resolved_at, created_at, updated_at
       from reconciliation_breaks
      where platform_tenant_id = $1
      order by created_at desc
      limit 200`,
    [tenantId]
  );
  return result.rows.map(mapReconciliationBreakRow);
};

const getReconciliationBreak = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  breakId: string
): Promise<unknown | undefined> => {
  const result = await client.query(
    `select id, status, reason, webhook_event_id, suspense_case_id, resolution_note, resolved_at, created_at, updated_at
       from reconciliation_breaks
      where id = $1 and platform_tenant_id = $2`,
    [breakId, tenantId]
  );
  const row = result.rows[0];
  return row ? mapReconciliationBreakRow(row) : undefined;
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
            linked.asset_code as linked_asset_code,
            linked.rail_type,
            linked.purpose,
            linked.provider,
            linked.verification_status,
            linked.network_code,
            linked.is_default,
            linked.metadata,
            linked.created_at,
            rail.rail_code,
            rail.rail_name,
            rail.asset_code
       from linked_instruments linked
      left join asset_rails rail on rail.rail_code = linked.network_code
      where linked.account_of_digital_asset_id = $1
      order by linked.created_at desc`,
    [accountId]
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

  const instruments = railsResult.rows.map((row) => {
    return {
      id: row.id,
      instrumentType: row.instrument_type,
      railCode: row.rail_code ?? row.network_code ?? row.instrument_type,
      railName: row.rail_name ?? row.instrument_type,
      assetCode: row.linked_asset_code ?? row.asset_code ?? account.assetCode ?? "USDC",
      railType: row.rail_type ?? undefined,
      purpose: row.purpose ?? undefined,
      provider: row.provider ?? undefined,
      metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : undefined,
      verificationStatus: row.verification_status ?? undefined,
      networkCode: row.network_code ?? undefined,
      isDefault: row.is_default === true,
      status: row.status,
      createdAt: toIsoString(row.created_at)
    };
  });
  const circleWallets = instruments.filter((item) => item.instrumentType === "circle_wallet");
  const rails = instruments.filter((item) => item.instrumentType !== "circle_wallet" && item.railType !== "fiat");
  const linkedFiatLinks = instruments
    .filter((item) => item.railType === "fiat")
    .map((item) => ({
      id: item.id,
      bankName: item.railName ?? "Linked Bank Account",
      accountNumberLast4: "----",
      routingNumber: item.networkCode,
      purpose: item.purpose,
      canUpdatePurpose: true,
      status: item.status,
      createdAt: item.createdAt
    }));
  return {
    accountId,
    account,
    circleWallets,
    rails,
    fiatLinks: linkedFiatLinks,
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
  account: {
    onboarding_status: string;
    asset_rail?: string;
    use_purpose?: string;
    account_name?: string;
    business_client_legal_name?: string;
  }
): Promise<string | undefined> => {
  const isTenantInternalTreasuryClient = account.business_client_legal_name === "Platform Internal Treasury Client";
  const isTenantAdaAccount = (account.use_purpose ?? "") === "tenant_central"
    || ((account.account_name ?? "").toLowerCase().startsWith("tenant ada"));

  // Tenant ADA accounts for the internal treasury client are bootstrapped first
  // and can be activated before linked instruments are attached.
  if (isTenantInternalTreasuryClient && isTenantAdaAccount) {
    return undefined;
  }

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
  circleWalletSetId: row.circle_wallet_set_id ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const mapAccountRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  businessClientId: row.business_client_id,
  businessClientName: row.business_client_name ?? undefined,
  accountName: row.account_name,
  usePurpose: row.use_purpose,
  status: row.status,
  assetCode: row.asset_code,
  assetRail: row.asset_rail,
  metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
    ? row.metadata
    : {},
  createdAt: toIsoString(row.created_at)
});

const mapLinkedInstrumentRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  accountId: row.account_of_digital_asset_id,
  instrumentType: row.instrument_type,
  status: row.status,
  assetCode: row.asset_code ?? undefined,
  railType: row.rail_type ?? undefined,
  purpose: row.purpose ?? undefined,
  provider: row.provider ?? undefined,
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
  providerRequestId:
    (typeof row.response_payload === "object" && row.response_payload !== null
      ? ((row.response_payload as Record<string, unknown>).providerRequestId as string | undefined)
      : undefined),
  providerAccountId: row.provider_account_id ?? undefined,
  providerWalletId: row.provider_wallet_id ?? undefined,
  providerAddressId: row.provider_address_id ?? undefined,
  status: row.status,
  errorCode: row.error_code ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const mapFundingInstructionRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  accountOfDigitalAssetId: row.account_of_digital_asset_id,
  sourceAccountOfDigitalAssetId: row.source_account_of_digital_asset_id ?? row.account_of_digital_asset_id,
  destinationAccountOfDigitalAssetId: row.destination_account_of_digital_asset_id ?? row.account_of_digital_asset_id,
  businessClientId: row.business_client_id,
  fundingType: row.funding_type,
  instructionRole: row.instruction_role ?? undefined,
  transferKind: row.transfer_kind ?? undefined,
  assetCode: row.asset_code,
  currency: row.currency,
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  pendingUsdcMinorUnits: String(row.pending_usdc_minor_units ?? 0),
  availableUsdcMinorUnits: String(row.available_usdc_minor_units ?? 0),
  status: row.status,
  provider: row.provider,
  providerReferenceId: row.provider_reference_id ?? undefined,
  idempotencyKey: row.idempotency_key ?? undefined,
  correlationId: row.correlation_id ?? undefined,
  routeEvidence: row.route_evidence_json ?? undefined,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const mapFundingInstructionOrderRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  fundingInstructionId: row.funding_instruction_id,
  orderKind: row.order_kind,
  dependencyOrderId: row.dependency_order_id ?? undefined,
  sourceAccountOfDigitalAssetId: row.source_account_of_digital_asset_id ?? undefined,
  destinationAccountOfDigitalAssetId: row.destination_account_of_digital_asset_id ?? undefined,
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  currency: row.currency,
  status: row.status,
  providerReferenceId: row.provider_reference_id ?? undefined,
  providerPayload: row.provider_payload_json ?? {},
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const mapFundingReservationRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  settlementObligationId: row.settlement_obligation_id,
  accountOfDigitalAssetId: row.account_of_digital_asset_id,
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  status: row.status,
  createdAt: toIsoString(row.created_at)
});

const mapPaymentRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  paymentType: row.payment_type,
  sourceAccountOfDigitalAssetId: row.source_account_of_digital_asset_id,
  destinationAccountOfDigitalAssetId: row.destination_account_of_digital_asset_id ?? undefined,
  recipientAddress: row.recipient_address ?? undefined,
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  status: row.status,
  providerTransferId: row.provider_transfer_id ?? undefined,
  idempotencyKey: row.idempotency_key ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const mapFiatRedemptionRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  sourceAccountOfDigitalAssetId: row.source_account_of_digital_asset_id,
  linkedInstrumentId: row.linked_instrument_id,
  fiatWireAccountId: row.linked_instrument_id,
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  status: row.status,
  providerWithdrawalId: row.provider_withdrawal_id ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const mapFiatWireAccountRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  accountOfDigitalAssetId: row.account_of_digital_asset_id ?? undefined,
  businessClientId: row.business_client_id,
  bankName: row.bank_name,
  accountNumberLast4: row.account_number_last4,
  routingNumber: row.routing_number,
  businessWireAccountId: row.business_wire_account_id ?? undefined,
  status: row.status,
  createdAt: toIsoString(row.created_at)
});

const mapFiatMintAuditEventRow = (row: Record<string, unknown>): Record<string, unknown> => {
  const payload = row.payload && typeof row.payload === "object" ? row.payload as Record<string, unknown> : {};
  return {
    id: payload.id ?? payload.mintId ?? row.id,
    wireAccountId: payload.wireAccountId,
    targetAccountOfDigitalAssetId: payload.targetAccountOfDigitalAssetId,
    amountMinorUnits: String(payload.amountMinorUnits ?? "0"),
    status: String(payload.status ?? "completed"),
    providerMintId: payload.providerMintId,
    providerWalletId: payload.providerWalletId,
    destinationWalletId: payload.destinationWalletId ?? payload.providerWalletId,
    circleOperationId: payload.circleOperationId,
    createdAt: typeof payload.createdAt === "string" ? payload.createdAt : toIsoString(row.created_at)
  };
};

const mapFundingRouteRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  accountOfDigitalAssetId: row.account_of_digital_asset_id,
  routeType: row.route_type,
  provider: row.provider,
  chain: row.chain ?? undefined,
  assetCode: row.asset_code,
  bankRail: row.bank_rail ?? undefined,
  depositAddress: row.deposit_address ?? undefined,
  bankAccountRef: row.bank_account_ref ?? undefined,
  status: row.status,
  verificationStatus: row.verification_status ?? undefined,
  metadata: row.metadata ?? {},
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const mapReconciliationBreakRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  status: row.status,
  reason: row.reason,
  webhookEventId: row.webhook_event_id ?? undefined,
  suspenseCaseId: row.suspense_case_id ?? undefined,
  resolutionNote: row.resolution_note ?? undefined,
  resolvedAt: toIsoString(row.resolved_at),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const mapTenantCircleIntegrationRow = (row: Record<string, unknown>): unknown => ({
  ...(row.metadata && typeof row.metadata === "object"
    ? (() => {
        const metadata = row.metadata as Record<string, unknown>;
        const responsePayload = metadata.responsePayload && typeof metadata.responsePayload === "object"
          ? metadata.responsePayload as Record<string, unknown>
          : {};
        const tenantWallet = responsePayload.tenantWallet && typeof responsePayload.tenantWallet === "object"
          ? responsePayload.tenantWallet as Record<string, unknown>
          : undefined;
        return {
          tenantWalletId: tenantWallet?.walletId,
          tenantWalletAddress: tenantWallet?.address
        };
      })()
    : {}),
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

const isBusinessWireInstrumentType = (instrumentType: string): boolean =>
  instrumentType === "fiat_wire" || instrumentType === "fiat_wire_bank_account";

const linkedWirePurposeValues = ["minting", "redemption", "bidirectional"] as const;

const normalizeLinkedWirePurpose = (purpose: string | undefined): string | undefined => {
  if (!purpose) return undefined;
  const normalized = purpose.trim().toLowerCase();
  if (["minting", "settlement"].includes(normalized)) return "minting";
  if (["redemption", "payment"].includes(normalized)) return "redemption";
  if (["bidirectional", "dual-purpose", "dual_purpose", "dual purpose", "operating", "custody"].includes(normalized)) {
    return "bidirectional";
  }
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

const asBigInt = (value: unknown): bigint => {
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(String(value));
  } catch {
    return 0n;
  }
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

const stringQuery = (query: Record<string, string> | undefined, key: string): string | undefined => {
  if (!query) return undefined;
  const value = query[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
};

const positiveIntQuery = (
  query: Record<string, string> | undefined,
  key: string,
  fallback: number,
  minValue: number,
  maxValue = Number.MAX_SAFE_INTEGER
): number => {
  const value = stringQuery(query, key);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < minValue) return fallback;
  return Math.min(parsed, maxValue);
};

const walletBlockchainsFromRow = (row: Record<string, unknown>): string[] => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {};
  const responsePayload = metadata.responsePayload && typeof metadata.responsePayload === "object" ? metadata.responsePayload as Record<string, unknown> : {};
  const metadataList = normalizeStringList(responsePayload.walletBlockchains ?? responsePayload.blockchains);
  if (metadataList.length) return metadataList;
  return normalizeStringList(row.wallet_blockchain);
};

const walletSetIdFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const walletSetId = metadata?.walletSetId;
  return typeof walletSetId === "string" && walletSetId.trim().length > 0 ? walletSetId : undefined;
};

const getLatestVerifiedCircleWalletLinkedInstrument = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountOfDigitalAssetId: string
): Promise<Record<string, unknown> | undefined> => {
  const linkedWalletResult = await client.query(
    `select id, metadata
       from linked_instruments
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
        and instrument_type = 'circle_wallet'
        and provider = 'circle'
        and status in ('active', 'verified')
        and verification_status = 'verified'
      order by created_at desc
      limit 1`,
    [tenantId, accountOfDigitalAssetId]
  );
  return linkedWalletResult.rows[0] as Record<string, unknown> | undefined;
};

const getDefaultFiatWireLinkedInstrument = async (
  client: Pick<PostgresClient, "query">,
  tenantId: string,
  accountOfDigitalAssetId: string
): Promise<Record<string, unknown> | undefined> => {
  const result = await client.query(
    `select id, metadata, is_default
       from linked_instruments
      where platform_tenant_id = $1
        and account_of_digital_asset_id = $2
        and instrument_type = 'fiat_wire_bank_account'
        and rail_type = 'fiat'
        and status in ('active', 'verified')
        and verification_status = 'verified'
      order by case when is_default then 0 else 1 end,
               created_at desc
      limit 1`,
    [tenantId, accountOfDigitalAssetId]
  );
  return result.rows[0] as Record<string, unknown> | undefined;
};

const walletIdFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const metadataWalletId = metadata?.walletId;
  if (typeof metadataWalletId === "string" && metadataWalletId.trim().length > 0) return metadataWalletId;
  return undefined;
};

const linkedInstrumentReferenceFromRow = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const metadataWalletId = metadata?.walletId;
  if (typeof metadataWalletId === "string" && metadataWalletId.trim().length > 0) return metadataWalletId;
  return undefined;
};

const walletAddressFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const metadataAddress = metadata?.address ?? metadata?.walletAddress;
  if (typeof metadataAddress === "string" && metadataAddress.trim().length > 0) return metadataAddress;
  return undefined;
};

const trackingRefFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const directTrackingRef = metadata?.trackingRef ?? metadata?.wireTrackingRef;
  if (typeof directTrackingRef === "string" && directTrackingRef.trim().length > 0) return directTrackingRef;
  const wireInstructions = metadata?.wireInstructions && typeof metadata.wireInstructions === "object"
    ? metadata.wireInstructions as Record<string, unknown>
    : undefined;
  const instructionsTrackingRef = wireInstructions?.trackingRef;
  if (typeof instructionsTrackingRef === "string" && instructionsTrackingRef.trim().length > 0) return instructionsTrackingRef;
  return undefined;
};

const businessWireAccountIdFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const businessWireAccountId = metadata?.businessWireAccountId ?? metadata?.wireAccountId;
  if (typeof businessWireAccountId === "string" && businessWireAccountId.trim().length > 0) return businessWireAccountId;
  return undefined;
};

const beneficiaryBankAccountNumberFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const directAccountNumber = metadata?.beneficiaryBankAccountNumber;
  if (typeof directAccountNumber === "string" && directAccountNumber.trim().length > 0) return directAccountNumber;
  const wireInstructions = metadata?.wireInstructions && typeof metadata.wireInstructions === "object"
    ? metadata.wireInstructions as Record<string, unknown>
    : undefined;
  const beneficiaryBank = wireInstructions?.beneficiaryBank && typeof wireInstructions.beneficiaryBank === "object"
    ? wireInstructions.beneficiaryBank as Record<string, unknown>
    : undefined;
  const accountNumber = beneficiaryBank?.accountNumber;
  if (typeof accountNumber === "string" && accountNumber.trim().length > 0) return accountNumber;
  return undefined;
};

const wireInstructionsFromLinkedInstrument = (row: Record<string, unknown>): Record<string, unknown> | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const wireInstructions = metadata?.wireInstructions;
  if (wireInstructions && typeof wireInstructions === "object" && !Array.isArray(wireInstructions)) {
    return wireInstructions as Record<string, unknown>;
  }
  return undefined;
};

const circleWalletBlockchainsFromEnv = (): string[] =>
  normalizeStringList(process.env.CIRCLE_WALLET_BLOCKCHAINS ?? process.env.CIRCLE_WALLET_BLOCKCHAIN ?? defaultCircleBlockchainByEnvironment());

const defaultCircleBlockchainByEnvironment = (): string =>
  process.env.CIRCLE_ENVIRONMENT === "circle-sandbox" ? "ARC-TESTNET" : "ARC";

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const tenantActivationFailureDetail = (responsePayload: Record<string, unknown>): string | undefined => {
  const providerError = responsePayload.providerError && typeof responsePayload.providerError === "object"
    ? responsePayload.providerError as Record<string, unknown>
    : undefined;
  const authDebug = responsePayload.authDebug && typeof responsePayload.authDebug === "object"
    ? responsePayload.authDebug as Record<string, unknown>
    : undefined;
  const message = providerError?.message;
  const code = providerError?.code;
  const httpStatus = providerError?.httpStatus ?? responsePayload.httpStatus;
  const providerRequestId = providerError?.providerRequestId ?? responsePayload.providerRequestId;
  return [
    typeof message === "string" ? message : undefined,
    code !== undefined ? `code=${String(code)}` : undefined,
    httpStatus !== undefined ? `httpStatus=${String(httpStatus)}` : undefined,
    typeof providerRequestId === "string" ? `requestId=${providerRequestId}` : undefined,
    authDebug && typeof authDebug.baseUrl === "string" ? `baseUrl=${authDebug.baseUrl}` : undefined,
    authDebug && typeof authDebug.endpoint === "string" ? `endpoint=${authDebug.endpoint}` : undefined,
    authDebug && typeof authDebug.apiKeyConfigured !== "undefined" ? `apiKeyConfigured=${String(authDebug.apiKeyConfigured)}` : undefined,
    authDebug && typeof authDebug.entitySecretConfigured !== "undefined" ? `entitySecretConfigured=${String(authDebug.entitySecretConfigured)}` : undefined,
    authDebug && typeof authDebug.apiKeyPrefix === "string" ? `apiKeyPrefix=${authDebug.apiKeyPrefix}` : undefined,
    authDebug && typeof authDebug.entitySecretPrefix === "string" ? `entitySecretPrefix=${authDebug.entitySecretPrefix}` : undefined
  ].filter(Boolean).join("; ") || undefined;
};

const asUuidOrNull = (value: string | undefined): string | null => {
  if (!value) return null;
  return isUuid(value) ? value : null;
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
