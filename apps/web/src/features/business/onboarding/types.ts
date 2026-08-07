export type OnboardingStatus = "draft" | "submitted" | "pending_review" | "needs_information" | "approved" | "rejected";
export type OnboardingStepKey = "step_1" | "step_2" | "step_3" | "step_4" | "pending_review" | "reviewd";
export type OnboardingDraftPayload = Record<string, string | string[]>;

export interface OnboardingApplication {
  id: string;
  email: string;
  currentStep: OnboardingStepKey;
  status: OnboardingStatus;
  createdAt?: string;
  submittedAt?: string;
  updatedAt: string;
}

export interface OnboardingRfiTask {
  id: string;
  status: "open" | "responded" | "closed" | "cancelled";
  requestedFields: string[];
  note?: string;
  requesterEmail?: string;
  assigneeEmail?: string;
  dueAt?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingBusinessClientView {
  id: string;
  legalName: string;
  country: string;
  onboardingStatus: string;
}

export interface MyOnboardingResponse<AccountType = unknown> {
  application: OnboardingApplication;
  stepPayloads?: Record<string, OnboardingDraftPayload>;
  rfiTasks?: OnboardingRfiTask[];
  businessClient?: OnboardingBusinessClientView;
  adaAccounts?: AccountType[];
}

export interface InvitationResponse {
  ok: boolean;
  status: "check_email" | "existing_account";
  message: string;
}
