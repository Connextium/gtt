import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../../src/data.js";
import {
  decideBusinessOnboardingApplication,
  listBusinessOnboardingApplications
} from "../../../src/db/business-onboarding-review-store.js";
import { handleApiRequest } from "../../../src/http/router.js";

test("lists business onboarding applications with saved payload detail", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;

  try {
    const state = createStateWithSubmittedApplication();
    const records = await listBusinessOnboardingApplications(state);

    assert.equal(records.length, 1);
    assert.equal(records[0]?.application.status, "pending_review");
    assert.equal(records[0]?.stepPayloads.step_2?.legalBusinessName, "Nue Luo Treasury LLC");
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SUPABASE_URL", previousSupabaseUrl);
  }
});

test("approves business onboarding application and synchronizes business client", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;

  try {
    const state = createStateWithSubmittedApplication();
    const result = await decideBusinessOnboardingApplication(state, {
      action: "approved",
      actorEmail: "admin@gtt.example",
      applicationId: "business_onboarding_application_app_001",
      note: "KYB evidence accepted."
    });

    assert.equal(result?.application.status, "approved");
    assert.equal(result?.application.currentStep, "reviewd");
    assert.equal(state.businessClients.some((client) => client.legalName === "Nue Luo Treasury LLC" && client.onboardingStatus === "approved"), true);
    assert.equal(result?.circleKybEvidence[0]?.providerStatus, "approved");
    assert.equal(Boolean(result?.businessClient?.circleApplicationId), true);
    assert.equal(result?.statusEvents[0]?.nextStatus, "approved");
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SUPABASE_URL", previousSupabaseUrl);
  }
});

test("approve review endpoint returns the approved onboarding application", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;

  try {
    const state = createStateWithSubmittedApplication();
    const result = await handleApiRequest(state, {
      method: "POST",
      pathname: "/admin/business-onboarding/applications/business_onboarding_application_app_001/approve",
      body: {
        actorEmail: "admin@gtt.example",
        note: "Approved from route test."
      }
    });

    assert.equal(result.status, 200);
    const body = result.body as {
      application?: {
        application?: {
          status?: string;
          currentStep?: string;
        };
      };
    };
    assert.equal(body.application?.application?.status, "approved");
    assert.equal(body.application?.application?.currentStep, "reviewd");
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SUPABASE_URL", previousSupabaseUrl);
  }
});

test("records request for information status in fallback state", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;

  try {
    const state = createStateWithSubmittedApplication();
    const result = await decideBusinessOnboardingApplication(state, {
      action: "requested_information",
      actorEmail: "admin@gtt.example",
      applicationId: "business_onboarding_application_app_001",
      note: "Upload ownership chart.",
      requestedFields: ["Ownership chart"]
    });

    assert.equal(result?.application.status, "needs_information");
    assert.equal(result?.reviewActions[0]?.requestedFields[0], "Ownership chart");
    assert.equal(result?.rfiTasks[0]?.status, "open");
    assert.equal(result?.statusEvents[0]?.nextStatus, "needs_information");
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SUPABASE_URL", previousSupabaseUrl);
  }
});

test("business user can respond to open RFI from existing onboarding flow", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousDev = process.env.ALLOW_DEV_WITHOUT_SUPABASE;
  delete process.env.DATABASE_URL;
  delete process.env.SUPABASE_URL;
  process.env.ALLOW_DEV_WITHOUT_SUPABASE = "true";

  try {
    const state = createInitialState();
    const now = new Date().toISOString();
    const authUserId = "00000000-0000-4000-8000-000000000301";
    state.businessUserProfiles.push({
      id: "business_user_profile_00000000-0000-4000-8000-000000000302",
      tenantId: state.tenantId,
      authUserId,
      email: "client@gtt.example",
      role: "business_user",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    state.businessOnboardingApplications.push({
      id: "business_onboarding_application_00000000-0000-4000-8000-000000000303",
      tenantId: state.tenantId,
      authUserId,
      email: "client@gtt.example",
      currentStep: "pending_review",
      status: "needs_information",
      submittedAt: now,
      createdAt: now,
      updatedAt: now
    });
    state.onboardingRfiTasks.push({
      id: "onboarding_rfi_task_00000000-0000-4000-8000-000000000304",
      tenantId: state.tenantId,
      applicationId: "business_onboarding_application_00000000-0000-4000-8000-000000000303",
      status: "open",
      requestedFields: ["Target Section: Beneficial Ownership", "Priority: Urgent"],
      note: "Upload revised ownership chart.",
      requesterEmail: "compliance@gtt.example",
      createdAt: now,
      updatedAt: now
    });

    const result = await handleApiRequest(state, {
      method: "POST",
      pathname: "/onboarding/me/rfi-response",
      headers: {
        authorization: "Bearer dev",
        "x-dev-auth-user-id": authUserId,
        "x-dev-auth-email": "client@gtt.example"
      },
      body: { response: "Uploaded revised ownership chart." }
    });

    assert.equal(result.status, 200);
    const body = result.body as { rfiTasks?: Array<{ status?: string }> };
    assert.equal(state.businessOnboardingApplications[0]?.status, "pending_review");
    assert.equal(state.onboardingStepPayloads.some((payload) => payload.stepKey === "rfi_response"), true);
    assert.equal(body.rfiTasks?.[0]?.status, "responded");
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SUPABASE_URL", previousSupabaseUrl);
    restoreEnv("ALLOW_DEV_WITHOUT_SUPABASE", previousDev);
  }
});

const createStateWithSubmittedApplication = () => {
  const state = createInitialState();
  const now = new Date().toISOString();
  state.businessOnboardingApplications.push({
    id: "business_onboarding_application_app_001",
    tenantId: "tenant_demo",
    authUserId: "auth_business_001",
    email: "nueluolewis@gmail.com",
    currentStep: "pending_review",
    status: "pending_review",
    submittedAt: now,
    createdAt: now,
    updatedAt: now
  });
  state.onboardingStepPayloads.push({
    id: "onboarding_step_payload_001",
    tenantId: "tenant_demo",
    applicationId: "business_onboarding_application_app_001",
    stepKey: "step_2",
    payload: {
      legalBusinessName: "Nue Luo Treasury LLC",
      formationCountry: "United States",
      taxId: "12-3456789"
    },
    savedAt: now
  });
  return state;
};

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
};
