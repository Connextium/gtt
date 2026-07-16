import { DomainError } from "../sprint1/errors.js";
import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint3Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertThrowsCode = (work: () => unknown, code: string): void => {
  try {
    work();
  } catch (error) {
    if (error instanceof DomainError) {
      assert(error.code === code, `expected ${code}, got ${error.code}`);
      return;
    }
    if (error instanceof Error) {
      assert(error.message === code, `expected ${code}, got ${error.message}`);
      return;
    }
    throw error;
  }
  throw new Error(`expected ${code} to be thrown`);
};

const stringifyBigInt = (value: bigint): string => value.toString();

const makeContext = (tenantId = "tenant_a"): ActorContext => ({
  tenantId,
  userId: `user_${tenantId}`,
  correlationId: `corr_${tenantId}`,
  roles: ["platform_operator", "treasury_operator"]
});

const prepareFundedAda = () => {
  resetIdsForTest();
  const { app, sprint2 } = createSprint3Application();
  const context = makeContext();
  const buyer = sprint2.sprint1.createBusinessClient(context, {
    legalName: "Buyer Co",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s3_buyer"
  });
  const supplier = sprint2.sprint1.createBusinessClient(context, {
    legalName: "Supplier Co",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s3_supplier"
  });
  const ada = sprint2.sprint1.createAccountOfDigitalAsset(context, {
    businessClientId: buyer.id,
    accountName: "Buyer Settlement ADA",
    usePurpose: "settlement",
    idempotencyKey: "s3_buyer_ada"
  });
  sprint2.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: ada.id,
    description: "Sprint 3 available funding",
    idempotencyKey: "s3_opening",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "1000000000"
  });
  const balance = sprint2.balances.projectBalancesForAccount(context, ada.id);
  return { app, sprint2, context, buyer, supplier, ada, balance };
};

const testFullPartialAndOverReservation = (): void => {
  const { app, sprint2, context, buyer, supplier, ada, balance } = prepareFundedAda();
  const obligation = app.obligations.createTradePayable(context, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "800000000",
    dueDate: "2026-08-31",
    externalReference: "INV-001"
  });
  app.obligations.approveObligation(context, obligation.id);
  const reservation = app.obligations.activateReservation(context, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "800000000",
    expectedBalanceVersion: balance.version
  });
  assert(reservation.status === "active", "reservation should activate");
  const detail = app.obligations.getObligationDetail(context, obligation.id);
  assert(detail.obligation.fundingStatus === "fully_funded", "obligation should be fully funded");
  assert(detail.fundedMinorUnits === 800000000n, "funded amount should match reservation");

  const nextBalance = sprint2.balances.getClassifiedBalance(context, ada.id);
  assert(nextBalance.availableMinorUnits === 200000000n, "available should decrease");
  assert(nextBalance.reservedMinorUnits === 800000000n, "reserved should increase");

  const partial = app.obligations.createTradePayable(context, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "300000000",
    disputedMinorUnits: "50000000",
    dueDate: "2026-09-15",
    externalReference: "INV-002"
  });
  app.obligations.approveObligation(context, partial.id);
  app.obligations.activateReservation(context, {
    settlementObligationId: partial.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "100000000",
    expectedBalanceVersion: nextBalance.version
  });
  const partialDetail = app.obligations.getObligationDetail(context, partial.id);
  assert(partialDetail.obligation.fundingStatus === "partially_funded", "obligation should be partially funded");
  assert(partialDetail.reservableMinorUnits === 150000000n, "disputed amount should be excluded from funding need");

  assertThrowsCode(() => {
    const current = sprint2.balances.getClassifiedBalance(context, ada.id);
    app.obligations.activateReservation(context, {
      settlementObligationId: partial.id,
      accountOfDigitalAssetId: ada.id,
      amountMinorUnits: "200000000",
      expectedBalanceVersion: current.version
    });
  }, "reservation_exceeds_obligation_need");
};

const testReleaseExpireCancelReasonsAndTimeline = (): void => {
  const { app, sprint2, context, buyer, supplier, ada, balance } = prepareFundedAda();
  const obligation = app.obligations.createTradePayable(context, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "500000000",
    dueDate: "2026-08-31",
    externalReference: "INV-003"
  });
  app.obligations.approveObligation(context, obligation.id);
  const reservation = app.obligations.activateReservation(context, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "200000000",
    expectedBalanceVersion: balance.version
  });
  assertThrowsCode(() => app.obligations.releaseReservation(context, reservation.id, undefined as never), "reservation_reason_required");
  app.obligations.releaseReservation(context, reservation.id, "buyer_dispute");

  const balanceAfterRelease = sprint2.balances.getClassifiedBalance(context, ada.id);
  assert(balanceAfterRelease.reservedMinorUnits === 0n, "release should reduce reserved amount");
  assert(balanceAfterRelease.availableMinorUnits === 1000000000n, "release should return to available");

  const expiring = app.obligations.activateReservation(context, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "100000000",
    expectedBalanceVersion: balanceAfterRelease.version,
    expiresAt: "2026-08-01T00:00:00.000Z"
  });
  app.obligations.expireReservation(context, expiring.id, "reservation_expired");

  const cancelTarget = app.obligations.activateReservation(context, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "50000000",
    expectedBalanceVersion: sprint2.balances.getClassifiedBalance(context, ada.id).version
  });
  app.obligations.cancelReservation(context, cancelTarget.id, "operator_error");

  const detail = app.obligations.getObligationDetail(context, obligation.id);
  assert(detail.timeline.some((event) => event.reasonCode === "buyer_dispute"), "timeline should include release reason");
  assert(detail.timeline.some((event) => event.reasonCode === "reservation_expired"), "timeline should include expiry reason");
  assert(detail.timeline.some((event) => event.reasonCode === "operator_error"), "timeline should include cancellation reason");
};

const testConcurrencyAndTenantIsolation = (): void => {
  const { app, sprint2, context, buyer, supplier, ada, balance } = prepareFundedAda();
  const obligation = app.obligations.createTradePayable(context, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "1000000000",
    dueDate: "2026-08-31",
    externalReference: "INV-004"
  });
  app.obligations.approveObligation(context, obligation.id);
  const result = app.obligations.simulateConcurrentReservationAttempts(context, [
    {
      settlementObligationId: obligation.id,
      accountOfDigitalAssetId: ada.id,
      amountMinorUnits: "400000000",
      expectedBalanceVersion: balance.version
    },
    {
      settlementObligationId: obligation.id,
      accountOfDigitalAssetId: ada.id,
      amountMinorUnits: "400000000",
      expectedBalanceVersion: balance.version
    }
  ]);
  assert(result.accepted.length === 1, "only one concurrent reservation should be accepted");
  assert(result.rejected.includes("balance_projection_version_conflict"), "stale concurrent reservation should fail");

  const otherTenant = makeContext("tenant_b");
  assertThrowsCode(() => app.obligations.getObligationDetail(otherTenant, obligation.id), "tenant_access_denied");
};

const testAccountingEvidenceBalanced = (): void => {
  const { app, context, buyer, supplier, ada, balance } = prepareFundedAda();
  const obligation = app.obligations.createTradePayable(context, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "100000000",
    dueDate: "2026-08-31",
    externalReference: "INV-005"
  });
  app.obligations.approveObligation(context, obligation.id);
  const reservation = app.obligations.activateReservation(context, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "100000000",
    expectedBalanceVersion: balance.version
  });
  const evidence = app.obligations.accountingEvidenceFor(reservation.id);
  assert(evidence.length >= 1, "reservation should have accounting evidence");
  assert(evidence.every((event) => event.balanced), "accounting evidence should be balanced");
  assert(evidence.map((event) => event.eventType).includes("funding_reservation.activated"), "activation evidence should exist");
  void stringifyBigInt;
};

testFullPartialAndOverReservation();
testReleaseExpireCancelReasonsAndTimeline();
testConcurrencyAndTenantIsolation();
testAccountingEvidenceBalanced();

console.log("Sprint 3 tests passed");
