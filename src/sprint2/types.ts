import type { AccountOfDigitalAsset, ActorContext, BusinessClient, TreasuryJournalEntry } from "../sprint1/types.js";

export type BalanceBucket = "available" | "pending" | "reserved" | "locked" | "suspense";
export type OnboardingStatus = "draft" | "submitted" | "in_review" | "information_required" | "approved" | "denied";

export interface ClassifiedBalance {
  accountOfDigitalAssetId: string;
  assetCode: "USDC";
  currency: "USD";
  availableMinorUnits: bigint;
  pendingMinorUnits: bigint;
  reservedMinorUnits: bigint;
  lockedMinorUnits: bigint;
  suspenseMinorUnits: bigint;
  totalMinorUnits: bigint;
  version: number;
  projectedAt: string;
}

export interface BalanceProjectionRun {
  id: string;
  tenantId: string;
  accountOfDigitalAssetId: string;
  status: "completed" | "failed";
  sourceJournalCount: number;
  startedAt: string;
  completedAt?: string;
}

export interface ExtendedAccountStatement {
  accountOfDigitalAssetId: string;
  openingBalanceMinorUnits: bigint;
  endingBalance: ClassifiedBalance;
  movements: TreasuryJournalEntry[];
}

export interface OnboardingApplication {
  id: string;
  tenantId: string;
  businessClientId: string;
  provider: "circle_simulator" | "circle";
  providerApplicationId: string;
  providerClientEntityId: string;
  status: OnboardingStatus;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingSchemaSnapshot {
  id: string;
  tenantId: string;
  onboardingApplicationId: string;
  provider: OnboardingApplication["provider"];
  schemaVersion: string;
  schemaBody: OnboardingSchema;
  retrievedAt: string;
}

export interface OnboardingSchema {
  version: string;
  sections: Array<{
    key: string;
    title: string;
    fields: Array<{ key: string; type: "text" | "country" | "date" | "document"; required: boolean }>;
  }>;
}

export interface OnboardingSectionResponse {
  id: string;
  tenantId: string;
  onboardingApplicationId: string;
  sectionKey: string;
  responseBody: Record<string, unknown>;
  version: number;
  updatedAt: string;
}

export interface OnboardingDocument {
  id: string;
  tenantId: string;
  onboardingApplicationId: string;
  documentType: string;
  fileName: string;
  status: "metadata_recorded" | "uploaded" | "accepted" | "rejected";
  externalReference?: string;
  createdAt: string;
}

export interface OnboardingAdapter {
  createApplication(input: { legalName: string; country: string }): Promise<{
    providerApplicationId: string;
    providerClientEntityId: string;
    status: OnboardingStatus;
  }>;
  retrieveSchema(providerApplicationId: string): Promise<OnboardingSchema>;
  submitApplication(providerApplicationId: string): Promise<OnboardingStatus>;
  getApplicationStatus(providerApplicationId: string): Promise<OnboardingStatus>;
}

export interface ProductSurfaceSnapshot {
  roleNavigation: string[];
  businessClients: BusinessClient[];
  onboardingApplications: OnboardingApplication[];
  accountsOfDigitalAsset: AccountOfDigitalAsset[];
  accountBalanceCards: ClassifiedBalance[];
}

export interface Sprint2Context {
  actor: ActorContext;
}
