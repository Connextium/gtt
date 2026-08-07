import { type OnboardingDraftPayload } from "./types.js";

export function formToPayload(form: HTMLFormElement): OnboardingDraftPayload {
  const payload: OnboardingDraftPayload = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value !== "string") continue;
    const existing = payload[key];
    if (Array.isArray(existing)) {
      existing.push(value);
    } else if (typeof existing === "string") {
      payload[key] = [existing, value];
    } else {
      payload[key] = value;
    }
  }
  return payload;
}

export function loadOnboardingDraft(stepKey: string): OnboardingDraftPayload {
  const raw = sessionStorage.getItem(draftStorageKey(stepKey));
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as OnboardingDraftPayload;
  } catch {
    return {};
  }
}

export function saveOnboardingDraft(stepKey: string, payload: OnboardingDraftPayload): void {
  sessionStorage.setItem(draftStorageKey(stepKey), JSON.stringify(payload));
}

export function draftString(draft: OnboardingDraftPayload, key: string, fallback = ""): string {
  const value = draft[key];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function draftArray(draft: OnboardingDraftPayload, key: string): string[] {
  const value = draft[key];
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function draftStorageKey(stepKey: string): string {
  return `gtt_onboarding_draft_${stepKey}`;
}
