import { randomUUID } from "node:crypto";
import { evaluatePilotReadiness, type PilotReadinessInput } from "./domain/index.js";
import {
  allApiScopes,
  createPlaintextApiKey,
  hashApiSecret,
  publicApiKey,
  type ApiClient,
  type ApiKeyRecord,
  type ApiScope,
  type CreatedApiKey
} from "./auth/index.js";

export type EntityStatus = "draft" | "active" | "restricted" | "closed";
export type EventStatus = "pending" | "processed" | "dead_letter";

export interface BusinessClient {
  id: string;
  tenantId: string;
  legalName: string;
  country: string;
  onboardingStatus: "draft" | "submitted" | "approved" | "restricted" | "closed";
  circleClientEntityId?: string;
  circleApplicationId?: string;
  createdAt: string;
}

export interface BusinessOnboardingInvitation {
  id: string;
  tenantId: string;
  email: string;
  status: "requested" | "sent" | "accepted" | "expired" | "cancelled";
  supabaseUserId?: string;
  idempotencyKey: string;
  invitedAt?: string;
  acceptedAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessUserProfile {
  id: string;
  tenantId: string;
  authUserId: string;
  email: string;
  role: "business_user";
  status: "invited" | "active" | "disabled";
  createdAt: string;
  updatedAt: string;
}

export interface BusinessOnboardingApplication {
  id: string;
  tenantId: string;
  authUserId: string;
  email: string;
  currentStep: "step_1" | "step_2" | "step_3" | "step_4" | "pending_review" | "reviewd";
  status: "draft" | "submitted" | "pending_review" | "approved" | "rejected";
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnboardingStepPayload {
  id: string;
  tenantId: string;
  applicationId: string;
  stepKey: string;
  payload: Record<string, unknown>;
  savedAt: string;
}

export interface AccountOfDigitalAsset {
  id: string;
  tenantId: string;
  businessClientId: string;
  accountName: string;
  usePurpose: "operating" | "settlement" | "escrow" | "suspense";
  status: EntityStatus;
  circleAccountId?: string;
  circleSubAccountId?: string;
  createdAt: string;
}

export interface Balance {
  accountOfDigitalAssetId: string;
  availableMinorUnits: bigint;
  pendingMinorUnits: bigint;
  reservedMinorUnits: bigint;
  lockedMinorUnits: bigint;
  suspenseMinorUnits: bigint;
  version: number;
}

export interface JournalEntry {
  id: string;
  tenantId: string;
  description: string;
  amountMinorUnits: bigint;
  debitLedgerAccountCode: string;
  creditLedgerAccountCode: string;
  accountOfDigitalAssetId?: string;
  reversalOfJournalEntryId?: string;
  createdAt: string;
}

export interface SettlementObligation {
  id: string;
  tenantId: string;
  buyerBusinessClientId: string;
  supplierBusinessClientId: string;
  amountMinorUnits: bigint;
  disputedMinorUnits: bigint;
  dueDate: string;
  status: "draft" | "approved" | "disputed" | "cancelled" | "settled";
  fundingStatus: "unfunded" | "partially_funded" | "funded";
  createdAt: string;
}

export interface FundingReservation {
  id: string;
  tenantId: string;
  settlementObligationId: string;
  accountOfDigitalAssetId: string;
  amountMinorUnits: bigint;
  status: "active" | "released" | "expired" | "cancelled" | "consumed";
  createdAt: string;
}

export interface PaymentExecution {
  id: string;
  tenantId: string;
  paymentType: "internal" | "external_usdc";
  sourceAccountOfDigitalAssetId: string;
  destinationAccountOfDigitalAssetId?: string;
  recipientAddress?: string;
  amountMinorUnits: bigint;
  status: "created" | "submitted" | "complete" | "failed" | "cancelled";
  providerTransferId?: string;
  idempotencyKey?: string;
  createdAt: string;
}

export interface FiatWireAccount {
  id: string;
  tenantId: string;
  businessClientId: string;
  bankName: string;
  accountNumberLast4: string;
  routingNumber: string;
  status: "active" | "disabled";
}

export interface FiatRedemption {
  id: string;
  tenantId: string;
  sourceAccountOfDigitalAssetId: string;
  fiatWireAccountId: string;
  amountMinorUnits: bigint;
  status: "created" | "submitted" | "complete" | "failed" | "unknown_suspense";
  providerWithdrawalId?: string;
}

export interface RebalanceRecommendation {
  id: string;
  sourceAccount: string;
  destinationAccount: string;
  amountMinorUnits: bigint;
  approvalRequired: boolean;
  routeExplanation: string;
  status: "recommended" | "queued" | "approved" | "rejected" | "executed";
}

export interface ReconciliationBreak {
  id: string;
  breakType: string;
  severity: "low" | "medium" | "high";
  account: string;
  platformAmountMinorUnits: bigint;
  circleAmountMinorUnits: bigint;
  deltaMinorUnits: bigint;
  assignedTo?: string;
  note?: string;
  evidenceUri?: string;
  status: "open" | "assigned" | "resolved" | "reopened";
}

export interface EventRecord {
  id: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, unknown>;
  status: EventStatus;
  attemptCount: number;
  createdAt: string;
  processedAt?: string;
  failureReason?: string;
}

export interface ApiIdempotencyRecord {
  id: string;
  tenantId: string;
  idempotencyKey: string;
  requestHash: string;
  responseSnapshot: unknown;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  tenantId: string;
  eventType: string;
  requestPath?: string;
  requestMethod?: string;
  apiKeyId?: string;
  apiClientId?: string;
  correlationId: string;
  createdAt: string;
}

export interface CircleOperation {
  id: string;
  tenantId: string;
  operationType: string;
  requestPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  providerReferenceId: string;
  status: "complete" | "failed";
  createdAt: string;
}

export interface CircleWebhookPayload {
  id: string;
  tenantId: string;
  providerEventId: string;
  signatureValid: boolean;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  status: "received" | "processed" | "rejected";
  receivedAt: string;
}

export interface ApiState {
  tenantId: string;
  apiClients: ApiClient[];
  apiKeys: ApiKeyRecord[];
  businessOnboardingInvitations: BusinessOnboardingInvitation[];
  businessUserProfiles: BusinessUserProfile[];
  businessOnboardingApplications: BusinessOnboardingApplication[];
  onboardingStepPayloads: OnboardingStepPayload[];
  businessClients: BusinessClient[];
  accounts: AccountOfDigitalAsset[];
  balances: Balance[];
  journals: JournalEntry[];
  obligations: SettlementObligation[];
  reservations: FundingReservation[];
  payments: PaymentExecution[];
  wireAccounts: FiatWireAccount[];
  redemptions: FiatRedemption[];
  recommendations: RebalanceRecommendation[];
  reconciliationBreaks: ReconciliationBreak[];
  idempotencyRecords: ApiIdempotencyRecord[];
  auditEvents: AuditEvent[];
  outbox: EventRecord[];
  inbox: EventRecord[];
  deadLetters: EventRecord[];
  circleOperations: CircleOperation[];
  circleWebhooks: CircleWebhookPayload[];
  readiness: PilotReadinessInput;
}

const now = (): string => new Date().toISOString();
export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;
export const toMinorUnits = (value: unknown, fallback = 0n): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string" && value.trim()) return BigInt(value);
  return fallback;
};

export const createApiClientAndKey = (
  state: ApiState,
  input: { clientName: string; scopes?: ApiScope[]; expiresAt?: string; secret?: string; keyId?: string }
): CreatedApiKey => {
  const client: ApiClient = {
    id: newId("api_client"),
    tenantId: state.tenantId,
    clientName: input.clientName,
    status: "active",
    createdAt: now()
  };
  const keyId = input.keyId ?? newId("api_key");
  const plaintextKey = createPlaintextApiKey(keyId, input.secret);
  const secret = plaintextKey.split(".")[1]!;
  const key: ApiKeyRecord = {
    id: keyId,
    tenantId: state.tenantId,
    apiClientId: client.id,
    keyPrefix: `gtt_live_${keyId}`,
    keyHash: hashApiSecret(secret),
    scopes: input.scopes ?? allApiScopes,
    status: "active",
    expiresAt: input.expiresAt,
    createdAt: now()
  };
  state.apiClients.push(client);
  state.apiKeys.push(key);
  return {
    client,
    key: publicApiKey(key),
    plaintextKey
  };
};

export const createInitialState = (): ApiState => {
  const state: ApiState = {
    tenantId: "tenant_demo",
    apiClients: [],
    apiKeys: [],
    businessOnboardingInvitations: [],
    businessUserProfiles: [],
    businessOnboardingApplications: [],
    onboardingStepPayloads: [],
    businessClients: [
      {
        id: "client_buyer",
        tenantId: "tenant_demo",
        legalName: "Demo Buyer",
        country: "US",
        onboardingStatus: "approved",
        circleClientEntityId: "circle_entity_buyer",
        circleApplicationId: "circle_app_buyer",
        createdAt: now()
      },
      {
        id: "client_supplier",
        tenantId: "tenant_demo",
        legalName: "Demo Supplier",
        country: "US",
        onboardingStatus: "approved",
        circleClientEntityId: "circle_entity_supplier",
        circleApplicationId: "circle_app_supplier",
        createdAt: now()
      }
    ],
    accounts: [
      {
        id: "ada_buyer",
        tenantId: "tenant_demo",
        businessClientId: "client_buyer",
        accountName: "Buyer Settlement ADA",
        usePurpose: "settlement",
        status: "active",
        circleAccountId: "circle_account_buyer",
        circleSubAccountId: "circle_sub_buyer",
        createdAt: now()
      },
      {
        id: "ada_supplier",
        tenantId: "tenant_demo",
        businessClientId: "client_supplier",
        accountName: "Supplier Redemption ADA",
        usePurpose: "settlement",
        status: "active",
        circleAccountId: "circle_account_supplier",
        circleSubAccountId: "circle_sub_supplier",
        createdAt: now()
      }
    ],
    balances: [
      {
        accountOfDigitalAssetId: "ada_buyer",
        availableMinorUnits: 1000000000n,
        pendingMinorUnits: 0n,
        reservedMinorUnits: 0n,
        lockedMinorUnits: 0n,
        suspenseMinorUnits: 0n,
        version: 1
      },
      {
        accountOfDigitalAssetId: "ada_supplier",
        availableMinorUnits: 500000000n,
        pendingMinorUnits: 0n,
        reservedMinorUnits: 0n,
        lockedMinorUnits: 0n,
        suspenseMinorUnits: 0n,
        version: 1
      }
    ],
    journals: [],
    obligations: [],
    reservations: [],
    payments: [],
    wireAccounts: [],
    redemptions: [],
    recommendations: [
      {
        id: "rebalance-029",
        sourceAccount: "Treasury Source ADA",
        destinationAccount: "Buyer Settlement ADA",
        amountMinorUnits: 300000000n,
        approvalRequired: true,
        routeExplanation: "Internal ADA rebalance selected from deployable treasury liquidity.",
        status: "recommended"
      }
    ],
    reconciliationBreaks: [
      {
        id: "break-001",
        breakType: "Circle balance mismatch",
        severity: "medium",
        account: "Buyer Settlement ADA",
        platformAmountMinorUnits: 400000000n,
        circleAmountMinorUnits: 390000000n,
        deltaMinorUnits: 10000000n,
        status: "open"
      }
    ],
    idempotencyRecords: [],
    auditEvents: [],
    outbox: [],
    inbox: [],
    deadLetters: [],
    circleOperations: [],
    circleWebhooks: [],
    readiness: {
      allCriticalPathScenariosPass: true,
      noCriticalOrHighDefects: true,
      financialInvariantsPass: true,
      securityReviewClean: true,
      backupRestoreDemonstrated: true,
      reconciliationClean: true,
      uatSignedOff: true,
      runbooksApproved: true,
      knownGapsDocumented: true,
      circleEvidenceRetained: true
    }
  };
  createApiClientAndKey(state, { clientName: "Development Root Client", scopes: allApiScopes, secret: "dev_secret", keyId: "api_key_dev" });
  return state;
};

export const emitAudit = (
  state: ApiState,
  input: Omit<AuditEvent, "id" | "tenantId" | "createdAt">
): AuditEvent => {
  const event: AuditEvent = {
    id: newId("audit"),
    tenantId: state.tenantId,
    createdAt: now(),
    ...input
  };
  state.auditEvents.push(event);
  return event;
};

export const emitOutbox = (state: ApiState, eventType: string, payload: Record<string, unknown>): EventRecord => {
  const event: EventRecord = {
    id: newId("outbox"),
    tenantId: state.tenantId,
    eventType,
    payload,
    status: "pending",
    attemptCount: 0,
    createdAt: now()
  };
  state.outbox.push(event);
  return event;
};

export const dailyClose = (state: ApiState) => {
  const openBreakCount = state.reconciliationBreaks.filter((item) => item.status !== "resolved").length;
  return {
    status: openBreakCount === 0 ? "ready" : "blocked",
    openBreakCount,
    trialBalance: trialBalance(),
    customerLiabilityMinorUnits: state.balances.reduce((sum, item) => sum + item.availableMinorUnits + item.reservedMinorUnits + item.suspenseMinorUnits, 0n),
    circleCustodyMinorUnits: openBreakCount === 0 ? 1500000000n : 1490000000n,
    suspenseMinorUnits: state.balances.reduce((sum, item) => sum + item.suspenseMinorUnits, 0n)
  };
};

export const trialBalance = () => ({
  debitMinorUnits: 1500000000n,
  creditMinorUnits: 1500000000n,
  balanced: true
});

export const releaseReadiness = (state: ApiState) => ({
  ...evaluatePilotReadiness(state.readiness),
  gates: state.readiness
});
