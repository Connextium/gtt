import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint6Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

resetIdsForTest();
const { app, sprint5 } = createSprint6Application();
const context: ActorContext = {
  tenantId: "tenant_demo",
  userId: "user_demo",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint6_demo"
};

const buyer = sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(context, {
  legalName: "Demo Buyer",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s6_buyer"
});
const supplier = sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(context, {
  legalName: "Demo Supplier",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s6_supplier"
});
const buyerAda = sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(context, {
  businessClientId: buyer.id,
  accountName: "Demo Buyer ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s6_buyer_ada"
});
const supplierAda = sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(context, {
  businessClientId: supplier.id,
  accountName: "Demo Supplier ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s6_supplier_ada"
});
sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(context, {
  accountOfDigitalAssetId: buyerAda.id,
  description: "Demo external funding",
  idempotencyKey: "demo_s6_opening_buyer",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "900000000"
});
sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(context, {
  accountOfDigitalAssetId: supplierAda.id,
  description: "Demo redemption funding",
  idempotencyKey: "demo_s6_opening_supplier",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "400000000"
});
sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(context, buyerAda.id);
sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(context, supplierAda.id);
const obligation = sprint5.sprint4.sprint3.obligations.createTradePayable(context, {
  buyerBusinessClientId: buyer.id,
  supplierBusinessClientId: supplier.id,
  amountMinorUnits: "500000000",
  dueDate: "2026-12-31",
  externalReference: "INV-S6-DEMO"
});
sprint5.sprint4.sprint3.obligations.approveObligation(context, obligation.id);
const reservation = sprint5.sprint4.sprint3.obligations.activateReservation(context, {
  settlementObligationId: obligation.id,
  accountOfDigitalAssetId: buyerAda.id,
  amountMinorUnits: "500000000",
  expectedBalanceVersion: sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, buyerAda.id).version
});
const recipient = app.externalRedemption.registerRecipient(context, {
  label: "External supplier wallet",
  chain: "base",
  address: "0xabc123456789"
});
const externalPayment = app.externalRedemption.submitExternalPayment(context, {
  sourceAccountOfDigitalAssetId: buyerAda.id,
  externalRecipientId: recipient.id,
  settlementObligationId: obligation.id,
  fundingReservationId: reservation.id,
  amountMinorUnits: "500000000",
  idempotencyKey: "demo_ext_001"
});
const failedObligation = sprint5.sprint4.sprint3.obligations.createTradePayable(context, {
  buyerBusinessClientId: buyer.id,
  supplierBusinessClientId: supplier.id,
  amountMinorUnits: "100000000",
  dueDate: "2027-01-15",
  externalReference: "INV-S6-DEMO-FAIL"
});
sprint5.sprint4.sprint3.obligations.approveObligation(context, failedObligation.id);
const failedReservation = sprint5.sprint4.sprint3.obligations.activateReservation(context, {
  settlementObligationId: failedObligation.id,
  accountOfDigitalAssetId: buyerAda.id,
  amountMinorUnits: "100000000",
  expectedBalanceVersion: sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, buyerAda.id).version
});
const failedPayment = app.externalRedemption.submitExternalPayment(context, {
  sourceAccountOfDigitalAssetId: buyerAda.id,
  externalRecipientId: recipient.id,
  settlementObligationId: failedObligation.id,
  fundingReservationId: failedReservation.id,
  amountMinorUnits: "100000000",
  idempotencyKey: "demo_ext_fail_001",
  simulateFailure: true
});
const wire = app.externalRedemption.linkFiatWireAccount(context, {
  businessClientId: supplier.id,
  bankName: "Supplier Bank",
  accountNumberLast4: "7788",
  routingNumber: "000000002"
});
const redemption = app.externalRedemption.submitRedemption(context, {
  sourceAccountOfDigitalAssetId: supplierAda.id,
  fiatWireAccountId: wire.id,
  amountMinorUnits: "150000000",
  idempotencyKey: "demo_redemption_001"
});
const suspense = app.externalRedemption.submitRedemption(context, {
  sourceAccountOfDigitalAssetId: supplierAda.id,
  fiatWireAccountId: wire.id,
  amountMinorUnits: "50000000",
  idempotencyKey: "demo_redemption_unknown",
  simulateUnknown: true
});

console.log(JSON.stringify({
  externalPayment,
  failedPayment,
  reversalObligations: app.externalRedemption.reversalObligations(context),
  redemption,
  suspense,
  buyerBalance: sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, buyerAda.id),
  supplierBalance: sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, supplierAda.id)
}, stringifyBigInts, 2));
