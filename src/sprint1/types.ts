export type Id = string;
export type IsoTimestamp = string;
export type RoleCode = "platform_operator" | "treasury_operator" | "auditor";
export type AccountStatus = "draft" | "active" | "restricted" | "closed";
export type BusinessClientStatus = "draft" | "submitted" | "approved" | "restricted" | "closed";
export type LedgerAccountClass = "Asset" | "Liability" | "Revenue" | "Cost of revenue";
export type NormalBalance = "debit" | "credit";

export interface ActorContext {
  userId: Id;
  tenantId: Id;
  roles: RoleCode[];
  correlationId: string;
}

export interface AuditMetadata {
  actorUserId: Id;
  actorRoles: RoleCode[];
  tenantId: Id;
  correlationId: string;
  idempotencyKey: string;
  createdAt: IsoTimestamp;
}

export interface BusinessClient {
  id: Id;
  tenantId: Id;
  legalName: string;
  country: string;
  onboardingStatus: BusinessClientStatus;
  circleClientEntityId?: string;
  circleApplicationId?: string;
  audit: AuditMetadata;
}

export interface AccountOfDigitalAsset {
  id: Id;
  tenantId: Id;
  businessClientId: Id;
  accountName: string;
  usePurpose: "operating" | "settlement" | "escrow" | "suspense";
  status: AccountStatus;
  assetCode: "USDC";
  assetRail: "circle_internal" | "external_usdc";
  circleAccountId?: string;
  circleSubAccountId?: string;
  audit: AuditMetadata;
}

export interface Asset {
  assetCode: "USDC";
  assetName: string;
  minorUnitScale: 6;
  status: "active";
}

export interface AssetRail {
  railCode: "circle_internal" | "external_usdc";
  assetCode: "USDC";
  railName: string;
  status: "active" | "draft";
}

export interface LinkedInstrument {
  id: Id;
  accountOfDigitalAssetId: Id;
  instrumentType: "circle_wallet" | "fiat_wire" | "external_usdc_address";
  status: "pending" | "active" | "inactive";
  externalReference?: string;
  createdAt: IsoTimestamp;
}

export interface LedgerAccount {
  id: Id;
  accountCode: string;
  accountName: string;
  accountClass: LedgerAccountClass;
  normalBalance: NormalBalance;
}

export interface PostingRuleRecord {
  eventType: TreasuryAccountingEvent["eventType"];
  ruleName: string;
  status: "active" | "draft";
  debitLedgerAccountCode: string;
  creditLedgerAccountCode: string;
}

export interface TreasuryAccountingEvent {
  id: Id;
  tenantId: Id;
  eventType: "treasury.opening_journal.posted";
  sourceObjectId: Id;
  payload: Record<string, unknown>;
  audit: AuditMetadata;
}

export interface TreasuryJournalLine {
  id: Id;
  journalEntryId: Id;
  ledgerAccountId: Id;
  accountOfDigitalAssetId?: Id;
  partyId?: Id;
  assetCode: "USDC";
  currency: "USD";
  debitMinorUnits: bigint;
  creditMinorUnits: bigint;
  createdAt: IsoTimestamp;
}

export interface TreasuryJournalEntry {
  id: Id;
  tenantId: Id;
  sourceEventId: Id;
  accountingEventType: TreasuryAccountingEvent["eventType"];
  description: string;
  postedAt: IsoTimestamp;
  reversalOfJournalEntryId?: Id;
  audit: AuditMetadata;
  lines: TreasuryJournalLine[];
}

export interface IdempotencyRecord<T = unknown> {
  idempotencyKey: string;
  requestHash: string;
  responseBody: T;
  createdAt: IsoTimestamp;
}

export interface InboundEvent {
  eventId: Id;
  source: string;
  eventType: string;
  payload: unknown;
  receivedAt: IsoTimestamp;
  processedAt?: IsoTimestamp;
}

export interface OutboxEvent {
  id: Id;
  tenantId: Id;
  eventType: string;
  payload: unknown;
  createdAt: IsoTimestamp;
  publishedAt?: IsoTimestamp;
}

export interface AccountStatement {
  accountOfDigitalAssetId: Id;
  journalEntries: TreasuryJournalEntry[];
  auditTrail: AuditMetadata[];
}
