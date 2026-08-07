import { apiRequest } from "../shared/apiClient.js";
import { saveOnboardingDraft } from "./draftUtils.js";
import {
  type MyOnboardingResponse,
  type OnboardingApplication,
  type OnboardingDraftPayload,
  type OnboardingStepKey
} from "./types.js";

export async function nextOnboardingRoute(token: string): Promise<string> {
  const result = await apiRequest<MyOnboardingResponse>("/onboarding/me", { token });
  restorePersistedStepPayloads(result.stepPayloads);
  return routeForApplication(result.application);
}

export function restorePersistedStepPayloads(stepPayloads?: Record<string, OnboardingDraftPayload>): void {
  if (!stepPayloads) return;
  for (const [stepKey, payload] of Object.entries(stepPayloads)) {
    saveOnboardingDraft(stepKey, payload);
  }
}

export function routeForApplication(application: OnboardingApplication): string {
  if (application.status === "approved") return "/welcome";
  if (application.status === "rejected") return "/application-pending";
  if (
    application.status === "pending_review" ||
    application.status === "needs_information" ||
    application.currentStep === "pending_review"
  ) {
    return "/application-pending";
  }
  return `/onboarding/step-${onboardingStepNumber(application.currentStep)}`;
}

export function onboardingStepNumber(step: OnboardingStepKey): number {
  const parsed = Number(step.match(/^step_(\d)$/)?.[1] ?? "1");
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 1), 4);
}
