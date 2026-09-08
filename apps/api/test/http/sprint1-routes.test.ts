import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { handleApiRequest, routeMetadata } from "../../src/http/router.js";
import {
  resetBusinessAuthSessionsForTest,
  setSupabaseBusinessAuthClientForTest
} from "../../src/modules/client-onboarding/index.js";

const withDevBusinessAuth = async (work: (headers: Record<string, string>) => Promise<void>): Promise<void> => {
  const previousAllowDev = process.env.ALLOW_DEV_WITHOUT_SUPABASE;
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const headers = {
    authorization: "Bearer dev-token",
    "x-dev-auth-user-id": "auth_business_user_1",
    "x-dev-auth-email": "biz.user@example.com"
  };
  try {
    await work(headers);
  } finally {
    if (previousAllowDev === undefined) delete process.env.ALLOW_DEV_WITHOUT_SUPABASE;
    else process.env.ALLOW_DEV_WITHOUT_SUPABASE = previousAllowDev;
  }
};

const seedApprovedBusinessUser = (state: ReturnType<typeof createInitialState>): void => {
  const now = new Date().toISOString();
  state.businessUserProfiles.push({
    id: "profile_biz_1",
    tenantId: state.tenantId,
    authUserId: "auth_business_user_1",
    email: "biz.user@example.com",
    role: "business_user",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  state.businessOnboardingApplications.push({
    id: "application_biz_1",
    tenantId: state.tenantId,
    authUserId: "auth_business_user_1",
    email: "biz.user@example.com",
    currentStep: "step_4",
    status: "approved",
    submittedAt: now,
    createdAt: now,
    updatedAt: now
  });
  state.businessClients.push({
    id: "client_biz_1",
    tenantId: state.tenantId,
    legalName: "Vanguard Digital Asset Ltd",
    country: "US",
    onboardingStatus: "approved",
    createdAt: now
  });
};

const withMockBusinessAuth = async (work: () => Promise<void>): Promise<void> => {
  const previousSecret = process.env.BUSINESS_AUTH_JWT_SECRET;
  const previousExpiry = process.env.BUSINESS_AUTH_JWT_EXPIRES_IN_SECONDS;
  const previousRefreshExpiry = process.env.BUSINESS_AUTH_JWT_REFRESH_EXPIRES_IN_SECONDS;
  process.env.BUSINESS_AUTH_JWT_SECRET = "test-business-auth-secret";
  process.env.BUSINESS_AUTH_JWT_EXPIRES_IN_SECONDS = "3600";
  process.env.BUSINESS_AUTH_JWT_REFRESH_EXPIRES_IN_SECONDS = "604800";

  let refreshSequence = 1;
  const authUserId = "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83";
  const email = "ops@acme-trading.com";

  setSupabaseBusinessAuthClientForTest({
    inviteUserByEmail: async () => ({ data: { user: { id: authUserId } }, error: null }),
    signInWithPassword: async ({ email: signInEmail, password }) => {
      if (signInEmail !== email || password !== "S3curePass!2026") {
        return { data: { session: null }, error: { message: "invalid login" } };
      }
      return {
        data: {
          session: {
            access_token: "sb-access-1",
            refresh_token: "sb-refresh-1",
            token_type: "bearer",
            expires_in: 3600,
            user: {
              id: authUserId,
              email
            }
          }
        },
        error: null
      };
    },
    refreshSession: async (refreshToken) => {
      if (!refreshToken.startsWith("sb-refresh-")) {
        return { data: { session: null }, error: { message: "invalid refresh token" } };
      }
      refreshSequence += 1;
      return {
        data: {
          session: {
            access_token: `sb-access-${refreshSequence}`,
            refresh_token: `sb-refresh-${refreshSequence}`,
            token_type: "bearer",
            expires_in: 3600,
            user: {
              id: authUserId,
              email
            }
          }
        },
        error: null
      };
    },
    signOutSession: async () => ({ error: null }),
    getUser: async () => ({ data: { user: { id: authUserId, email } }, error: null }),
    updateUserById: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ error: null })
  });
  resetBusinessAuthSessionsForTest();

  try {
    await work();
  } finally {
    resetBusinessAuthSessionsForTest();
    setSupabaseBusinessAuthClientForTest(undefined);
    if (previousSecret === undefined) delete process.env.BUSINESS_AUTH_JWT_SECRET;
    else process.env.BUSINESS_AUTH_JWT_SECRET = previousSecret;
    if (previousExpiry === undefined) delete process.env.BUSINESS_AUTH_JWT_EXPIRES_IN_SECONDS;
    else process.env.BUSINESS_AUTH_JWT_EXPIRES_IN_SECONDS = previousExpiry;
    if (previousRefreshExpiry === undefined) delete process.env.BUSINESS_AUTH_JWT_REFRESH_EXPIRES_IN_SECONDS;
    else process.env.BUSINESS_AUTH_JWT_REFRESH_EXPIRES_IN_SECONDS = previousRefreshExpiry;
  }
};

test("business auth sign-in enables protected route access and sign-out revocation", async () => {
  await withMockBusinessAuth(async () => {
    const state = createInitialState();

    const signIn = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/auth/sign-in",
      body: {
        email: "ops@acme-trading.com",
        password: "S3curePass!2026"
      }
    });

    assert.equal(signIn.status, 200);
    const signInSession = (signIn.body as { session: { access_token: string; refresh_token: string } }).session;
    assert.equal(typeof signInSession.access_token, "string");
    assert.equal(typeof signInSession.refresh_token, "string");

    const onboarding = await handleApiRequest(state, {
      method: "GET",
      pathname: "/onboarding/me",
      headers: {
        authorization: `Bearer ${signInSession.access_token}`
      }
    });
    assert.equal(onboarding.status, 200);

    const signOut = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/auth/sign-out",
      headers: {
        authorization: `Bearer ${signInSession.access_token}`
      }
    });
    assert.equal(signOut.status, 200);

    const meAfterSignOut = await handleApiRequest(state, {
      method: "GET",
      pathname: "/business/auth/me",
      headers: {
        authorization: `Bearer ${signInSession.access_token}`
      }
    });
    assert.equal(meAfterSignOut.status, 401);
  });
});

test("business auth refresh rotates access token and invalidates prior token", async () => {
  await withMockBusinessAuth(async () => {
    const state = createInitialState();

    const signIn = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/auth/sign-in",
      body: {
        email: "ops@acme-trading.com",
        password: "S3curePass!2026"
      }
    });
    assert.equal(signIn.status, 200);
    const initialSession = (signIn.body as { session: { access_token: string; refresh_token: string } }).session;

    const refresh = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/auth/refresh",
      body: {
        refreshToken: initialSession.refresh_token
      }
    });
    assert.equal(refresh.status, 200);

    const refreshedSession = (refresh.body as { session: { access_token: string; refresh_token: string } }).session;
    assert.notEqual(refreshedSession.access_token, initialSession.access_token);
    assert.notEqual(refreshedSession.refresh_token, initialSession.refresh_token);

    const oldMe = await handleApiRequest(state, {
      method: "GET",
      pathname: "/business/auth/me",
      headers: {
        authorization: `Bearer ${initialSession.access_token}`
      }
    });
    assert.equal(oldMe.status, 401);

    const newMe = await handleApiRequest(state, {
      method: "GET",
      pathname: "/business/auth/me",
      headers: {
        authorization: `Bearer ${refreshedSession.access_token}`
      }
    });
    assert.equal(newMe.status, 200);
  });
});

test("route metadata keeps /webhooks/circle public for HEAD and POST", () => {
  assert.equal(routeMetadata("POST", "/webhooks/circle").public, true);
  assert.equal(routeMetadata("HEAD", "/webhooks/circle").public, true);
  assert.equal(routeMetadata("HEAD", "/webhooks/circle/").public, true);
});

test("route metadata keeps OpenAPI docs endpoints public", () => {
  assert.equal(routeMetadata("GET", "/openapi").public, true);
  assert.equal(routeMetadata("GET", "/openapi/business-client.json").public, true);
  assert.equal(routeMetadata("GET", "/openapi/business-client.yaml").public, true);
  assert.equal(routeMetadata("GET", "/openapi/gtt-service.json").public, true);
  assert.equal(routeMetadata("GET", "/openapi/gtt-service.yaml").public, true);
});

test("OpenAPI docs endpoints return business and service contracts", async () => {
  const state = createInitialState();
  const index = await handleApiRequest(state, {
    method: "GET",
    pathname: "/openapi"
  });
  assert.equal(index.status, 200);

  const business = await handleApiRequest(state, {
    method: "GET",
    pathname: "/openapi/business-client.json"
  });
  assert.equal(business.status, 200);
  assert.equal((business.body as { info: { title: string } }).info.title, "Global Trade Treasury Business Client API");
  const businessTaxonomy = (business.body as {
    "x-gtt-transfer-taxonomy"?: { transferTypeEnum?: string[]; transferSubtypeEnum?: string[] };
  })["x-gtt-transfer-taxonomy"];
  assert.deepEqual(businessTaxonomy?.transferTypeEnum, ["funding_instruction", "transfer_instruction", "payment_instruction"]);
  assert.deepEqual(businessTaxonomy?.transferSubtypeEnum, ["transfer_instruction", "payment_instruction"]);

  const service = await handleApiRequest(state, {
    method: "GET",
    pathname: "/openapi/gtt-service.json"
  });
  assert.equal(service.status, 200);
  assert.equal((service.body as { info: { title: string } }).info.title, "Global Trade Treasury Service API");
  const serviceTaxonomy = (service.body as {
    "x-gtt-transfer-taxonomy"?: { transferTypeEnum?: string[]; transferSubtypeEnum?: string[] };
  })["x-gtt-transfer-taxonomy"];
  assert.deepEqual(serviceTaxonomy?.transferTypeEnum, ["funding_instruction", "transfer_instruction", "payment_instruction"]);
  assert.deepEqual(serviceTaxonomy?.transferSubtypeEnum, ["transfer_instruction", "payment_instruction"]);

  const businessYamlAlias = await handleApiRequest(state, {
    method: "GET",
    pathname: "/openapi/business-client.yaml"
  });
  assert.equal(businessYamlAlias.status, 200);

  const serviceYamlAlias = await handleApiRequest(state, {
    method: "GET",
    pathname: "/openapi/gtt-service.yaml"
  });
  assert.equal(serviceYamlAlias.status, 200);
});

test("route metadata keeps Sprint 7-2 business account and API key endpoints public", () => {
  assert.equal(routeMetadata("GET", "/business/accounts-of-digital-asset").public, true);
  assert.equal(routeMetadata("POST", "/business/accounts-of-digital-asset").public, true);
  assert.equal(routeMetadata("GET", "/business/api-keys").public, true);
  assert.equal(routeMetadata("POST", "/business/api-keys").public, true);
});

test("business account aliases create/list/get with activation decision payload", async () => {
  await withDevBusinessAuth(async (headers) => {
    const state = createInitialState();
    seedApprovedBusinessUser(state);

    const created = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/accounts-of-digital-asset",
      headers,
      body: {
        accountName: "Settlement Reserve",
        usePurpose: "settlement",
        topology: "unlinked"
      }
    });

    assert.equal(created.status, 201);
    const createdBody = created.body as { account: { activationDecision: string; activationReasonCode: string; id: string } };
    assert.equal(createdBody.account.activationDecision, "auto");
    assert.equal(createdBody.account.activationReasonCode, "virtual_no_linked_instrument_auto_activation");

    const listed = await handleApiRequest(state, {
      method: "GET",
      pathname: "/business/accounts-of-digital-asset",
      headers
    });
    assert.equal(listed.status, 200);
    const accounts = (listed.body as { accounts: Array<{ id: string }> }).accounts;
    assert.equal(accounts.some((item) => item.id === createdBody.account.id), true);

    const detail = await handleApiRequest(state, {
      method: "GET",
      pathname: `/business/accounts-of-digital-asset/${createdBody.account.id}`,
      headers
    });
    assert.equal(detail.status, 200);
  });
});

test("business API keys allow ada.open and reject forbidden wildcard scopes", async () => {
  await withDevBusinessAuth(async (headers) => {
    const state = createInitialState();
    seedApprovedBusinessUser(state);

    const created = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/api-keys",
      headers,
      body: {
        scopes: ["ada.read", "ada.open", "payment-instruction.read"]
      }
    });

    assert.equal(created.status, 201);
    const createdBody = created.body as { key: { id: string; scopes: string[] }; plaintextKey: string };
    assert.equal(createdBody.key.scopes.includes("ada.open"), true);
    assert.equal(typeof createdBody.plaintextKey, "string");

    const list = await handleApiRequest(state, {
      method: "GET",
      pathname: "/business/api-keys",
      headers
    });
    assert.equal(list.status, 200);
    const keys = (list.body as { keys: Array<{ id: string }> }).keys;
    assert.equal(keys.some((item) => item.id === createdBody.key.id), true);

    const revoked = await handleApiRequest(state, {
      method: "POST",
      pathname: `/business/api-keys/${createdBody.key.id}/revoke`,
      headers,
      body: {}
    });
    assert.equal(revoked.status, 200);

    const forbidden = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/api-keys",
      headers,
      body: {
        scopes: ["internal.operations.*"]
      }
    });
    assert.equal(forbidden.status, 400);
    assert.deepEqual(forbidden.body, { error: "business_scope_forbidden" });
  });
});

test("internal approval queue lists pending_activation and approve/reject require reason fields", async () => {
  await withDevBusinessAuth(async (headers) => {
    const state = createInitialState();
    seedApprovedBusinessUser(state);

    const created = await handleApiRequest(state, {
      method: "POST",
      pathname: "/business/accounts-of-digital-asset",
      headers,
      body: {
        accountName: "Fiat Linked ADA",
        usePurpose: "settlement",
        topology: "fiat-linked"
      }
    });
    const createdBody = created.body as { account: { id: string; status: string } };
    assert.equal(createdBody.account.status, "pending_activation");

    const queue = await handleApiRequest(state, {
      method: "GET",
      pathname: "/internal/operations/accounts-of-digital-asset/pending-approval",
      body: {}
    });
    assert.equal(queue.status, 200);
    const queuedAccounts = (queue.body as { accounts: Array<{ id: string }> }).accounts;
    assert.equal(queuedAccounts.some((item) => item.id === createdBody.account.id), true);

    const missingReason = await handleApiRequest(state, {
      method: "POST",
      pathname: `/internal/operations/accounts-of-digital-asset/${createdBody.account.id}/approve`,
      body: {}
    });
    assert.equal(missingReason.status, 400);
    assert.deepEqual(missingReason.body, { error: "reason_code_required" });

    const approved = await handleApiRequest(state, {
      method: "POST",
      pathname: `/internal/operations/accounts-of-digital-asset/${createdBody.account.id}/approve`,
      body: {
        reasonCode: "policy_verification_complete",
        reasonNote: "Approved by internal operator"
      }
    });
    assert.equal(approved.status, 200);
    assert.equal((approved.body as { approvalDecision: string }).approvalDecision, "approved");
  });
});

test("route metadata keeps internal credential reset public", () => {
  assert.equal(routeMetadata("POST", "/internal-access/forgot-credentials").public, true);
  assert.equal(routeMetadata("POST", "/internal-access/forgot-credentials/").public, true);
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
