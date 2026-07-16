import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint6Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const ctx = (): ActorContext => ({
  tenantId: "tenant_a",
  userId: "user_a",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_s6"
});

const prepare = () => {
  resetIdsForTest();
  const { app, sprint5 } = createSprint6Application();
  const context = ctx();
  const buyer = sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(context, {
    legalName: "Buyer",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s6_buyer"
  });
  const supplier = sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(context, {
    legalName: "Supplier",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s6_supplier"
  });
  const buyerAda = sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(context, {
    businessClientId: buyer.id,
    accountName: "Buyer ADA",
    usePurpose: "settlement",
    idempotencyKey: "s6_buyer_ada"
  });
  const supplierAda = sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(context, {
    businessClientId: supplier.id,
    accountName: "Supplier ADA",
    usePurpose: "settlement",
    idempotencyKey: "s6_supplier_ada"
  });
  sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: buyerAda.id,
    description: "External payment funding",
    idempotencyKey: "s6_opening_buyer",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "1000000000"
  });
  sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: supplierAda.id,
    description: "Supplier redemption funding",
    idempotencyKey: "s6_opening_supplier",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "500000000"
  });
  sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(context, buyerAda.id);
  sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(context, supplierAda.id);
  const obligation = sprint5.sprint4.sprint3.obligations.createTradePayable(context, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "600000000",
    dueDate: "2026-12-31",
    externalReference: "INV-S6"
  });
  sprint5.sprint4.sprint3.obligations.approveObligation(context, obligation.id);
  const reservation = sprint5.sprint4.sprint3.obligations.activateReservation(context, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: buyerAda.id,
    amountMinorUnits: "600000000",
    expectedBalanceVersion: sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, buyerAda.id).version
  });
  return { app, sprint5, context, buyer, supplier, buyerAda, supplierAda, obligation, reservation };
};

const testExternalPaymentAndIdempotentRetry = (): void => {
  const { app, sprint5, context, buyerAda, obligation, reservation } = prepare();
  const recipient = app.externalRedemption.registerRecipient(context, {
    label: "Supplier external wallet",
    chain: "base",
    address: "0xabc1234567"
  });
  const payment = app.externalRedemption.submitExternalPayment(context, {
    sourceAccountOfDigitalAssetId: buyerAda.id,
    externalRecipientId: recipient.id,
    settlementObligationId: obligation.id,
    fundingReservationId: reservation.id,
    amountMinorUnits: "600000000",
    idempotencyKey: "ext_001"
  });
  const retry = app.externalRedemption.submitExternalPayment(context, {
    sourceAccountOfDigitalAssetId: buyerAda.id,
    externalRecipientId: recipient.id,
    settlementObligationId: obligation.id,
    fundingReservationId: reservation.id,
    amountMinorUnits: "600000000",
    idempotencyKey: "ext_001"
  });
  assert(payment.id === retry.id, "retry should return original external payment");
  assert(payment.status === "complete", "external payment should complete");
  assert(Boolean(payment.blockchainTxHash), "blockchain transaction reference should exist");
  assert(sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, buyerAda.id).reservedMinorUnits === 0n, "reservation should be consumed");
};

const testFailureReleaseTimeoutAndRedemption = (): void => {
  const { app, sprint5, context, buyerAda, supplierAda, supplier, obligation, reservation } = prepare();
  const recipient = app.externalRedemption.registerRecipient(context, {
    label: "Fail wallet",
    chain: "base",
    address: "0xdef1234567"
  });
  const failed = app.externalRedemption.submitExternalPayment(context, {
    sourceAccountOfDigitalAssetId: buyerAda.id,
    externalRecipientId: recipient.id,
    settlementObligationId: obligation.id,
    fundingReservationId: reservation.id,
    amountMinorUnits: "100000000",
    idempotencyKey: "ext_fail_001",
    simulateFailure: true
  });
  assert(failed.status === "failed", "failed external payment should fail");
  assert(app.externalRedemption.reversalObligations(context).length === 1, "failed payment should create reversal obligation evidence");
  const timeout = app.externalRedemption.timeoutExternalPayment(context, failed.id);
  assert(timeout.status === "timeout", "operator timeout should be supported");

  const wire = app.externalRedemption.linkFiatWireAccount(context, {
    businessClientId: supplier.id,
    bankName: "Supplier Bank",
    accountNumberLast4: "7788",
    routingNumber: "000000002"
  });
  const redemption = app.externalRedemption.submitRedemption(context, {
    sourceAccountOfDigitalAssetId: supplierAda.id,
    fiatWireAccountId: wire.id,
    amountMinorUnits: "200000000",
    idempotencyKey: "red_001"
  });
  assert(redemption.status === "complete", "redemption should complete");
  assert(sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, supplierAda.id).availableMinorUnits === 300000000n, "supplier balance should reduce");

  const unknown = app.externalRedemption.submitRedemption(context, {
    sourceAccountOfDigitalAssetId: supplierAda.id,
    fiatWireAccountId: wire.id,
    amountMinorUnits: "100000000",
    idempotencyKey: "red_unknown_001",
    simulateUnknown: true
  });
  assert(unknown.status === "unknown_suspense", "unknown status should route to suspense");
  assert(sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, supplierAda.id).suspenseMinorUnits === 100000000n, "suspense should increase");
  const refreshed = app.externalRedemption.manualStatusRefresh(context, unknown.id, "complete");
  assert(refreshed.status === "complete", "manual refresh should update status");
};

testExternalPaymentAndIdempotentRetry();
testFailureReleaseTimeoutAndRedemption();

console.log("Sprint 6 tests passed");
