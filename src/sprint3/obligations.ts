import { DomainError, invariant } from "../sprint1/errors.js";
import { nextId, nowIso } from "../sprint1/ids.js";
import { parseMinorUnits } from "../sprint1/money.js";
import type { ActorContext } from "../sprint1/types.js";
import { Sprint2Application } from "../sprint2/application.js";
import type { ClassifiedBalance } from "../sprint2/types.js";
import type {
  AccountingEvidence,
  FundingReservation,
  FundingReservationAllocation,
  FundingStatus,
  ObligationAuditEvent,
  ObligationDetail,
  ObligationStatus,
  ReservationReasonCode,
  SettlementObligation
} from "./types.js";

const activeReservationStatuses = new Set<FundingReservation["status"]>(["active", "consumed"]);
const reasonCodes = new Set<ReservationReasonCode>([
  "buyer_dispute",
  "supplier_request",
  "operator_error",
  "reservation_expired",
  "obligation_cancelled"
]);

export class ObligationReservationService {
  private readonly obligations = new Map<string, SettlementObligation>();
  private readonly reservations = new Map<string, FundingReservation>();
  private readonly allocations = new Map<string, FundingReservationAllocation>();
  private readonly auditEvents: ObligationAuditEvent[] = [];
  private readonly accountingEvidence: AccountingEvidence[] = [];

  constructor(private readonly sprint2: Sprint2Application) {}

  createTradePayable(
    context: ActorContext,
    input: {
      buyerBusinessClientId: string;
      supplierBusinessClientId: string;
      amountMinorUnits: string | number | bigint;
      disputedMinorUnits?: string | number | bigint;
      dueDate: string;
      externalReference?: string;
    }
  ): SettlementObligation {
    this.requireOperator(context);
    const amount = parseMinorUnits(input.amountMinorUnits);
    const disputed = parseMinorUnits(input.disputedMinorUnits ?? 0n);
    invariant(amount > 0n, "obligation_amount_must_be_positive");
    invariant(disputed <= amount, "disputed_amount_exceeds_obligation");
    invariant(Boolean(input.dueDate), "obligation_due_date_required");
    this.requireBusinessClient(context, input.buyerBusinessClientId);
    this.requireBusinessClient(context, input.supplierBusinessClientId);

    const now = nowIso();
    const obligation: SettlementObligation = {
      id: nextId("obligation"),
      tenantId: context.tenantId,
      obligationType: "trade_payable",
      buyerBusinessClientId: input.buyerBusinessClientId,
      supplierBusinessClientId: input.supplierBusinessClientId,
      amountMinorUnits: amount,
      disputedMinorUnits: disputed,
      currency: "USD",
      status: "draft",
      fundingStatus: "unfunded",
      dueDate: input.dueDate,
      externalReference: input.externalReference,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.obligations.set(obligation.id, obligation);
    this.recordAudit(context, obligation.id, "settlement_obligation.created", undefined, {
      amountMinorUnits: amount.toString(),
      externalReference: input.externalReference
    });
    this.recordAccounting(context, "settlement_obligation.created", obligation.id, [], true);
    return obligation;
  }

  approveObligation(context: ActorContext, obligationId: string): SettlementObligation {
    this.requireOperator(context);
    const obligation = this.requireObligation(context, obligationId);
    invariant(obligation.status === "draft", "obligation_invalid_transition");
    const updated = this.updateObligation(obligation, {
      status: "approved",
      approvedAt: nowIso()
    });
    this.recordAudit(context, obligation.id, "settlement_obligation.approved");
    this.recordAccounting(context, "settlement_obligation.approved", obligation.id, [
      { side: "debit", account: "11000 Accepted Due Value Receivable", amountMinorUnits: obligation.amountMinorUnits - obligation.disputedMinorUnits },
      { side: "credit", account: "20200 Buyer Accepted Payable Clearing", amountMinorUnits: obligation.amountMinorUnits - obligation.disputedMinorUnits }
    ]);
    return updated;
  }

  activateReservation(
    context: ActorContext,
    input: {
      settlementObligationId: string;
      accountOfDigitalAssetId: string;
      amountMinorUnits: string | number | bigint;
      priority?: number;
      expiresAt?: string;
      expectedBalanceVersion: number;
    }
  ): FundingReservation {
    this.requireTreasury(context);
    const obligation = this.requireObligation(context, input.settlementObligationId);
    invariant(obligation.status !== "draft" && obligation.status !== "cancelled", "obligation_not_fundable");
    const amount = parseMinorUnits(input.amountMinorUnits);
    invariant(amount > 0n, "reservation_amount_must_be_positive");
    invariant(amount <= this.reservableAmount(obligation), "reservation_exceeds_obligation_need");

    const balance = this.sprint2.balances.getClassifiedBalance(context, input.accountOfDigitalAssetId);
    invariant(balance.version === input.expectedBalanceVersion, "balance_projection_version_conflict", {
      expectedVersion: input.expectedBalanceVersion,
      actualVersion: balance.version
    });
    invariant(amount <= balance.availableMinorUnits, "reservation_exceeds_available_balance");

    const reservation = this.createReservationRecord(context, obligation.id, input.accountOfDigitalAssetId, amount, "active", {
      priority: input.priority,
      expiresAt: input.expiresAt,
      activatedAt: nowIso()
    });
    const allocation = this.allocateReservation(context, reservation, obligation, amount);
    this.applyReservationBalanceUpdate(context, balance, amount, "activate");
    this.refreshFundingStatus(obligation.id);
    this.recordAudit(context, obligation.id, "funding_reservation.activated", undefined, {
      fundingReservationId: reservation.id,
      allocationId: allocation.id,
      amountMinorUnits: amount.toString()
    });
    this.recordAccounting(context, "funding_reservation.activated", reservation.id, [
      { side: "debit", account: "Reserved ADA classification", amountMinorUnits: amount },
      { side: "credit", account: "Available ADA classification", amountMinorUnits: amount }
    ]);
    return reservation;
  }

  releaseReservation(context: ActorContext, reservationId: string, reasonCode: ReservationReasonCode): FundingReservation {
    this.requireTreasury(context);
    this.requireReason(reasonCode);
    const reservation = this.requireReservation(context, reservationId);
    invariant(reservation.status === "active", "reservation_not_releasable");
    const balance = this.sprint2.balances.getClassifiedBalance(context, reservation.accountOfDigitalAssetId);
    const updated = this.updateReservation(reservation, {
      status: "released",
      reasonCode,
      releasedAt: nowIso()
    });
    this.applyReservationBalanceUpdate(context, balance, reservation.amountMinorUnits - reservation.consumedMinorUnits, "release");
    this.refreshFundingStatus(reservation.settlementObligationId);
    this.recordAudit(context, reservation.settlementObligationId, "funding_reservation.released", reasonCode, {
      fundingReservationId: reservation.id
    });
    this.recordAccounting(context, "funding_reservation.released", reservation.id, [
      { side: "debit", account: "Available ADA classification", amountMinorUnits: reservation.amountMinorUnits },
      { side: "credit", account: "Reserved ADA classification", amountMinorUnits: reservation.amountMinorUnits }
    ]);
    return updated;
  }

  cancelReservation(context: ActorContext, reservationId: string, reasonCode: ReservationReasonCode): FundingReservation {
    this.requireTreasury(context);
    this.requireReason(reasonCode);
    const reservation = this.requireReservation(context, reservationId);
    invariant(reservation.status === "draft" || reservation.status === "active", "reservation_not_cancellable");
    const updated = reservation.status === "active"
      ? this.releaseReservation(context, reservationId, reasonCode)
      : this.updateReservation(reservation, { status: "cancelled", reasonCode, cancelledAt: nowIso() });
    this.recordAudit(context, reservation.settlementObligationId, "funding_reservation.cancelled", reasonCode, {
      fundingReservationId: reservation.id
    });
    this.recordAccounting(context, "funding_reservation.cancelled", reservation.id, [], true);
    return updated.status === "released" ? this.updateReservation(updated, { status: "cancelled", cancelledAt: nowIso() }) : updated;
  }

  expireReservation(context: ActorContext, reservationId: string, reasonCode: ReservationReasonCode): FundingReservation {
    this.requireTreasury(context);
    this.requireReason(reasonCode);
    const reservation = this.requireReservation(context, reservationId);
    invariant(reservation.status === "active", "reservation_not_expirable");
    const balance = this.sprint2.balances.getClassifiedBalance(context, reservation.accountOfDigitalAssetId);
    const updated = this.updateReservation(reservation, {
      status: "expired",
      reasonCode,
      expiredAt: nowIso()
    });
    this.applyReservationBalanceUpdate(context, balance, reservation.amountMinorUnits - reservation.consumedMinorUnits, "release");
    this.refreshFundingStatus(reservation.settlementObligationId);
    this.recordAudit(context, reservation.settlementObligationId, "funding_reservation.expired", reasonCode, {
      fundingReservationId: reservation.id
    });
    this.recordAccounting(context, "funding_reservation.expired", reservation.id, [
      { side: "debit", account: "Available ADA classification", amountMinorUnits: reservation.amountMinorUnits },
      { side: "credit", account: "Reserved ADA classification", amountMinorUnits: reservation.amountMinorUnits }
    ]);
    return updated;
  }

  simulateConcurrentReservationAttempts(
    context: ActorContext,
    requests: Array<{
      settlementObligationId: string;
      accountOfDigitalAssetId: string;
      amountMinorUnits: string | number | bigint;
      expectedBalanceVersion: number;
    }>
  ): { accepted: FundingReservation[]; rejected: string[] } {
    const accepted: FundingReservation[] = [];
    const rejected: string[] = [];
    for (const request of requests) {
      try {
        accepted.push(this.activateReservation(context, request));
      } catch (error) {
        rejected.push(error instanceof DomainError ? error.code : "unknown_error");
      }
    }
    return { accepted, rejected };
  }

  getObligationDetail(context: ActorContext, obligationId: string): ObligationDetail {
    const obligation = this.requireObligation(context, obligationId);
    const reservations = [...this.reservations.values()]
      .filter((reservation) => reservation.settlementObligationId === obligation.id && reservation.tenantId === context.tenantId)
      .sort((left, right) => left.priority - right.priority);
    const allocations = [...this.allocations.values()]
      .filter((allocation) => allocation.settlementObligationId === obligation.id && allocation.tenantId === context.tenantId);
    return {
      obligation,
      reservations,
      allocations,
      fundedMinorUnits: this.activeAllocatedAmount(obligation.id),
      reservableMinorUnits: this.reservableAmount(obligation),
      timeline: this.auditEvents.filter((event) => event.settlementObligationId === obligation.id && event.tenantId === context.tenantId)
    };
  }

  accountingEvidenceFor(sourceObjectId?: string): AccountingEvidence[] {
    return this.accountingEvidence.filter((event) => !sourceObjectId || event.sourceObjectId === sourceObjectId);
  }

  listObligations(context: ActorContext): SettlementObligation[] {
    return [...this.obligations.values()].filter((obligation) => obligation.tenantId === context.tenantId);
  }

  private createReservationRecord(
    context: ActorContext,
    settlementObligationId: string,
    accountOfDigitalAssetId: string,
    amountMinorUnits: bigint,
    status: FundingReservation["status"],
    extras: Partial<FundingReservation> = {}
  ): FundingReservation {
    const now = nowIso();
    const reservation: FundingReservation = {
      id: nextId("reservation"),
      tenantId: context.tenantId,
      settlementObligationId,
      accountOfDigitalAssetId,
      amountMinorUnits,
      consumedMinorUnits: 0n,
      priority: extras.priority ?? 100,
      status,
      expiresAt: extras.expiresAt,
      activatedAt: extras.activatedAt,
      createdAt: now,
      updatedAt: now
    };
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  private allocateReservation(
    context: ActorContext,
    reservation: FundingReservation,
    obligation: SettlementObligation,
    amountMinorUnits: bigint
  ): FundingReservationAllocation {
    const allocation: FundingReservationAllocation = {
      id: nextId("allocation"),
      tenantId: context.tenantId,
      fundingReservationId: reservation.id,
      settlementObligationId: obligation.id,
      allocatedMinorUnits: amountMinorUnits,
      createdAt: nowIso()
    };
    this.allocations.set(allocation.id, allocation);
    return allocation;
  }

  private applyReservationBalanceUpdate(
    context: ActorContext,
    balance: ClassifiedBalance,
    amount: bigint,
    direction: "activate" | "release"
  ): void {
    const nextBalance =
      direction === "activate"
        ? {
            ...balance,
            availableMinorUnits: balance.availableMinorUnits - amount,
            reservedMinorUnits: balance.reservedMinorUnits + amount
          }
        : {
            ...balance,
            availableMinorUnits: balance.availableMinorUnits + amount,
            reservedMinorUnits: balance.reservedMinorUnits - amount
          };
    this.sprint2.balances.applyProjectionUpdate(context, balance.accountOfDigitalAssetId, balance.version, nextBalance);
  }

  private requireBusinessClient(context: ActorContext, businessClientId: string): void {
    invariant(Boolean(this.sprint2.sprint1.getBusinessClient(context, businessClientId)), "business_client_not_found", {
      businessClientId
    });
  }

  private requireObligation(context: ActorContext, obligationId: string): SettlementObligation {
    const obligation = this.obligations.get(obligationId);
    invariant(Boolean(obligation), "settlement_obligation_not_found", { obligationId });
    invariant(obligation?.tenantId === context.tenantId, "tenant_access_denied");
    return obligation!;
  }

  private requireReservation(context: ActorContext, reservationId: string): FundingReservation {
    const reservation = this.reservations.get(reservationId);
    invariant(Boolean(reservation), "funding_reservation_not_found", { reservationId });
    invariant(reservation?.tenantId === context.tenantId, "tenant_access_denied");
    return reservation!;
  }

  private requireOperator(context: ActorContext): void {
    invariant(context.roles.includes("platform_operator"), "role_not_authorized", { requiredRole: "platform_operator" });
  }

  private requireTreasury(context: ActorContext): void {
    invariant(context.roles.includes("treasury_operator"), "role_not_authorized", { requiredRole: "treasury_operator" });
  }

  private requireReason(reasonCode?: ReservationReasonCode): void {
    invariant(Boolean(reasonCode), "reservation_reason_required");
    invariant(reasonCodes.has(reasonCode!), "reservation_reason_invalid", { reasonCode });
  }

  private updateObligation(
    obligation: SettlementObligation,
    changes: Partial<Omit<SettlementObligation, "id" | "tenantId" | "createdAt">>
  ): SettlementObligation {
    const updated = {
      ...obligation,
      ...changes,
      version: obligation.version + 1,
      updatedAt: nowIso()
    };
    this.obligations.set(updated.id, updated);
    return updated;
  }

  private updateReservation(
    reservation: FundingReservation,
    changes: Partial<Omit<FundingReservation, "id" | "tenantId" | "createdAt">>
  ): FundingReservation {
    const updated = {
      ...reservation,
      ...changes,
      updatedAt: nowIso()
    };
    this.reservations.set(updated.id, updated);
    return updated;
  }

  private refreshFundingStatus(obligationId: string): void {
    const obligation = this.obligations.get(obligationId);
    if (!obligation) {
      return;
    }
    const fundingStatus = this.deriveFundingStatus(obligation);
    const status: ObligationStatus =
      obligation.status === "approved" || obligation.status === "partially_funded" || obligation.status === "fully_funded"
        ? fundingStatus === "fully_funded"
          ? "fully_funded"
          : fundingStatus === "partially_funded"
            ? "partially_funded"
            : "approved"
        : obligation.status;
    this.obligations.set(obligation.id, {
      ...obligation,
      status,
      fundingStatus,
      version: obligation.version + 1,
      updatedAt: nowIso()
    });
  }

  private deriveFundingStatus(obligation: SettlementObligation): FundingStatus {
    const funded = this.activeAllocatedAmount(obligation.id);
    const required = obligation.amountMinorUnits - obligation.disputedMinorUnits;
    if (funded <= 0n) {
      return "unfunded";
    }
    return funded >= required ? "fully_funded" : "partially_funded";
  }

  private reservableAmount(obligation: SettlementObligation): bigint {
    const amount = obligation.amountMinorUnits - obligation.disputedMinorUnits - this.activeAllocatedAmount(obligation.id);
    return amount > 0n ? amount : 0n;
  }

  private activeAllocatedAmount(obligationId: string): bigint {
    let total = 0n;
    for (const allocation of this.allocations.values()) {
      const reservation = this.reservations.get(allocation.fundingReservationId);
      if (allocation.settlementObligationId === obligationId && reservation && activeReservationStatuses.has(reservation.status)) {
        total += allocation.allocatedMinorUnits - reservation.consumedMinorUnits;
      }
    }
    return total;
  }

  private recordAudit(
    context: ActorContext,
    settlementObligationId: string,
    eventType: string,
    reasonCode?: ReservationReasonCode,
    payload: Record<string, unknown> = {}
  ): void {
    this.auditEvents.push({
      id: nextId("obligation_audit"),
      tenantId: context.tenantId,
      settlementObligationId,
      eventType,
      reasonCode,
      actorUserId: context.userId,
      actorRoles: context.roles,
      correlationId: context.correlationId,
      payload,
      createdAt: nowIso()
    });
  }

  private recordAccounting(
    context: ActorContext,
    eventType: string,
    sourceObjectId: string,
    lines: AccountingEvidence["lines"],
    projectionOnly = false
  ): void {
    const debit = lines.filter((line) => line.side === "debit").reduce((sum, line) => sum + line.amountMinorUnits, 0n);
    const credit = lines.filter((line) => line.side === "credit").reduce((sum, line) => sum + line.amountMinorUnits, 0n);
    this.accountingEvidence.push({
      id: nextId("accounting_evidence"),
      tenantId: context.tenantId,
      eventType,
      sourceObjectId,
      lines,
      balanced: debit === credit,
      projectionOnly,
      createdAt: nowIso()
    });
  }
}
