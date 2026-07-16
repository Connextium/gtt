export type ExternalExecutionStatus = "created" | "submitted" | "complete" | "failed" | "timeout" | "cancelled";
export type RedemptionStatus = "created" | "submitted" | "complete" | "failed" | "unknown_suspense" | "cancelled";

export interface ExternalRecipient {
  id: string;
  tenantId: string;
  label: string;
  assetCode: "USDC";
  chain: "base" | "ethereum";
  address: string;
  status: "active" | "disabled";
}

export interface ExternalPaymentExecution {
  id: string;
  tenantId: string;
  sourceAccountOfDigitalAssetId: string;
  externalRecipientId: string;
  settlementObligationId: string;
  fundingReservationId: string;
  amountMinorUnits: bigint;
  feeMinorUnits: bigint;
  idempotencyKey: string;
  status: ExternalExecutionStatus;
  providerTransferId?: string;
  blockchainTxHash?: string;
  failureCode?: string;
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

export interface RedemptionInstruction {
  id: string;
  tenantId: string;
  sourceAccountOfDigitalAssetId: string;
  fiatWireAccountId: string;
  amountMinorUnits: bigint;
  idempotencyKey: string;
  status: RedemptionStatus;
  providerWithdrawalId?: string;
  suspenseReason?: string;
}

export interface ReversalObligation {
  id: string;
  tenantId: string;
  sourceExecutionId: string;
  sourceExecutionType: "external_payment" | "redemption";
  reasonCode: string;
  status: "open" | "closed";
}
