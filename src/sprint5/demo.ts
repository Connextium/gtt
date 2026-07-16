import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint5Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

resetIdsForTest();
const { app, sprint4 } = createSprint5Application();
const ctx: ActorContext = {
  tenantId: "tenant_demo",
  userId: "user_demo",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint5_demo"
};

const buyer = sprint4.sprint3.sprint2.sprint1.createBusinessClient(ctx, {
  legalName: "Demo Buyer",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s5_buyer"
});
const supplier = sprint4.sprint3.sprint2.sprint1.createBusinessClient(ctx, {
  legalName: "Demo Supplier",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s5_supplier"
});
const buyerAda = sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(ctx, {
  businessClientId: buyer.id,
  accountName: "Demo Buyer ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s5_buyer_ada"
});
const supplierAda = sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(ctx, {
  businessClientId: supplier.id,
  accountName: "Demo Supplier ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s5_supplier_ada"
});
sprint4.sprint3.sprint2.balances.projectBalancesForAccount(ctx, buyerAda.id);
sprint4.sprint3.sprint2.balances.projectBalancesForAccount(ctx, supplierAda.id);

const wireInstructions = app.settlement.storeWireInstructions(ctx, buyerAda.id);
app.settlement.receiveWebhook({
  eventId: "demo_evt_deposit",
  eventType: "wire.deposit.settled",
  signature: "valid-signature",
  payload: {
    accountOfDigitalAssetId: buyerAda.id,
    providerDepositId: "demo_dep_001",
    amountMinorUnits: "1000000000"
  }
});
const deposit = app.settlement.processDepositWebhook(ctx, "demo_evt_deposit");
app.settlement.processDepositWebhook(ctx, "demo_evt_deposit");

const obligation = sprint4.sprint3.obligations.createTradePayable(ctx, {
  buyerBusinessClientId: buyer.id,
  supplierBusinessClientId: supplier.id,
  amountMinorUnits: "500000000",
  dueDate: "2026-11-30",
  externalReference: "INV-S5-DEMO"
});
sprint4.sprint3.obligations.approveObligation(ctx, obligation.id);
const reservation = sprint4.sprint3.obligations.activateReservation(ctx, {
  settlementObligationId: obligation.id,
  accountOfDigitalAssetId: buyerAda.id,
  amountMinorUnits: "500000000",
  expectedBalanceVersion: sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, buyerAda.id).version
});
const payment = app.settlement.createPaymentInstruction(ctx, {
  sourceAccountOfDigitalAssetId: buyerAda.id,
  destinationAccountOfDigitalAssetId: supplierAda.id,
  settlementObligationId: obligation.id,
  fundingReservationId: reservation.id,
  amountMinorUnits: "500000000",
  idempotencyKey: "demo_pi_001"
});
const transfer = app.settlement.executeInternalSettlement(ctx, payment.id);
const buyerPosition = sprint4.positions.calculateAccountPosition(ctx, buyerAda.id);

console.log(
  JSON.stringify(
    {
      wireInstructions,
      deposit,
      replaySafeDepositCount: app.settlement.depositCount(),
      payment,
      transfer,
      buyerBalance: sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, buyerAda.id),
      supplierBalance: sprint4.sprint3.sprint2.balances.getClassifiedBalance(ctx, supplierAda.id),
      buyerPosition,
      paymentTimeline: app.settlement.paymentTimeline(payment.id),
      depositProcessingHistory: app.settlement.processingHistory("demo_evt_deposit")
    },
    stringifyBigInts,
    2
  )
);
