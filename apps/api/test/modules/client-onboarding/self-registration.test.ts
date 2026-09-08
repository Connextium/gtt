import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { createInitialState } from "../../../src/data.js";
import { setPostgresPoolForTest } from "../../../src/db/transaction.js";
import {
  authenticateBusinessUserOrApiKey,
  handleBusinessAuthMe,
  handleBusinessAuthSignIn,
  handleBusinessAuthSignOut,
  handleCreateMyApiKey,
  handleGetOrCreateMyOnboarding,
  handleRevokeMyApiKey,
  handleSaveMyOnboardingStep,
  handleSelfRegistrationInvitation,
  handleSubmitMyOnboarding,
  isValidEmail,
  normalizeEmail,
  resetBusinessAuthSessionsForTest,
  setSupabaseBusinessAuthClientForTest
} from "../../../src/modules/client-onboarding/self-registration.js";

const seedApprovedBusinessContext = (
  state: ReturnType<typeof createInitialState>,
  authUserId: string,
  email: string,
  businessClientId: string
): void => {
  const now = new Date().toISOString();
  state.businessUserProfiles.push({
    id: `profile_${authUserId}`,
    tenantId: state.tenantId,
    authUserId,
    email,
    role: "business_user",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  state.businessOnboardingApplications.push({
    id: `application_${authUserId}`,
    tenantId: state.tenantId,
    authUserId,
    email,
    currentStep: "step_4",
    status: "approved",
    submittedAt: now,
    createdAt: now,
    updatedAt: now
  });
  state.businessClients.push({
    id: businessClientId,
    tenantId: state.tenantId,
    legalName: `Client ${authUserId}`,
    country: "US",
    onboardingStatus: "approved",
    createdAt: now
  });
};

test("normalizes and validates business registration email", () => {
  assert.equal(normalizeEmail(" Finance@Example.COM "), "finance@example.com");
  assert.equal(isValidEmail("finance@example.com"), true);
  assert.equal(isValidEmail("finance"), false);
});

test("creates invitation in development fallback mode", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const result = await handleSelfRegistrationInvitation(state, {
    email: "Finance@Example.com",
    headers: { "x-forwarded-for": "127.0.0.1" }
  });

  assert.equal(result.status, 200);
  assert.equal(state.businessOnboardingInvitations.length, 1);
  assert.equal(state.businessOnboardingInvitations[0]?.email, "finance@example.com");
  assert.equal(state.businessOnboardingInvitations[0]?.status, "sent");
});

test("creates authenticated user profile and onboarding draft", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const result = await handleGetOrCreateMyOnboarding(state, {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "finance@example.com",
    "x-dev-auth-user-id": "auth_user_1"
  });

  assert.equal(result.status, 200);
  assert.equal(state.businessUserProfiles.length, 1);
  assert.equal(state.businessOnboardingApplications[0]?.currentStep, "step_1");
  assert.equal(state.businessOnboardingApplications[0]?.status, "draft");
});

test("submits authenticated onboarding to pending review", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const result = await handleSubmitMyOnboarding(state, {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "finance@example.com",
    "x-dev-auth-user-id": "auth_user_1"
  });

  assert.equal(result.status, 200);
  assert.equal(state.businessOnboardingApplications[0]?.status, "pending_review");
  assert.equal(state.businessOnboardingApplications[0]?.currentStep, "pending_review");
  assert.equal(state.businessClients.some((client) => client.legalName === "finance" && client.onboardingStatus === "submitted"), true);
});

test("stores authenticated onboarding step payload before submission", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const headers = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "finance@example.com",
    "x-dev-auth-user-id": "auth_user_1"
  };

  const saveResult = await handleSaveMyOnboardingStep(state, {
    headers,
    stepKey: "step_4",
    payload: {
      treasuryUseCase: "USDC settlement",
      expectedMonthlyVolume: "250000"
    }
  });
  const submitResult = await handleSubmitMyOnboarding(state, headers);

  assert.equal(saveResult.status, 200);
  assert.equal(submitResult.status, 200);
  assert.equal(state.onboardingStepPayloads.length, 1);
  assert.equal(state.onboardingStepPayloads[0]?.stepKey, "step_4");
  assert.deepEqual(state.onboardingStepPayloads[0]?.payload, {
    treasuryUseCase: "USDC settlement",
    expectedMonthlyVolume: "250000"
  });
  assert.equal(state.businessOnboardingApplications[0]?.status, "pending_review");
});

test("submitted onboarding creates business client from saved business profile", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const headers = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "client@example.com",
    "x-dev-auth-user-id": "auth_user_1"
  };

  await handleGetOrCreateMyOnboarding(state, headers);
  await handleSaveMyOnboardingStep(state, {
    headers,
    stepKey: "step_3",
    payload: {
      completedStepKey: "step_2",
      legalBusinessName: "Example Trading LLC",
      formationCountry: "Singapore"
    }
  });
  const result = await handleSubmitMyOnboarding(state, headers);

  assert.equal(result.status, 200);
  const createdClient = state.businessClients.find((client) => client.legalName === "Example Trading LLC");
  assert.equal(createdClient?.country, "SG");
  assert.equal(createdClient?.onboardingStatus, "submitted");
  assert.equal((result.body as { businessClient: { legalName: string } }).businessClient.legalName, "Example Trading LLC");
});

test("submitted onboarding persists business client through direct database connection", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousTenant = process.env.GTT_PLATFORM_TENANT_ID;
  const previousAllowDev = process.env.ALLOW_DEV_WITHOUT_SUPABASE;
  process.env.DATABASE_URL = "postgresql://unit-test";
  process.env.GTT_PLATFORM_TENANT_ID = "00000000-0000-4000-8000-000000000001";
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const queries: string[] = [];
  setPostgresPoolForTest({
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
      release: () => undefined
    })
  } as unknown as pg.Pool);
  try {
    const state = createInitialState();
    const headers = {
      authorization: "Bearer dev-token",
      "x-dev-auth-email": "db-client@example.com",
      "x-dev-auth-user-id": "00000000-0000-4000-8000-000000000111"
    };

    await handleGetOrCreateMyOnboarding(state, headers);
    await handleSaveMyOnboardingStep(state, {
      headers,
      stepKey: "step_3",
      payload: {
        completedStepKey: "step_2",
        legalBusinessName: "Database Client LLC",
        formationCountry: "United Kingdom"
      }
    });
    const result = await handleSubmitMyOnboarding(state, headers);

    assert.equal(result.status, 200);
    assert.equal(queries.some((sql) => sql.includes("insert into platform_tenants")), true);
    assert.equal(queries.some((sql) => sql.includes("insert into business_clients")), true);
    assert.equal(state.businessClients.find((client) => client.legalName === "Database Client LLC")?.country, "GB");
  } finally {
    setPostgresPoolForTest(undefined);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousTenant === undefined) delete process.env.GTT_PLATFORM_TENANT_ID;
    else process.env.GTT_PLATFORM_TENANT_ID = previousTenant;
    if (previousAllowDev === undefined) delete process.env.ALLOW_DEV_WITHOUT_SUPABASE;
    else process.env.ALLOW_DEV_WITHOUT_SUPABASE = previousAllowDev;
  }
});

test("advances onboarding current step for resume navigation", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const headers = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "finance@example.com",
    "x-dev-auth-user-id": "auth_user_1"
  };

  await handleGetOrCreateMyOnboarding(state, headers);
  const result = await handleSaveMyOnboardingStep(state, {
    headers,
    stepKey: "step_2",
    payload: {
      completedStepKey: "step_1",
      completedFrom: "step-1",
      acknowledgedFramework: true
    }
  });

  assert.equal(result.status, 200);
  assert.equal(state.businessOnboardingApplications[0]?.currentStep, "step_2");
  assert.equal(state.businessOnboardingApplications[0]?.status, "draft");
  assert.equal(state.onboardingStepPayloads[0]?.stepKey, "step_1");
});

test("returns saved onboarding step payloads for persisted resume", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  const headers = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "finance@example.com",
    "x-dev-auth-user-id": "auth_user_1"
  };

  await handleGetOrCreateMyOnboarding(state, headers);
  await handleSaveMyOnboardingStep(state, {
    headers,
    stepKey: "step_3",
    payload: {
      completedStepKey: "step_2",
      legalBusinessName: "Example Trading LLC"
    }
  });
  const result = await handleGetOrCreateMyOnboarding(state, headers);

  assert.equal(result.status, 200);
  const body = result.body as { stepPayloads?: Record<string, Record<string, unknown>> };
  assert.equal(body.stepPayloads?.step_2?.legalBusinessName, "Example Trading LLC");
});

test("authenticates a business API key from Authorization bearer with required scope", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  seedApprovedBusinessContext(state, "auth_business_user_1", "biz.user@example.com", "client_biz_1");
  const userHeaders = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "biz.user@example.com",
    "x-dev-auth-user-id": "auth_business_user_1"
  };

  const created = await handleCreateMyApiKey(state, {
    headers: userHeaders,
    payload: { scopes: ["payment-instruction.read"] }
  });
  assert.equal(created.status, 201);
  const plaintextKey = (created.body as { plaintextKey: string }).plaintextKey;

  const auth = await authenticateBusinessUserOrApiKey({
    authorization: `Bearer ${plaintextKey}`
  }, ["payment-instruction.read"]);

  assert.ok(auth);
  assert.equal(auth?.authUserId, "auth_business_user_1");
});

test("authenticates a business API key from X-GTT-API-Key header", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  seedApprovedBusinessContext(state, "auth_business_user_2", "biz.user@example.com", "client_biz_2");
  const userHeaders = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "biz.user@example.com",
    "x-dev-auth-user-id": "auth_business_user_2"
  };

  const created = await handleCreateMyApiKey(state, {
    headers: userHeaders,
    payload: { scopes: ["payment-instruction.read"] }
  });
  const plaintextKey = (created.body as { plaintextKey: string }).plaintextKey;

  const auth = await authenticateBusinessUserOrApiKey({
    "x-gtt-api-key": plaintextKey
  }, ["payment-instruction.read"]);

  assert.ok(auth);
  assert.equal(auth?.authUserId, "auth_business_user_2");
});

test("rejects business API key when required scope is missing or key is revoked", async () => {
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";
  const state = createInitialState();
  seedApprovedBusinessContext(state, "auth_business_user_3", "biz.user@example.com", "client_biz_3");
  const userHeaders = {
    authorization: "Bearer dev-token",
    "x-dev-auth-email": "biz.user@example.com",
    "x-dev-auth-user-id": "auth_business_user_3"
  };

  const created = await handleCreateMyApiKey(state, {
    headers: userHeaders,
    payload: { scopes: ["payment-instruction.read"] }
  });
  const createdBody = created.body as { key: { id: string }; plaintextKey: string };

  const missingScopeAuth = await authenticateBusinessUserOrApiKey({
    authorization: `Bearer ${createdBody.plaintextKey}`
  }, ["payment-instruction.create"]);
  assert.equal(missingScopeAuth, undefined);

  const revoked = await handleRevokeMyApiKey(state, {
    headers: userHeaders,
    apiKeyId: createdBody.key.id
  });
  assert.equal(revoked.status, 200);

  const revokedAuth = await authenticateBusinessUserOrApiKey({
    authorization: `Bearer ${createdBody.plaintextKey}`
  }, ["payment-instruction.read"]);
  assert.equal(revokedAuth, undefined);
});

test("business auth session persists to Postgres and survives runtime session reset", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.BUSINESS_AUTH_JWT_SECRET;
  process.env.DATABASE_URL = "postgresql://unit-test";
  process.env.BUSINESS_AUTH_JWT_SECRET = "test-business-auth-secret";

  type StoredSession = {
    session_id: string;
    auth_user_id: string;
    email: string;
    access_jti: string;
    refresh_jti: string;
    access_expires_at: Date;
    refresh_expires_at: Date;
    supabase_access_token: string;
    supabase_refresh_token?: string;
    revoked_at: Date | null;
  };
  const sessions = new Map<string, StoredSession>();

  setPostgresPoolForTest({
    connect: async () => ({
      query: async (sql: string, values?: unknown[]) => {
        if (sql === "begin" || sql === "commit" || sql === "rollback") return { rows: [] };

        if (sql.includes("insert into business_auth_sessions")) {
          const row: StoredSession = {
            session_id: String(values?.[0]),
            auth_user_id: String(values?.[1]),
            email: String(values?.[2]),
            access_jti: String(values?.[3]),
            access_expires_at: new Date(Number(values?.[4])),
            refresh_jti: String(values?.[5]),
            refresh_expires_at: new Date(Number(values?.[6])),
            supabase_access_token: String(values?.[7]),
            supabase_refresh_token: typeof values?.[8] === "string" ? values[8] : undefined,
            revoked_at: null
          };
          sessions.set(row.session_id, row);
          return { rows: [] };
        }

        if (sql.includes("where access_jti = $1")) {
          const accessJti = String(values?.[0]);
          const found = [...sessions.values()].find((session) => session.access_jti === accessJti);
          return { rows: found ? [found] : [] };
        }

        if (sql.includes("update business_auth_sessions")) {
          const sessionId = String(values?.[0]);
          const existing = sessions.get(sessionId);
          if (existing) existing.revoked_at = new Date();
          return { rows: [] };
        }

        return { rows: [] };
      },
      release: () => undefined
    })
  } as unknown as pg.Pool);

  setSupabaseBusinessAuthClientForTest({
    inviteUserByEmail: async () => ({ data: { user: { id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83" } }, error: null }),
    signInWithPassword: async () => ({
      data: {
        session: {
          access_token: "sb-access-1",
          refresh_token: "sb-refresh-1",
          token_type: "bearer",
          expires_in: 3600,
          user: {
            id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83",
            email: "ops@acme-trading.com"
          }
        }
      },
      error: null
    }),
    refreshSession: async () => ({ data: { session: null }, error: { message: "not used" } }),
    signOutSession: async () => ({ error: null }),
    getUser: async () => ({ data: { user: { id: "9f7b9f57-0af0-4f1a-b1eb-31c7ec9f2c83", email: "ops@acme-trading.com" } }, error: null }),
    updateUserById: async () => ({ error: null }),
    resetPasswordForEmail: async () => ({ error: null })
  });

  try {
    const signIn = await handleBusinessAuthSignIn({
      email: "ops@acme-trading.com",
      password: "S3curePass!2026"
    });
    assert.equal(signIn.status, 200);
    const accessToken = (signIn.body as { session: { access_token: string } }).session.access_token;

    resetBusinessAuthSessionsForTest();

    const me = await handleBusinessAuthMe({
      authorization: `Bearer ${accessToken}`
    });
    assert.equal(me.status, 200);

    const signOut = await handleBusinessAuthSignOut({
      authorization: `Bearer ${accessToken}`
    });
    assert.equal(signOut.status, 200);

    const afterSignOut = await handleBusinessAuthMe({
      authorization: `Bearer ${accessToken}`
    });
    assert.equal(afterSignOut.status, 401);
  } finally {
    setSupabaseBusinessAuthClientForTest(undefined);
    resetBusinessAuthSessionsForTest();
    setPostgresPoolForTest(undefined);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousSecret === undefined) delete process.env.BUSINESS_AUTH_JWT_SECRET;
    else process.env.BUSINESS_AUTH_JWT_SECRET = previousSecret;
  }
});
