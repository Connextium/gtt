import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint5Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const context = (): ActorContext => ({
  tenantId: "tenant_a",
  userId: "user_a",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_s5"
});

const prepare = () => {
  resetIdsForTest();
  const { app, sprint4 } = createSprint5Application();
  const ctx = context();
  const buyer = sprint4.sprint3.sprint2.sprint1.createBusinessClient(ctx, {
    legalName: "Buyer",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s5_buyer"
  });
  const supplier = sprint4.sprint3.sprint2.sprint1.createBusinessClient(ctx, {
    legalName: "Supplier",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s5_supplier"
  });
  const buyerAda = sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(ctx, {
    businessClientId: buyer.id,
    accountName: "Buyer ADA",
    usePurpose: "settlement",
    idempotencyKey: "s5_buyer_ada"
  });
  const supplierAda = sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(ctx, {
    businessClientId: supplier.id,
    accountName: "Supplier ADA",
    usePurpose: "settlement",
    idempotencyKey: "s5_supplier_ada"
  });
  sprint4.sprint3.sprint2.balances.projectBalancesForAccount(ctx, buyerAda.id);
  sprint4.sprint3.sprint2.balances.projectBalancesForAccount(ctx, supplierAda.id);
  return { app, sprint4, ctx, buyer, supplier, buyerAda, supplierAda };
};

const testFundingWebhookReplayAndSettlement = (): void => {
  const { app, sprint4, ctx, buyer, supplier, buyerAda, supplierAda } = prepare();
  const wire = app.settlement.storeWireInstructions(ctx, buyerAda.id);
  assert(wire.status === "active", "wire instructions should be active");

  app.settlement.receiveWebhook({
    eventId: "evt_deposit_001",
    eventType: "wire.deposit.settled",
    signature: "valid-signature",
    payload: {
      accountOfDigitalAssetId: buyerAda.id,
      providerDepositId: "dep_001",
      amountMinorUnits: "1000000000"
    }
  });
  const deposit = app.settlement.processDepositWebhook(ctx, "evt_deposit_001");
  const replayed = app.settlement.processDepositWebhook(ctx, "evt_deposit_001");
  assert(deposit.id === replayed.id, "webhook replay should return same deposit");
  assert(app.settlement.depositCount() === 1, "webhook replay should not duplicate deposit");
  assert(sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, buyerAda.id).availableMinorUnits === 1000000000n, "buyer funded once");

  const obligation = sprint4.sprint3.obligations.createTradePayable(ctx, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "600000000",
    dueDate: "2026-11-30",
    externalReference: "INV-S5"
  });
  sprint4.sprint3.obligations.approveObligation(ctx, obligation.id);
  const reservation = sprint4.sprint3.obligations.activateReservation(ctx, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: buyerAda.id,
    amountMinorUnits: "600000000",
    expectedBalanceVersion: sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, buyerAda.id).version
  });
  const payment = app.settlement.createPaymentInstruction(ctx, {
    sourceAccountOfDigitalAssetId: buyerAda.id,
    destinationAccountOfDigitalAssetId: supplierAda.id,
    settlementObligationId: obligation.id,
    fundingReservationId: reservation.id,
    amountMinorUnits: "600000000",
    idempotencyKey: "pi_001"
  });
  const transfer = app.settlement.executeInternalSettlement(ctx, payment.id);
  assert(transfer.status === "settled", "internal transfer should settle");
  assert(sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, supplierAda.id).availableMinorUnits === 600000000n, "supplier receives funds");
  assert(sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, buyerAda.id).reservedMinorUnits === 0n, "buyer reservation consumed");
  assert(app.settlement.paymentTimeline(payment.id).some((event) => event.eventType === "payment_instruction.settled"), "settlement timeline recorded");

  const position = sprint4.positions.calculateAccountPosition(ctx, buyerAda.id);
  assert(position.currentMinorUnits === 400000000n, "buyer treasury position recalculated after settlement");
};

const testInvalidWebhookAndDeadLetter = (): void => {
  const { app } = prepare();
  const notification = app.settlement.receiveWebhook({
    eventId: "evt_bad_001",
    eventType: "wire.deposit.settled",
    signature: "bad",
    payload: {}
  });
  assert(notification.processingStatus === "dead_letter", "invalid signature should dead-letter");
  app.settlement.recordDeadLetter("evt_bad_001", "manual_retry_failed");
  assert(app.settlement.processingHistory("evt_bad_001").some((attempt) => attempt.errorCode === "manual_retry_failed"), "dead-letter history recorded");
};

testFundingWebhookReplayAndSettlement();
testInvalidWebhookAndDeadLetter();

console.log("Sprint 5 tests passed");
