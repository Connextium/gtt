import { createInitialState } from "./data.js";
import { invokeCircle } from "./modules/circle/index.js";
import { encodeBigInts, reviveBigInts } from "./db/state-store.js";
import { runScheduledJobs } from "./workers/scheduler.js";
import { createApiServer } from "./server.js";
import { processEvents } from "./workers/index.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const rootApiKey = "gtt_live_api_key_dev.dev_secret";
const server = createApiServer();

const listen = async (): Promise<number> => {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("server_address_unavailable");
      resolve(address.port);
    });
  });
};

const requestJson = async (port: number, path: string, init: RequestInit = {}, authenticated = true) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${rootApiKey}` } : {}),
      ...(init.headers ?? {})
    }
  });
  const body = (await response.json()) as unknown;
  assert(response.ok, `request failed: ${path} ${JSON.stringify(body)}`);
  return body as Record<string, unknown>;
};

const port = await listen();

try {
  const snapshotRoundTrip = reviveBigInts(JSON.parse(JSON.stringify(encodeBigInts(createInitialState()))));
  const restoredBalance = (snapshotRoundTrip as ReturnType<typeof createInitialState>).balances[0];
  assert(typeof restoredBalance?.availableMinorUnits === "bigint", "state snapshot should revive bigint balances");

  const circleState = createInitialState();
  const originalFetch = globalThis.fetch;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  process.env.CIRCLE_API_KEY = "test_circle_key";
  process.env.CIRCLE_API_BASE_URL = "https://circle.test";
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: { id: "circle_http_reference" } }), { status: 200 })) as typeof fetch;
  const circleOperation = await invokeCircle(circleState, { tenantId: circleState.tenantId, operationType: "internal_transfer", payload: { amount: "1.00" } });
  assert(circleOperation.providerReferenceId === "circle_http_reference", "Circle HTTP adapter should use provider reference");
  globalThis.fetch = originalFetch;
  process.env.CIRCLE_ENVIRONMENT = "simulator";

  const scheduledState = createInitialState();
  scheduledState.reservations.push({
    id: "reservation_expired_smoke",
    tenantId: scheduledState.tenantId,
    settlementObligationId: "obligation_smoke",
    accountOfDigitalAssetId: "ada_buyer",
    amountMinorUnits: 1n,
    status: "active",
    createdAt: "2020-01-01T00:00:00.000Z"
  });
  const scheduled = await runScheduledJobs(scheduledState);
  assert(scheduled.expiredReservations === 1, "scheduler should expire stale reservations");

  scheduledState.inbox.push({
    id: "inbox_smoke",
    tenantId: scheduledState.tenantId,
    eventType: "circle.transfer.status_changed",
    payload: { resourceId: "provider_payment_smoke", status: "complete" },
    status: "pending",
    attemptCount: 0,
    createdAt: new Date().toISOString()
  });
  scheduledState.payments.push({
    id: "payment_worker_smoke",
    tenantId: scheduledState.tenantId,
    paymentType: "internal",
    sourceAccountOfDigitalAssetId: "ada_buyer",
    amountMinorUnits: 1n,
    status: "submitted",
    providerTransferId: "provider_payment_smoke",
    createdAt: new Date().toISOString()
  });
  const worker = await processEvents(scheduledState);
  assert(worker.processedInbox === 1, "worker should process inbox events");
  assert(scheduledState.payments.at(-1)?.status === "complete", "worker should apply Circle payment status");

  const health = await requestJson(port, "/health", {}, false);
  assert(health.status === "ok", "health should return ok");

  const unauthorized = await fetch(`http://127.0.0.1:${port}/business-clients`);
  assert(unauthorized.status === 401, "protected routes should require API key");

  const manifest = await requestJson(port, "/manifest", {}, false);
  assert(manifest.latestMigrationVersion === "0012", "manifest should expose latest migration");

  const apiKey = await requestJson(port, "/api-keys", {
    method: "POST",
    body: JSON.stringify({ clientName: "Smoke Client", scopes: ["read:operations"] })
  });
  assert(typeof apiKey.plaintextKey === "string", "api key creation should show plaintext once");
  assert(!(apiKey.key as Record<string, unknown>).keyHash, "api key response must not expose hash");

  const client = await requestJson(port, "/business-clients", {
    method: "POST",
    headers: { "idempotency-key": "smoke-client-create" },
    body: JSON.stringify({ legalName: "Smoke Buyer", country: "US" })
  });
  const clientReplay = await requestJson(port, "/business-clients", {
    method: "POST",
    headers: { "idempotency-key": "smoke-client-create" },
    body: JSON.stringify({ legalName: "Smoke Buyer", country: "US" })
  });
  assert((clientReplay.businessClient as { id: string }).id === (client.businessClient as { id: string }).id, "idempotency replay should return original response");
  const businessClientId = (client.businessClient as { id: string }).id;
  await requestJson(port, `/business-clients/${businessClientId}/submit-onboarding`, { method: "POST" });
  await requestJson(port, `/business-clients/${businessClientId}/map-circle`, {
    method: "POST",
    body: JSON.stringify({ circleClientEntityId: "circle_smoke_entity", circleApplicationId: "circle_smoke_app" })
  });

  const account = await requestJson(port, "/accounts-of-digital-asset", {
    method: "POST",
    body: JSON.stringify({ businessClientId, accountName: "Smoke ADA" })
  });
  const accountId = (account.account as { id: string }).id;
  await requestJson(port, `/accounts-of-digital-asset/${accountId}/provision-circle`, { method: "POST" });
  await requestJson(port, "/ledger/journals", {
    method: "POST",
    body: JSON.stringify({ accountOfDigitalAssetId: accountId, amountMinorUnits: "250000000", description: "Smoke funding" })
  });
  const balance = await requestJson(port, `/accounts-of-digital-asset/${accountId}/balance`);
  assert((balance.balance as { availableMinorUnits: string }).availableMinorUnits === "250000000", "journal should update balance");
  const balanceHistory = await requestJson(port, `/balances/${accountId}/history`);
  assert(Array.isArray(balanceHistory.history), "balance history should be available");

  const obligation = await requestJson(port, "/settlement-obligations", {
    method: "POST",
    body: JSON.stringify({ buyerBusinessClientId: businessClientId, supplierBusinessClientId: "client_supplier", amountMinorUnits: "100000000" })
  });
  const obligationId = (obligation.obligation as { id: string }).id;
  await requestJson(port, `/settlement-obligations/${obligationId}/approve`, { method: "POST" });

  const reservation = await requestJson(port, "/funding-reservations", {
    method: "POST",
    body: JSON.stringify({ settlementObligationId: obligationId, accountOfDigitalAssetId: accountId, amountMinorUnits: "50000000" })
  });
  assert((reservation.reservation as { status: string }).status === "active", "reservation should activate");

  const payment = await requestJson(port, "/payments/internal", {
    method: "POST",
    body: JSON.stringify({ sourceAccountOfDigitalAssetId: accountId, destinationAccountOfDigitalAssetId: "ada_supplier", amountMinorUnits: "25000000" })
  });
  const paymentId = (payment.payment as { id: string }).id;
  await requestJson(port, `/payments/${paymentId}/submit`, { method: "POST" });
  const refreshedPayment = await requestJson(port, `/payments/${paymentId}/refresh-status`, { method: "POST" });
  assert((refreshedPayment.payment as { status: string }).status === "complete", "payment refresh should complete");

  const wire = await requestJson(port, "/fiat/wire-accounts", { method: "POST", body: JSON.stringify({ businessClientId: "client_supplier" }) });
  const wireId = (wire.wireAccount as { id: string }).id;
  const redemption = await requestJson(port, "/fiat/redemptions", {
    method: "POST",
    body: JSON.stringify({ sourceAccountOfDigitalAssetId: "ada_supplier", fiatWireAccountId: wireId, amountMinorUnits: "50000000" })
  });
  const redemptionId = (redemption.redemption as { id: string }).id;
  await requestJson(port, `/fiat/redemptions/${redemptionId}/submit`, { method: "POST" });

  await requestJson(port, "/liquidity-rebalancing/instructions", { method: "POST", body: JSON.stringify({ id: "rebalance-029" }) });
  await requestJson(port, "/liquidity-rebalancing/instructions/rebalance-029/approve", { method: "POST" });
  await requestJson(port, "/liquidity-rebalancing/instructions/rebalance-029/execute", { method: "POST" });

  await requestJson(port, "/reconciliation/runs", { method: "POST" });
  await requestJson(port, "/reconciliation/breaks/break-001/assign", { method: "POST", body: JSON.stringify({ assignedTo: "api_smoke" }) });
  await requestJson(port, "/reconciliation/breaks/break-001/attach-evidence", { method: "POST", body: JSON.stringify({ evidenceUri: "evidence://smoke" }) });
  await requestJson(port, "/reconciliation/breaks/break-001/resolve", { method: "POST" });

  const webhook = await requestJson(port, "/webhooks/circle", {
    method: "POST",
    headers: { "circle-signature": "test_valid_signature" },
    body: JSON.stringify({ id: "circle_evt_smoke", type: "circle.transfer.status_changed", status: "complete" })
  }, false);
  assert((webhook.webhook as { status: string }).status === "received", "webhook should be received");
  const duplicateWebhook = await requestJson(port, "/webhooks/circle", {
    method: "POST",
    headers: { "circle-signature": "test_valid_signature" },
    body: JSON.stringify({ id: "circle_evt_smoke", type: "circle.transfer.status_changed", status: "complete" })
  }, false);
  assert(duplicateWebhook.duplicate === true, "duplicate webhook should be acknowledged without duplicate effects");

  const outbox = await requestJson(port, "/events/outbox");
  assert(Array.isArray(outbox.events), "outbox should list events");
  const audit = await requestJson(port, "/audit-log");
  assert(Array.isArray(audit.auditEvents), "audit log should list command audit events");
  const dailyClose = await requestJson(port, "/reports/daily-close");
  assert(typeof dailyClose.openBreakCount === "number", "daily close should include open break count");
  const releaseReadiness = await requestJson(port, "/release-readiness");
  assert(releaseReadiness.decision === "approved", "release readiness should approve pilot gate");
  const uat = await requestJson(port, "/uat/scenarios");
  assert(Array.isArray(uat.scenarios), "uat scenarios should list");

  console.log("API smoke test passed");
} finally {
  server.close();
}
