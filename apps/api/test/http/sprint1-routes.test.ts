import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { handleApiRequest } from "../../src/http/router.js";

test("business client lifecycle rejects approval before submission", async () => {
  const state = createInitialState();
  const created = await handleApiRequest(state, {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "Lifecycle Client", country: "US" }
  });
  const clientId = ((created.body as { businessClient: { id: string } }).businessClient.id);

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: `/business-clients/${clientId}/map-circle`,
    body: { circleClientEntityId: "circle_client_lifecycle", circleApplicationId: "circle_app_lifecycle" }
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "business_client_invalid_status_transition" });
});

test("approved business client can receive an ADA", async () => {
  const state = createInitialState();
  const created = await handleApiRequest(state, {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "ADA Client", country: "US" }
  });
  const clientId = ((created.body as { businessClient: { id: string } }).businessClient.id);
  await handleApiRequest(state, { method: "POST", pathname: `/business-clients/${clientId}/submit-onboarding` });
  await handleApiRequest(state, {
    method: "POST",
    pathname: `/business-clients/${clientId}/map-circle`,
    body: { circleClientEntityId: "circle_client_ada", circleApplicationId: "circle_app_ada" }
  });

  const account = await handleApiRequest(state, {
    method: "POST",
    pathname: "/accounts-of-digital-asset",
    body: { businessClientId: clientId, accountName: "Primary ADA" }
  });

  assert.equal(account.status, 201);
  assert.equal((account.body as { account: { businessClientId: string } }).account.businessClientId, clientId);
});

test("Provision Circle reuses existing ADA mapping instead of creating a second wallet", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "simulator";
  try {
    const state = createInitialState();
    const created = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business-clients",
      body: { legalName: "Circle Reuse Client", country: "US" }
    });
    const clientId = ((created.body as { businessClient: { id: string } }).businessClient.id);
    await handleApiRequest(state, { method: "POST", pathname: `/business-clients/${clientId}/submit-onboarding` });
    await handleApiRequest(state, {
      method: "POST",
      pathname: `/business-clients/${clientId}/map-circle`,
      body: { circleClientEntityId: "circle_client_reuse", circleApplicationId: "circle_app_reuse" }
    });
    const accountResponse = await handleApiRequest(state, {
      method: "POST",
      pathname: "/accounts-of-digital-asset",
      body: { businessClientId: clientId, accountName: "Reusable ADA" }
    });
    const accountId = (accountResponse.body as { account: { id: string } }).account.id;

    const first = await handleApiRequest(state, { method: "POST", pathname: `/accounts-of-digital-asset/${accountId}/provision-circle` });
    const operationCount = state.circleOperations.length;
    const second = await handleApiRequest(state, { method: "POST", pathname: `/accounts-of-digital-asset/${accountId}/provision-circle` });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(state.circleOperations.length, operationCount);
    assert.equal((second.body as { reusedExistingMapping?: boolean }).reusedExistingMapping, true);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});

test("Provision Circle records recovered runtime evidence when ADA already has Circle ids", async () => {
  const state = createInitialState();
  const account = state.accounts[0]!;
  const beforeCount = state.circleOperations.length;

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: `/accounts-of-digital-asset/${account.id}/provision-circle`
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as { reusedExistingMapping?: boolean }).reusedExistingMapping, true);
  assert.equal(state.circleOperations.length, beforeCount + 1);
  assert.equal(state.circleOperations[0]?.operationType, "ada_circle_mapping");
  assert.equal(state.circleOperations[0]?.responsePayload.recoveredExistingAccountMapping, true);
});

test("posting rule endpoint and opening journal event use controlled ledger accounts", async () => {
  const state = createInitialState();
  const rules = await handleApiRequest(state, { method: "GET", pathname: "/ledger/posting-rules" });

  assert.equal(rules.status, 200);
  assert.equal((rules.body as { postingRules: Array<{ debitLedgerAccountCode: string }> }).postingRules[0]?.debitLedgerAccountCode, "10020");

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: "/ledger/events/opening-journal",
    body: {
      accountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "1000000",
      description: "Opening event"
    }
  });

  const journal = (result.body as { journal: { debitLedgerAccountCode: string; creditLedgerAccountCode: string } }).journal;
  assert.equal(result.status, 201);
  assert.equal(journal.debitLedgerAccountCode, "10020");
  assert.equal(journal.creditLedgerAccountCode, "20400");
});

test("chart of accounts includes customer ADA liability accounts", async () => {
  const state = createInitialState();
  const result = await handleApiRequest(state, { method: "GET", pathname: "/ledger/chart-of-accounts" });
  const codes = (result.body as { accounts: Array<{ accountCode: string }> }).accounts.map((account) => account.accountCode);

  assert.equal(codes.includes("20430"), true);
  assert.equal(codes.includes("20440"), true);
});

test("Circle integration health reports simulator readiness without API key", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  process.env.CIRCLE_ENVIRONMENT = "simulator";
  delete process.env.CIRCLE_API_KEY;
  try {
    const state = createInitialState();
    const result = await handleApiRequest(state, { method: "GET", pathname: "/integrations/circle/health" });
    assert.equal(result.status, 200);
    const body = result.body as { circle: { environment: string; status: string; apiKeyConfigured: boolean } };
    assert.equal(body.circle.environment, "simulator");
    assert.equal(body.circle.status, "ready");
    assert.equal(body.circle.apiKeyConfigured, false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
  }
});

test("Circle sandbox check records diagnostic operation and does not expose API key", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  const previousApiKey = process.env.CIRCLE_API_KEY;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";
  delete process.env.CIRCLE_API_KEY;
  try {
    const state = createInitialState();
    const result = await handleApiRequest(state, { method: "POST", pathname: "/integrations/circle/sandbox-check" });
    assert.equal(result.status, 400);
    assert.equal(state.circleOperations[0]?.operationType, "circle.sandbox_check");
    assert.equal(JSON.stringify(result.body).includes("TEST_API_KEY"), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
    if (previousApiKey === undefined) delete process.env.CIRCLE_API_KEY;
    else process.env.CIRCLE_API_KEY = previousApiKey;
  }
});
