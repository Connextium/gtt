import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { handleApiRequest, routeMetadata } from "../../src/http/router.js";

test("route metadata keeps /webhooks/circle public for HEAD and POST", () => {
  assert.equal(routeMetadata("POST", "/webhooks/circle").public, true);
  assert.equal(routeMetadata("HEAD", "/webhooks/circle").public, true);
  assert.equal(routeMetadata("HEAD", "/webhooks/circle/").public, true);
});

test("HEAD /webhooks/circle returns 204 for endpoint validation", async () => {
  const state = createInitialState();
  const result = await handleApiRequest(state, {
    method: "HEAD",
    pathname: "/webhooks/circle"
  });

  assert.equal(result.status, 204);
});

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

test("Provision Circle ignores legacy ADA ids and creates wallet-set-bound mapping", async () => {
  const state = createInitialState();
  const account = state.accounts[0]!;
  const beforeCount = state.circleOperations.length;

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: `/accounts-of-digital-asset/${account.id}/provision-circle`
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as { reusedExistingMapping?: boolean }).reusedExistingMapping, undefined);
  assert.equal(state.circleOperations.length, beforeCount + 1);
  assert.equal(state.circleOperations[0]?.operationType, "ada_circle_mapping");
  assert.equal(typeof state.circleOperations[0]?.requestPayload.walletSetId, "string");
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
  assert.equal(codes.includes("10010"), true);
  assert.equal(codes.includes("20500"), true);
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

test("fiat mint writes dedicated mint history records", async () => {
  const state = createInitialState();
  const wireResult = await handleApiRequest(state, {
    method: "POST",
    pathname: "/fiat/wire-accounts",
    body: {
      businessClientId: "client_platform",
      bankName: "Platform Treasury Bank",
      accountNumberLast4: "2401",
      routingNumber: "011000015"
    }
  });
  const wireAccountId = (wireResult.body as { wireAccount: { id: string } }).wireAccount.id;

  const firstMint = await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "1000000"
    }
  });
  const secondMint = await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_supplier",
      amountMinorUnits: "2000000"
    }
  });

  assert.equal(firstMint.status, 201);
  assert.equal(secondMint.status, 201);

  const history = await handleApiRequest(state, {
    method: "GET",
    pathname: "/fiat/mints"
  });
  assert.equal(history.status, 200);
  const payload = history.body as { mints: Array<{ targetAccountOfDigitalAssetId: string }> };
  assert.equal(payload.mints.length, 2);
  assert.equal(payload.mints[0]?.targetAccountOfDigitalAssetId, "ada_supplier");
  assert.equal(payload.mints[1]?.targetAccountOfDigitalAssetId, "ada_buyer");
});

test("fiat mint history supports pagination and filters", async () => {
  const state = createInitialState();
  const wireResult = await handleApiRequest(state, {
    method: "POST",
    pathname: "/fiat/wire-accounts",
    body: {
      businessClientId: "client_platform",
      bankName: "Platform Treasury Bank",
      accountNumberLast4: "2401",
      routingNumber: "011000015"
    }
  });
  const wireAccountId = (wireResult.body as { wireAccount: { id: string } }).wireAccount.id;

  await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "1000000"
    }
  });
  await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_supplier",
      amountMinorUnits: "2000000"
    }
  });
  await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "3000000"
    }
  });

  const pageOne = await handleApiRequest(state, {
    method: "GET",
    pathname: "/fiat/mints",
    query: {
      page: "1",
      pageSize: "2"
    }
  });
  assert.equal(pageOne.status, 200);
  const pageOneBody = pageOne.body as {
    mints: Array<{ targetAccountOfDigitalAssetId: string }>;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  assert.equal(pageOneBody.mints.length, 2);
  assert.equal(pageOneBody.total, 3);
  assert.equal(pageOneBody.totalPages, 2);
  assert.equal(pageOneBody.hasNextPage, true);
  assert.equal(pageOneBody.hasPreviousPage, false);

  const filtered = await handleApiRequest(state, {
    method: "GET",
    pathname: "/fiat/mints",
    query: {
      search: "ada_supplier"
    }
  });
  assert.equal(filtered.status, 200);
  const filteredBody = filtered.body as { mints: Array<{ targetAccountOfDigitalAssetId: string }>; total: number };
  assert.equal(filteredBody.total, 1);
  assert.equal(filteredBody.mints[0]?.targetAccountOfDigitalAssetId, "ada_supplier");

  state.fiatMintHistory.unshift({
    id: "fiat_mint_failed_sample",
    tenantId: state.tenantId,
    wireAccountId,
    targetAccountOfDigitalAssetId: "ada_buyer",
    amountMinorUnits: 1n,
    status: "failed",
    providerMintId: "provider_failed_sample",
    createdAt: new Date().toISOString()
  });

  const statusFiltered = await handleApiRequest(state, {
    method: "GET",
    pathname: "/fiat/mints",
    query: {
      status: "failed"
    }
  });
  assert.equal(statusFiltered.status, 200);
  const statusFilteredBody = statusFiltered.body as { mints: Array<{ status: string }>; total: number };
  assert.equal(statusFilteredBody.total, 1);
  assert.equal(statusFilteredBody.mints[0]?.status, "failed");
});

test("fiat mint history exposes destination wallet and circle operation for parity", async () => {
  const state = createInitialState();
  const wireResult = await handleApiRequest(state, {
    method: "POST",
    pathname: "/fiat/wire-accounts",
    body: {
      businessClientId: "client_platform",
      bankName: "Platform Treasury Bank",
      accountNumberLast4: "2401",
      routingNumber: "011000015"
    }
  });
  const wireAccountId = (wireResult.body as { wireAccount: { id: string } }).wireAccount.id;

  const minted = await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "1000000",
      destinationWalletId: "circle_wallet_ada_buyer"
    }
  });
  assert.equal(minted.status, 201);

  const history = await handleApiRequest(state, {
    method: "GET",
    pathname: "/fiat/mints"
  });
  assert.equal(history.status, 200);

  const payload = history.body as {
    mints: Array<{
      destinationWalletId?: string;
      circleOperation?: { id: string; operationType: string };
    }>;
  };
  assert.equal(payload.mints.length, 1);
  assert.equal(payload.mints[0]?.destinationWalletId, "circle_wallet_ada_buyer");
  assert.equal(payload.mints[0]?.circleOperation?.operationType, "internal_transfer");
  assert.equal(typeof payload.mints[0]?.circleOperation?.id, "string");
});

test("fiat mint fails when target ADA account has no linked Circle wallet", async () => {
  const state = createInitialState();
  state.accounts.push({
    id: "ada_unlinked",
    tenantId: state.tenantId,
    businessClientId: "client_platform",
    accountName: "Unlinked ADA",
    usePurpose: "operating",
    status: "active",
    createdAt: new Date().toISOString()
  });

  const wireResult = await handleApiRequest(state, {
    method: "POST",
    pathname: "/fiat/wire-accounts",
    body: {
      businessClientId: "client_platform",
      bankName: "Platform Treasury Bank",
      accountNumberLast4: "2401",
      routingNumber: "011000015"
    }
  });
  const wireAccountId = (wireResult.body as { wireAccount: { id: string } }).wireAccount.id;

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_unlinked",
      amountMinorUnits: "1000000"
    }
  });

  assert.equal(result.status, 400);
  assert.equal((result.body as { error?: string }).error, "account_circle_wallet_not_linked");
});

test("fiat mint fails when target ADA account is missing", async () => {
  const state = createInitialState();
  const wireResult = await handleApiRequest(state, {
    method: "POST",
    pathname: "/fiat/wire-accounts",
    body: {
      businessClientId: "client_platform",
      bankName: "Platform Treasury Bank",
      accountNumberLast4: "2401",
      routingNumber: "011000015"
    }
  });
  const wireAccountId = (wireResult.body as { wireAccount: { id: string } }).wireAccount.id;

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: `/fiat/wire-accounts/${wireAccountId}/mint`,
    body: {
      targetAccountOfDigitalAssetId: "ada_missing",
      amountMinorUnits: "1000000"
    }
  });

  assert.equal(result.status, 404);
  assert.equal((result.body as { error?: string }).error, "account_not_found");
});

test("fiat mint in-memory path is blocked outside simulator and does not mutate local ADA balance", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";

  try {
    const state = createInitialState();
    const beforeBalance = state.balances.find((item) => item.accountOfDigitalAssetId === "ada_buyer");
    assert.ok(beforeBalance);
    const beforeAvailable = beforeBalance.availableMinorUnits;
    const beforeVersion = beforeBalance.version;

    const result = await handleApiRequest(state, {
      method: "POST",
      pathname: "/fiat/wire-accounts/wire_guard_test/mint",
      body: {
        targetAccountOfDigitalAssetId: "ada_buyer",
        amountMinorUnits: "1000000",
        destinationWalletId: "circle_wallet_ada_buyer"
      }
    });

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "in_memory_route_simulator_only");

    const afterBalance = state.balances.find((item) => item.accountOfDigitalAssetId === "ada_buyer");
    assert.ok(afterBalance);
    assert.equal(afterBalance.availableMinorUnits, beforeAvailable);
    assert.equal(afterBalance.version, beforeVersion);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});

test("payments in-memory write path is blocked outside simulator", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";

  try {

test("fiat mint history in-memory reader is blocked outside simulator", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "circle-sandbox";

  try {
    const state = createInitialState();
    const result = await handleApiRequest(state, {
      method: "GET",
      pathname: "/fiat/mints"
    });

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "in_memory_route_simulator_only");
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});

test("fiat mint history in-memory reader is allowed in simulator mode", async () => {
  const previousEnvironment = process.env.CIRCLE_ENVIRONMENT;
  process.env.CIRCLE_ENVIRONMENT = "simulator";

  try {
    const state = createInitialState();
    const result = await handleApiRequest(state, {
      method: "GET",
      pathname: "/fiat/mints"
    });

    assert.equal(result.status, 200);
    const payload = result.body as { mints: unknown[] };
    assert.ok(Array.isArray(payload.mints));
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});
    const state = createInitialState();
    const result = await handleApiRequest(state, {
      method: "POST",
      pathname: "/payments/internal",
      body: {
        sourceAccountOfDigitalAssetId: "ada_buyer",
        destinationAccountOfDigitalAssetId: "ada_supplier",
        amountMinorUnits: "1000"
      }
    });

    assert.equal(result.status, 400);
    assert.equal((result.body as { error?: string }).error, "in_memory_route_simulator_only");
    assert.equal(state.payments.length, 0);
  } finally {
    if (previousEnvironment === undefined) delete process.env.CIRCLE_ENVIRONMENT;
    else process.env.CIRCLE_ENVIRONMENT = previousEnvironment;
  }
});
