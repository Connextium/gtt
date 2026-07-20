import assert from "node:assert/strict";
import test from "node:test";
import type pg from "pg";
import { createInitialState } from "../../../src/data.js";
import { setPostgresPoolForTest } from "../../../src/db/transaction.js";
import {
  handleGetOrCreateMyOnboarding,
  handleSaveMyOnboardingStep,
  handleSelfRegistrationInvitation,
  handleSubmitMyOnboarding,
  isValidEmail,
  normalizeEmail
} from "../../../src/modules/client-onboarding/self-registration.js";

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
