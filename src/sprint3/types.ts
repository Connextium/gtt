import type { ActorContext } from "../sprint1/types.js";

export type ObligationType = "trade_payable";
export type ObligationStatus = "draft" | "approved" | "partially_funded" | "fully_funded" | "settled" | "cancelled";
export type FundingStatus = "unfunded" | "partially_funded" | "fully_funded";
export type ReservationStatus = "draft" | "active" | "released" | "cancelled" | "expired" | "consumed";
export type ReservationReasonCode =
  | "buyer_dispute"
  | "supplier_request"
  | "operator_error"
  | "reservation_expired"
  | "obligation_cancelled";

export interface SettlementObligation {
  id: string;
  tenantId: string;
  obligationType: ObligationType;
  buyerBusinessClientId: string;
  supplierBusinessClientId: string;
  amountMinorUnits: bigint;
  disputedMinorUnits: bigint;
  currency: "USD";
  status: ObligationStatus;
  fundingStatus: FundingStatus;
  dueDate: string;
  externalReference?: string;
  version: number;
  approvedAt?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FundingReservation {
  id: string;
  tenantId: string;
  settlementObligationId: string;
  accountOfDigitalAssetId: string;
  amountMinorUnits: bigint;
  consumedMinorUnits: bigint;
  priority: number;
  status: ReservationStatus;
  reasonCode?: ReservationReasonCode;
  expiresAt?: string;
  activatedAt?: string;
  releasedAt?: string;
  cancelledAt?: string;
  expiredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FundingReservationAllocation {
  id: string;
  tenantId: string;
  fundingReservationId: string;
  settlementObligationId: string;
  allocatedMinorUnits: bigint;
  createdAt: string;
}

export interface ObligationAuditEvent {
  id: string;
  tenantId: string;
  settlementObligationId: string;
  eventType: string;
  reasonCode?: ReservationReasonCode;
  actorUserId: string;
  actorRoles: ActorContext["roles"];
  correlationId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AccountingEvidenceLine {
  side: "debit" | "credit";
  account: string;
  amountMinorUnits: bigint;
}

export interface AccountingEvidence {
  id: string;
  tenantId: string;
  eventType: string;
  sourceObjectId: string;
  lines: AccountingEvidenceLine[];
  balanced: boolean;
  projectionOnly: boolean;
  createdAt: string;
}

export interface ObligationDetail {
  obligation: SettlementObligation;
  reservations: FundingReservation[];
  allocations: FundingReservationAllocation[];
  fundedMinorUnits: bigint;
  reservableMinorUnits: bigint;
  timeline: ObligationAuditEvent[];
}
