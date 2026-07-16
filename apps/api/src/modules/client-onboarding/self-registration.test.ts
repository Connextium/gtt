import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../data.js";
import {
  handleGetOrCreateMyOnboarding,
  handleSaveMyOnboardingStep,
  handleSelfRegistrationInvitation,
  handleSubmitMyOnboarding,
  isValidEmail,
  normalizeEmail
} from "./self-registration.js";

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
