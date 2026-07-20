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
  } finally {
    restoreEnv("DATABASE_URL", previousDatabaseUrl);
    restoreEnv("SUPABASE_URL", previousSupabaseUrl);
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
