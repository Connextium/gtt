export type WebhookProcessingStatus = "received" | "queued" | "processed" | "dead_letter";
export type DepositStatus = "pending" | "settled" | "failed";
export type PaymentInstructionStatus = "created" | "processing" | "settled" | "failed";

export interface WebhookNotification {
  id: string;
  provider: "circle_simulator";
  eventId: string;
  eventType: string;
  signatureValid: boolean;
  rawPayload: Record<string, unknown>;
  processingStatus: WebhookProcessingStatus;
  receivedAt: string;
  processedAt?: string;
}

export interface ProcessingAttempt {
  id: string;
  webhookNotificationId: string;
  attemptNumber: number;
  status: WebhookProcessingStatus;
  errorCode?: string;
  createdAt: string;
}

export interface WireFundingInstruction {
  id: string;
  tenantId: string;
  accountOfDigitalAssetId: string;
  bankName: string;
  routingNumber: string;
  accountNumberLast4: string;
  beneficiaryName: string;
  status: "active" | "disabled";
  createdAt: string;
}

export interface FundingDeposit {
  id: string;
  tenantId: string;
  accountOfDigitalAssetId: string;
  webhookNotificationId?: string;
  providerDepositId: string;
  amountMinorUnits: bigint;
  status: DepositStatus;
  createdAt: string;
  settledAt?: string;
}

export interface PaymentInstruction {
  id: string;
  tenantId: string;
  sourceAccountOfDigitalAssetId: string;
  destinationAccountOfDigitalAssetId: string;
  settlementObligationId: string;
  fundingReservationId: string;
  amountMinorUnits: bigint;
  routeType: "internal";
  status: PaymentInstructionStatus;
  idempotencyKey: string;
  createdAt: string;
  terminalAt?: string;
}

export interface PaymentInstructionEvent {
  id: string;
  tenantId: string;
  paymentInstructionId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface InternalTransferExecution {
  id: string;
  tenantId: string;
  paymentInstructionId: string;
  provider: "circle_simulator" | "platform_ledger";
  providerTransferId: string;
  status: "settled" | "failed";
  createdAt: string;
}
