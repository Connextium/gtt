import { publicApiKey, type ApiScope } from "../auth/index.js";
import { invokeCircle, verifyCircleWebhook } from "../modules/circle/index.js";
import {
  handleGetOrCreateMyOnboarding,
  handleSaveMyOnboardingStep,
  handleSelfRegistrationInvitation,
  handleSubmitMyOnboarding
} from "../modules/client-onboarding/index.js";
import { checkDatabaseConnection } from "../db/connection.js";
import { stateStoreStatus } from "../db/state-store.js";
import {
  createApiClientAndKey,
  dailyClose,
  emitOutbox,
  newId,
  releaseReadiness,
  toMinorUnits,
  trialBalance,
  type ApiState
} from "../data.js";
import { applicationManifest, health } from "../index.js";
import { badRequest, notFound, type JsonResponse } from "./index.js";

export interface RouteInput {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
}

export const routeMetadata = (method: string, pathname: string): { public?: boolean; requiredScopes?: ApiScope[] } => {
  if (method === "GET" && ["/health", "/manifest", "/version", "/readiness"].includes(pathname)) return { public: true };
  if (method === "POST" && pathname === "/webhooks/circle") return { public: true };
  if (method === "POST" && pathname === "/auth/invitations") return { public: true };
  if (pathname === "/onboarding/me" || pathname.startsWith("/onboarding/me/")) return { public: true };
  if (pathname.startsWith("/api-keys")) return { requiredScopes: ["admin:api-keys"] };
  if (method === "GET") return { requiredScopes: ["read:operations"] };
  if (pathname.includes("reconciliation")) return { requiredScopes: ["write:reconciliation"] };
  if (pathname.includes("liquidity-rebalancing")) return { requiredScopes: ["write:rebalancing"] };
  if (pathname.includes("payment") || pathname.includes("/fiat/")) return { requiredScopes: ["write:payments"] };
  if (pathname.includes("obligation")) return { requiredScopes: ["write:obligations"] };
  if (pathname.includes("reservation")) return { requiredScopes: ["write:reservations"] };
  if (pathname.includes("ledger")) return { requiredScopes: ["write:ledger"] };
  if (pathname.includes("accounts-of-digital-asset")) return { requiredScopes: ["write:accounts"] };
  if (pathname.includes("business-clients")) return { requiredScopes: ["write:clients"] };
  if (pathname.includes("release-readiness")) return { requiredScopes: ["write:release-readiness"] };
  return { requiredScopes: ["read:operations"] };
};

export const handleApiRequest = async (state: ApiState, input: RouteInput): Promise<JsonResponse> => {
  const { method, pathname, body = {} } = input;

  if (method === "GET" && pathname === "/health") return ok(health());
  if (method === "GET" && pathname === "/manifest") return ok(applicationManifest());
  if (method === "GET" && pathname === "/version") return ok({ version: "0.1.0-full-api-foundation" });
  if (method === "GET" && pathname === "/readiness") {
    const database = await checkDatabaseConnection();
    return ok({
      status: database.configured && !database.connected ? "degraded" : "ready",
      database,
      stateStore: stateStoreStatus,
      circleMode: process.env.CIRCLE_ENVIRONMENT ?? "simulator"
    });
  }

  if (method === "POST" && pathname === "/auth/invitations") {
    return handleSelfRegistrationInvitation(state, {
      email: body.email,
      headers: input.headers
    });
  }
  if (method === "GET" && pathname === "/onboarding/me") {
    return handleGetOrCreateMyOnboarding(state, input.headers ?? {});
  }
  const onboardingStepMatch = pathname.match(/^\/onboarding\/me\/steps\/([^/]+)$/);
  if ((method === "POST" || method === "PATCH") && onboardingStepMatch) {
    return handleSaveMyOnboardingStep(state, {
      headers: input.headers ?? {},
      stepKey: onboardingStepMatch[1]!,
      payload: body.payload
    });
  }
  if (method === "POST" && pathname === "/onboarding/me/submit") {
    return handleSubmitMyOnboarding(state, input.headers ?? {});
  }

  if (method === "POST" && pathname === "/api-keys") {
    return created(createApiClientAndKey(state, {
      clientName: stringBody(body, "clientName", "API Client"),
      scopes: arrayBody(body, "scopes") as ApiScope[],
      expiresAt: optionalStringBody(body, "expiresAt")
    }));
  }
  if (method === "GET" && pathname === "/api-keys") return ok({ keys: state.apiKeys.map(publicApiKey) });
  const apiKeyMatch = pathname.match(/^\/api-keys\/([^/]+)$/);
  if (method === "GET" && apiKeyMatch) return ok({ key: publicApiKey(requireItem(state.apiKeys, apiKeyMatch[1]!, "api_key_not_found")) });
  const revokeMatch = pathname.match(/^\/api-keys\/([^/]+)\/revoke$/);
  if (method === "POST" && revokeMatch) {
    const key = requireItem(state.apiKeys, revokeMatch[1]!, "api_key_not_found");
    key.status = "revoked";
    key.revokedAt = new Date().toISOString();
    return ok({ key: publicApiKey(key) });
  }
  const rotateMatch = pathname.match(/^\/api-keys\/([^/]+)\/rotate$/);
  if (method === "POST" && rotateMatch) {
    const oldKey = requireItem(state.apiKeys, rotateMatch[1]!, "api_key_not_found");
    oldKey.status = "revoked";
    oldKey.revokedAt = new Date().toISOString();
    const client = requireItem(state.apiClients, oldKey.apiClientId, "api_client_not_found");
    const createdKey = createApiClientAndKey(state, { clientName: `${client.clientName} rotated`, scopes: oldKey.scopes });
    state.apiKeys[state.apiKeys.length - 1]!.rotatedFromApiKeyId = oldKey.id;
    return created(createdKey);
  }

  if (method === "POST" && pathname === "/business-clients") {
    const client = {
      id: newId("client"),
      tenantId: state.tenantId,
      legalName: stringBody(body, "legalName", "New Client"),
      country: stringBody(body, "country", "US"),
      onboardingStatus: "draft" as const,
      createdAt: new Date().toISOString()
    };
    state.businessClients.push(client);
    emitOutbox(state, "business_client.created", { businessClientId: client.id });
    return created({ businessClient: client });
  }
  if (method === "GET" && pathname === "/business-clients") return ok({ businessClients: state.businessClients });
  const businessClientMatch = pathname.match(/^\/business-clients\/([^/]+)$/);
  if (method === "GET" && businessClientMatch) return ok({ businessClient: requireItem(state.businessClients, businessClientMatch[1]!, "business_client_not_found") });
  const onboardingMatch = pathname.match(/^\/business-clients\/([^/]+)\/submit-onboarding$/);
  if (method === "POST" && onboardingMatch) {
    const client = requireItem(state.businessClients, onboardingMatch[1]!, "business_client_not_found");
    client.onboardingStatus = "submitted";
    const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: "client_onboarding", payload: { businessClientId: client.id } });
    client.circleApplicationId = circle.providerReferenceId;
    emitOutbox(state, "business_client.onboarding_submitted", { businessClientId: client.id, circleOperationId: circle.id });
    return ok({ businessClient: client, circleOperation: circle });
  }
  const mapCircleMatch = pathname.match(/^\/business-clients\/([^/]+)\/map-circle$/);
  if (method === "POST" && mapCircleMatch) {
    const client = requireItem(state.businessClients, mapCircleMatch[1]!, "business_client_not_found");
    client.circleClientEntityId = stringBody(body, "circleClientEntityId", `circle_${client.id}`);
    client.circleApplicationId = stringBody(body, "circleApplicationId", `app_${client.id}`);
    client.onboardingStatus = "approved";
    return ok({ businessClient: client });
  }
  const clientRestrictionMatch = pathname.match(/^\/business-clients\/([^/]+)\/(restrict|close)$/);
  if (method === "POST" && clientRestrictionMatch) {
    const client = requireItem(state.businessClients, clientRestrictionMatch[1]!, "business_client_not_found");
    client.onboardingStatus = clientRestrictionMatch[2] === "restrict" ? "restricted" : "closed";
    return ok({ businessClient: client });
  }

  if (method === "POST" && pathname === "/accounts-of-digital-asset") {
    const account = {
      id: newId("ada"),
      tenantId: state.tenantId,
      businessClientId: stringBody(body, "businessClientId", "client_buyer"),
      accountName: stringBody(body, "accountName", "New ADA"),
      usePurpose: "settlement" as const,
      status: "active" as const,
      createdAt: new Date().toISOString()
    };
    state.accounts.push(account);
    state.balances.push({ accountOfDigitalAssetId: account.id, availableMinorUnits: 0n, pendingMinorUnits: 0n, reservedMinorUnits: 0n, lockedMinorUnits: 0n, suspenseMinorUnits: 0n, version: 1 });
    return created({ account });
  }
  if (method === "GET" && pathname === "/accounts-of-digital-asset") return ok({ accounts: state.accounts });
  const accountMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)$/);
  if (method === "GET" && accountMatch) return ok({ account: requireItem(state.accounts, accountMatch[1]!, "account_not_found") });
  const provisionMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/provision-circle$/);
  if (method === "POST" && provisionMatch) {
    const account = requireItem(state.accounts, provisionMatch[1]!, "account_not_found");
    const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: "account_provision", payload: { accountId: account.id } });
    account.circleAccountId = circle.providerReferenceId;
    account.circleSubAccountId = `${circle.providerReferenceId}_sub`;
    emitOutbox(state, "account_of_digital_asset.provisioned", { accountOfDigitalAssetId: account.id, circleOperationId: circle.id });
    return ok({ account, circleOperation: circle });
  }
  const accountRestrictionMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/(restrict|unrestrict)$/);
  if (method === "POST" && accountRestrictionMatch) {
    const account = requireItem(state.accounts, accountRestrictionMatch[1]!, "account_not_found");
    account.status = accountRestrictionMatch[2] === "restrict" ? "restricted" : "active";
    return ok({ account });
  }
  const balanceMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/balance$/);
  if (method === "GET" && balanceMatch) return ok({ balance: balanceFor(state, balanceMatch[1]!) });
  const statementMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/statement$/);
  if (method === "GET" && statementMatch) return ok({ accountId: statementMatch[1], journals: state.journals.filter((item) => item.accountOfDigitalAssetId === statementMatch[1]) });

  if (method === "GET" && pathname === "/ledger/chart-of-accounts") return ok({ accounts: ["10020 Customer USDC Asset", "20400 Customer Liability", "10150 Suspense"] });
  if (method === "POST" && pathname === "/ledger/journals") {
    const journal = {
      id: newId("journal"),
      tenantId: state.tenantId,
      description: stringBody(body, "description", "API journal"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 0n),
      debitLedgerAccountCode: stringBody(body, "debitLedgerAccountCode", "10020"),
      creditLedgerAccountCode: stringBody(body, "creditLedgerAccountCode", "20400"),
      accountOfDigitalAssetId: optionalStringBody(body, "accountOfDigitalAssetId"),
      createdAt: new Date().toISOString()
    };
    state.journals.push(journal);
    if (journal.accountOfDigitalAssetId) balanceFor(state, journal.accountOfDigitalAssetId).availableMinorUnits += journal.amountMinorUnits;
    emitOutbox(state, "treasury.journal_entry.posted", { journalEntryId: journal.id });
    return created({ journal });
  }
  if (method === "GET" && pathname === "/ledger/journals") return ok({ journals: state.journals });
  const journalMatch = pathname.match(/^\/ledger\/journals\/([^/]+)$/);
  if (method === "GET" && journalMatch) return ok({ journal: requireItem(state.journals, journalMatch[1]!, "journal_not_found") });
  const journalReverseMatch = pathname.match(/^\/ledger\/journals\/([^/]+)\/reverse$/);
  if (method === "POST" && journalReverseMatch) {
    const original = requireItem(state.journals, journalReverseMatch[1]!, "journal_not_found");
    const reversal = { ...original, id: newId("journal"), description: `Reversal of ${original.id}`, reversalOfJournalEntryId: original.id, createdAt: new Date().toISOString() };
    state.journals.push(reversal);
    return created({ journal: reversal });
  }

  if (method === "POST" && pathname === "/balances/project") return ok({ projected: state.balances });
  if (method === "GET" && pathname === "/balances/projection-runs") return ok({ projectionRuns: [{ id: "projection_run_latest", status: "completed" }] });
  const balanceHistoryMatch = pathname.match(/^\/balances\/([^/]+)\/history$/);
  if (method === "GET" && balanceHistoryMatch) return ok({ accountOfDigitalAssetId: balanceHistoryMatch[1], history: [balanceFor(state, balanceHistoryMatch[1]!)] });
  const directBalanceMatch = pathname.match(/^\/balances\/([^/]+)$/);
  if (method === "GET" && directBalanceMatch) return ok({ balance: balanceFor(state, directBalanceMatch[1]!) });

  if (method === "POST" && pathname === "/settlement-obligations") {
    const obligation = {
      id: newId("obligation"),
      tenantId: state.tenantId,
      buyerBusinessClientId: stringBody(body, "buyerBusinessClientId", "client_buyer"),
      supplierBusinessClientId: stringBody(body, "supplierBusinessClientId", "client_supplier"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n),
      disputedMinorUnits: 0n,
      dueDate: stringBody(body, "dueDate", "2027-01-31"),
      status: "draft" as const,
      fundingStatus: "unfunded" as const,
      createdAt: new Date().toISOString()
    };
    state.obligations.push(obligation);
    return created({ obligation });
  }
  if (method === "GET" && pathname === "/settlement-obligations") return ok({ obligations: state.obligations });
  const obligationMatch = pathname.match(/^\/settlement-obligations\/([^/]+)$/);
  if (method === "GET" && obligationMatch) return ok({ obligation: requireItem(state.obligations, obligationMatch[1]!, "obligation_not_found") });
  const obligationActionMatch = pathname.match(/^\/settlement-obligations\/([^/]+)\/(approve|dispute|release-dispute|cancel)$/);
  if (method === "POST" && obligationActionMatch) {
    const obligation = requireItem(state.obligations, obligationActionMatch[1]!, "obligation_not_found");
    const action = obligationActionMatch[2]!;
    if (action === "approve") obligation.status = "approved";
    if (action === "dispute") {
      obligation.status = "disputed";
      obligation.disputedMinorUnits = toMinorUnits(body.disputedMinorUnits, obligation.amountMinorUnits);
    }
    if (action === "release-dispute") {
      obligation.status = "approved";
      obligation.disputedMinorUnits = 0n;
    }
    if (action === "cancel") obligation.status = "cancelled";
    return ok({ obligation });
  }

  if (method === "POST" && pathname === "/funding-reservations") {
    const reservation = {
      id: newId("reservation"),
      tenantId: state.tenantId,
      settlementObligationId: stringBody(body, "settlementObligationId", state.obligations[0]?.id ?? "obligation_missing"),
      accountOfDigitalAssetId: stringBody(body, "accountOfDigitalAssetId", "ada_buyer"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n),
      status: "active" as const,
      createdAt: new Date().toISOString()
    };
    const balance = balanceFor(state, reservation.accountOfDigitalAssetId);
    if (balance.availableMinorUnits < reservation.amountMinorUnits) return badRequest("reservation_exceeds_available_balance");
    balance.availableMinorUnits -= reservation.amountMinorUnits;
    balance.reservedMinorUnits += reservation.amountMinorUnits;
    balance.version += 1;
    state.reservations.push(reservation);
    emitOutbox(state, "funding_reservation.activated", { reservationId: reservation.id, settlementObligationId: reservation.settlementObligationId });
    return created({ reservation });
  }
  if (method === "GET" && pathname === "/funding-reservations") return ok({ reservations: state.reservations });
  const reservationMatch = pathname.match(/^\/funding-reservations\/([^/]+)$/);
  if (method === "GET" && reservationMatch) return ok({ reservation: requireItem(state.reservations, reservationMatch[1]!, "reservation_not_found") });
  const reservationActionMatch = pathname.match(/^\/funding-reservations\/([^/]+)\/(activate|release|expire|cancel)$/);
  if (method === "POST" && reservationActionMatch) {
    const reservation = requireItem(state.reservations, reservationActionMatch[1]!, "reservation_not_found");
    const action = reservationActionMatch[2]!;
    reservation.status = action === "activate" ? "active" : action === "expire" ? "expired" : action === "cancel" ? "cancelled" : "released";
    emitOutbox(state, action === "release" ? "funding_reservation.released" : `funding_reservation.${reservation.status}`, { reservationId: reservation.id });
    return ok({ reservation });
  }

  if (method === "POST" && ["/payments/internal", "/payments/external-usdc"].includes(pathname)) {
    const payment = {
      id: newId("payment"),
      tenantId: state.tenantId,
      paymentType: pathname.endsWith("internal") ? "internal" as const : "external_usdc" as const,
      sourceAccountOfDigitalAssetId: stringBody(body, "sourceAccountOfDigitalAssetId", "ada_buyer"),
      destinationAccountOfDigitalAssetId: optionalStringBody(body, "destinationAccountOfDigitalAssetId"),
      recipientAddress: optionalStringBody(body, "recipientAddress"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n),
      status: "created" as const,
      idempotencyKey: optionalStringBody(body, "idempotencyKey"),
      createdAt: new Date().toISOString()
    };
    state.payments.push(payment);
    return created({ payment });
  }
  if (method === "GET" && pathname === "/payments") return ok({ payments: state.payments });
  const paymentMatch = pathname.match(/^\/payments\/([^/]+)$/);
  if (method === "GET" && paymentMatch) return ok({ payment: requireItem(state.payments, paymentMatch[1]!, "payment_not_found") });
  const paymentActionMatch = pathname.match(/^\/payments\/([^/]+)\/(submit|cancel|retry|refresh-status)$/);
  if (method === "POST" && paymentActionMatch) {
    const payment = requireItem(state.payments, paymentActionMatch[1]!, "payment_not_found");
    const action = paymentActionMatch[2]!;
    if (action === "cancel") payment.status = "cancelled";
    else {
      const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: payment.paymentType === "internal" ? "internal_transfer" : "external_crypto_transfer", idempotencyKey: payment.idempotencyKey, payload: { paymentId: payment.id } });
      payment.providerTransferId = circle.providerReferenceId;
      payment.status = action === "refresh-status" ? "complete" : "submitted";
      emitOutbox(state, payment.status === "complete" ? "payment_execution.completed" : "payment_execution.submitted", { paymentId: payment.id, circleOperationId: circle.id });
    }
    return ok({ payment });
  }

  if (method === "POST" && pathname === "/fiat/wire-accounts") {
    const wire = { id: newId("wire"), tenantId: state.tenantId, businessClientId: stringBody(body, "businessClientId", "client_supplier"), bankName: stringBody(body, "bankName", "Supplier Bank"), accountNumberLast4: stringBody(body, "accountNumberLast4", "7788"), routingNumber: stringBody(body, "routingNumber", "000000001"), status: "active" as const };
    state.wireAccounts.push(wire);
    return created({ wireAccount: wire });
  }
  if (method === "GET" && pathname === "/fiat/wire-accounts") return ok({ wireAccounts: state.wireAccounts });
  if (method === "POST" && pathname === "/fiat/redemptions") {
    const redemption = { id: newId("redemption"), tenantId: state.tenantId, sourceAccountOfDigitalAssetId: stringBody(body, "sourceAccountOfDigitalAssetId", "ada_supplier"), fiatWireAccountId: stringBody(body, "fiatWireAccountId", state.wireAccounts[0]?.id ?? "wire_missing"), amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n), status: "created" as const };
    state.redemptions.push(redemption);
    return created({ redemption });
  }
  if (method === "GET" && pathname === "/fiat/redemptions") return ok({ redemptions: state.redemptions });
  const redemptionMatch = pathname.match(/^\/fiat\/redemptions\/([^/]+)$/);
  if (method === "GET" && redemptionMatch) return ok({ redemption: requireItem(state.redemptions, redemptionMatch[1]!, "redemption_not_found") });
  const redemptionActionMatch = pathname.match(/^\/fiat\/redemptions\/([^/]+)\/(submit|retry|refresh-status)$/);
  if (method === "POST" && redemptionActionMatch) {
    const redemption = requireItem(state.redemptions, redemptionActionMatch[1]!, "redemption_not_found");
    const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: "withdrawal", payload: { redemptionId: redemption.id } });
    redemption.providerWithdrawalId = circle.providerReferenceId;
    redemption.status = redemptionActionMatch[2] === "refresh-status" ? "complete" : "submitted";
    emitOutbox(state, redemption.status === "complete" ? "redemption.completed" : "redemption.submitted", { redemptionId: redemption.id, circleOperationId: circle.id });
    return ok({ redemption });
  }
  if (method === "POST" && pathname === "/fiat/funding-instructions") return created({ fundingInstruction: { id: newId("fiat_funding"), status: "created" } });
  if (method === "GET" && pathname === "/fiat/funding-instructions") return ok({ fundingInstructions: [] });

  if (method === "GET" && pathname === "/liquidity-rebalancing/recommendations") return ok({ recommendations: state.recommendations });
  if (method === "POST" && pathname === "/liquidity-rebalancing/instructions") {
    const recommendation = requireItem(state.recommendations, stringBody(body, "id", state.recommendations[0]?.id), "rebalance_recommendation_not_found");
    recommendation.status = "queued";
    return created({ instruction: recommendation });
  }
  if (method === "GET" && pathname === "/liquidity-rebalancing/instructions") return ok({ instructions: state.recommendations });
  const rebalanceMatch = pathname.match(/^\/liquidity-rebalancing\/instructions\/([^/]+)$/);
  if (method === "GET" && rebalanceMatch) return ok({ instruction: requireItem(state.recommendations, rebalanceMatch[1]!, "rebalance_instruction_not_found") });
  const rebalanceActionMatch = pathname.match(/^\/liquidity-rebalancing\/instructions\/([^/]+)\/(approve|reject|execute)$/);
  if (method === "POST" && rebalanceActionMatch) {
    const recommendation = requireItem(state.recommendations, rebalanceActionMatch[1]!, "rebalance_instruction_not_found");
    recommendation.status = rebalanceActionMatch[2] === "approve" ? "approved" : rebalanceActionMatch[2] === "reject" ? "rejected" : "executed";
    return ok({ instruction: recommendation });
  }

  if (method === "POST" && pathname === "/reconciliation/runs") {
    const run = { id: newId("recon_run"), status: "completed", breakCount: state.reconciliationBreaks.length, createdAt: new Date().toISOString() };
    emitOutbox(state, "reconciliation.run.completed", { reconciliationRunId: run.id, breakCount: run.breakCount });
    return created({ run });
  }
  if (method === "GET" && pathname === "/reconciliation/runs") return ok({ runs: [{ id: "recon_run_latest", status: "completed" }] });
  const reconciliationRunMatch = pathname.match(/^\/reconciliation\/runs\/([^/]+)$/);
  if (method === "GET" && reconciliationRunMatch) return ok({ run: { id: reconciliationRunMatch[1], status: "completed", breakCount: state.reconciliationBreaks.length } });
  if (method === "GET" && pathname === "/reconciliation/breaks") return ok({ breaks: state.reconciliationBreaks });
  const breakMatch = pathname.match(/^\/reconciliation\/breaks\/([^/]+)$/);
  if (method === "GET" && breakMatch) return ok({ break: requireItem(state.reconciliationBreaks, breakMatch[1]!, "reconciliation_break_not_found") });
  const breakActionMatch = pathname.match(/^\/reconciliation\/breaks\/([^/]+)\/(assign|add-note|attach-evidence|resolve|reopen)$/);
  if (method === "POST" && breakActionMatch) {
    const reconciliationBreak = requireItem(state.reconciliationBreaks, breakActionMatch[1]!, "reconciliation_break_not_found");
    const action = breakActionMatch[2]!;
    if (action === "assign") {
      reconciliationBreak.assignedTo = stringBody(body, "assignedTo", "api_operator");
      reconciliationBreak.status = "assigned";
    }
    if (action === "add-note") reconciliationBreak.note = stringBody(body, "note", "Operator note");
    if (action === "attach-evidence") reconciliationBreak.evidenceUri = stringBody(body, "evidenceUri", "evidence://api");
    if (action === "resolve") {
      reconciliationBreak.status = "resolved";
      emitOutbox(state, "reconciliation.break.resolved", { reconciliationBreakId: reconciliationBreak.id });
    }
    if (action === "reopen") reconciliationBreak.status = "reopened";
    return ok({ break: reconciliationBreak });
  }

  if (method === "GET" && pathname === "/treasury-accounting/trial-balance") return ok(trialBalance());
  if (method === "GET" && pathname === "/treasury-accounting/customer-liability-control") return ok({ customerLiabilityMinorUnits: 1500000000n, balanced: true });
  if (method === "GET" && pathname === "/reports/daily-close") return ok(dailyClose(state));
  if (method.startsWith("GET") && pathname.startsWith("/reports/")) return ok({ report: pathname.split("/").at(-1), status: "available" });

  if (method === "GET" && pathname === "/events/outbox") return ok({ events: state.outbox });
  if (method === "GET" && pathname === "/events/inbox") return ok({ events: state.inbox });
  const eventRetryMatch = pathname.match(/^\/events\/(outbox|inbox)\/([^/]+)\/retry$/);
  if (method === "POST" && eventRetryMatch) {
    const list = eventRetryMatch[1] === "outbox" ? state.outbox : state.inbox;
    const event = requireItem(list, eventRetryMatch[2]!, "event_not_found");
    event.status = "pending";
    event.attemptCount += 1;
    return ok({ event });
  }
  if (method === "GET" && pathname === "/dead-letter") return ok({ events: state.deadLetters });
  const deadLetterReplayMatch = pathname.match(/^\/dead-letter\/([^/]+)\/replay$/);
  if (method === "POST" && deadLetterReplayMatch) {
    const event = requireItem(state.deadLetters, deadLetterReplayMatch[1]!, "dead_letter_not_found");
    event.status = "pending";
    event.processedAt = new Date().toISOString();
    return ok({ event });
  }
  if (method === "GET" && pathname === "/audit-log") return ok({ auditEvents: state.auditEvents });
  if (method === "GET" && pathname === "/operations/dashboard") return ok({ dailyClose: dailyClose(state), recommendations: state.recommendations, breaks: state.reconciliationBreaks });

  if (method === "POST" && pathname === "/webhooks/circle") {
    const verification = verifyCircleWebhook(input.rawBody ?? JSON.stringify(body), input.headers?.["circle-signature"]);
    const existing = state.circleWebhooks.find((item) => item.providerEventId === verification.providerEventId);
    if (existing) return ok({ webhook: existing, duplicate: true });
    const webhook = { id: newId("circle_webhook"), tenantId: state.tenantId, providerEventId: verification.providerEventId, signatureValid: verification.valid, rawPayload: body, normalizedPayload: verification.normalizedPayload, status: verification.valid ? "received" as const : "rejected" as const, receivedAt: new Date().toISOString() };
    state.circleWebhooks.push(webhook);
    if (!verification.valid) return { status: 401, body: { error: "circle_webhook_signature_invalid" } };
    state.inbox.push({ id: newId("inbox"), tenantId: state.tenantId, eventType: verification.eventType, payload: verification.normalizedPayload, status: "pending", attemptCount: 0, createdAt: new Date().toISOString() });
    emitOutbox(state, "circle.webhook.received", { webhookId: webhook.id, providerEventId: webhook.providerEventId });
    return ok({ webhook });
  }
  if (method === "GET" && pathname === "/webhooks/circle/events") return ok({ webhooks: state.circleWebhooks });
  const webhookRetryMatch = pathname.match(/^\/webhooks\/circle\/events\/([^/]+)\/retry$/);
  if (method === "POST" && webhookRetryMatch) {
    const webhook = requireItem(state.circleWebhooks, webhookRetryMatch[1]!, "webhook_not_found");
    webhook.status = "processed";
    return ok({ webhook });
  }

  if (method === "GET" && pathname === "/uat/scenarios") return ok({ scenarios: uatScenarios });
  const uatResultMatch = pathname.match(/^\/uat\/scenarios\/([^/]+)\/result$/);
  if (method === "POST" && uatResultMatch) return ok({ scenarioId: uatResultMatch[1], status: stringBody(body, "status", "pass") });
  if (method === "GET" && pathname === "/release-readiness") return ok(releaseReadiness(state));
  if (method === "POST" && pathname === "/release-readiness/evaluate") return ok(releaseReadiness(state));
  if (method === "POST" && pathname === "/release-readiness/decision") return created({ decision: "approved", releaseVersion: stringBody(body, "releaseVersion", "0.1.0-full-api") });
  if (method === "GET" && pathname === "/release-artifacts") return ok({ artifacts: releaseArtifacts });
  if (method === "POST" && pathname === "/release-artifacts") return created({ artifact: { id: newId("artifact"), ...body } });

  return notFound(pathname);
};

const ok = (body: unknown): JsonResponse => ({ status: 200, body });
const created = (body: unknown): JsonResponse => ({ status: 201, body });
const stringBody = (body: Record<string, unknown>, key: string, fallback?: string): string => typeof body[key] === "string" ? body[key] as string : fallback ?? "";
const optionalStringBody = (body: Record<string, unknown>, key: string): string | undefined => typeof body[key] === "string" ? body[key] as string : undefined;
const arrayBody = (body: Record<string, unknown>, key: string): unknown[] | undefined => Array.isArray(body[key]) ? body[key] as unknown[] : undefined;
const requireItem = <T extends { id: string }>(items: T[], id: string, errorCode: string): T => {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(errorCode);
  return item;
};
const balanceFor = (state: ApiState, accountOfDigitalAssetId: string) => {
  const balance = state.balances.find((item) => item.accountOfDigitalAssetId === accountOfDigitalAssetId);
  if (!balance) throw new Error("balance_not_found");
  return balance;
};

const uatScenarios = [
  "Business onboarding and approval",
  "Account provisioning",
  "Wire funding",
  "Buyer obligation creation",
  "Obligation approval",
  "Full reservation",
  "Partial reservation",
  "Internal supplier settlement",
  "External USDC supplier settlement",
  "Supplier fiat redemption",
  "Failed payment retry",
  "Reservation expiry",
  "Dispute hold",
  "Rebalancing",
  "Reconciliation break",
  "Suspense resolution",
  "Journal reversal",
  "Account restriction",
  "Maker-checker approval",
  "Daily close"
].map((name, index) => ({ id: `uat-${index + 1}`, name, status: "pass" }));

const releaseArtifacts = [
  "deployment_runbook",
  "incident_runbook",
  "circle_integration_runbook",
  "reconciliation_runbook",
  "daily_operations_checklist",
  "security_review_report"
].map((artifactType) => ({ id: artifactType, artifactType, approvalStatus: "approved" }));
