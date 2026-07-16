export type UsdcMinorUnitAmount = string;

export type CircleAccountStatus = "draft" | "active" | "restricted" | "closed";

export type CircleTransferStatus = "pending" | "settled" | "failed";

export interface MoneyAmount {
  assetCode: "USDC";
  amountMinor: UsdcMinorUnitAmount;
}

export interface CircleBusinessClient {
  clientEntityId: string;
  applicationId: string;
  status: "draft" | "submitted" | "in_review" | "information_required" | "approved" | "denied";
}

export interface CircleAccountOfDigitalAsset {
  accountId: string;
  clientEntityId: string;
  subAccountId: string;
  status: CircleAccountStatus;
}

export interface CircleBalance {
  accountId: string;
  available: MoneyAmount;
  pending: MoneyAmount;
}

export interface CircleTransfer {
  transferId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: MoneyAmount;
  status: CircleTransferStatus;
}

export interface CircleEvent {
  eventId: string;
  eventType: string;
  occurredAt: string;
  payload: unknown;
}

export interface CreateBusinessClientInput {
  legalName: string;
  country: string;
  idempotencyKey: string;
}

export interface CreateAccountInput {
  clientEntityId: string;
  idempotencyKey: string;
}

export interface TransferInput {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: MoneyAmount;
  idempotencyKey: string;
}

export interface CircleAdapter {
  createBusinessClient(input: CreateBusinessClientInput): Promise<CircleBusinessClient>;
  approveBusinessClient(applicationId: string): Promise<CircleBusinessClient>;
  createAccountOfDigitalAsset(input: CreateAccountInput): Promise<CircleAccountOfDigitalAsset>;
  getBalance(accountId: string): Promise<CircleBalance>;
  createInternalTransfer(input: TransferInput): Promise<CircleTransfer>;
  listEvents(): Promise<CircleEvent[]>;
}
