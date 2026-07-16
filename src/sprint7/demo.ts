import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint7Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

resetIdsForTest();
const { app, sprint6 } = createSprint7Application();
const maker: ActorContext = {
  tenantId: "tenant_demo",
  userId: "maker_demo",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint7_maker"
};
const checker: ActorContext = {
  tenantId: "tenant_demo",
  userId: "checker_demo",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint7_checker"
};

const treasury = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(maker, {
  legalName: "Demo Treasury",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s7_treasury"
});
const buyer = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(maker, {
  legalName: "Demo Buyer",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s7_buyer"
});
const sourceAda = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(maker, {
  businessClientId: treasury.id,
  accountName: "Demo Treasury Source ADA",
  usePurpose: "operating",
  idempotencyKey: "demo_s7_source_ada"
});
const destinationAda = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(maker, {
  businessClientId: buyer.id,
  accountName: "Demo Settlement ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s7_destination_ada"
});
sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(maker, {
  accountOfDigitalAssetId: sourceAda.id,
  description: "Demo treasury liquidity source",
  idempotencyKey: "demo_s7_source_opening",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "1200000000"
});
sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(maker, {
  accountOfDigitalAssetId: destinationAda.id,
  description: "Demo settlement shortfall",
  idempotencyKey: "demo_s7_destination_opening",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "100000000"
});
sprint6.sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(maker, sourceAda.id);
sprint6.sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(maker, destinationAda.id);

const recommendation = app.liquidityReconciliation.recommendForShortfall(maker, {
  destinationAccountOfDigitalAssetId: destinationAda.id,
  targetBalanceMinorUnits: "400000000",
  approvalThresholdMinorUnits: "200000000",
  permittedSourceAccountIds: [sourceAda.id]
});
const approved = app.liquidityReconciliation.approveRebalance(checker, recommendation.id);
const executed = app.liquidityReconciliation.executeRebalance(maker, approved.id);

app.liquidityReconciliation.captureCircleBalanceSnapshot(maker, {
  accountOfDigitalAssetId: sourceAda.id,
  availableMinorUnits: sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(maker, sourceAda.id).totalMinorUnits
});
app.liquidityReconciliation.captureCircleBalanceSnapshot(maker, {
  accountOfDigitalAssetId: destinationAda.id,
  availableMinorUnits: "390000000"
});
const reconciliation = app.liquidityReconciliation.runDailyReconciliation(maker);
const assignedBreak = app.liquidityReconciliation.assignBreak(maker, reconciliation.breaks[0]!.id, "ops_demo", "Investigate simulated Circle mismatch");
const resolvedBreak = app.liquidityReconciliation.resolveBreak(maker, assignedBreak.id, {
  resolutionType: "evidence_attached",
  note: "Attached corrected Circle balance evidence for daily close.",
  evidenceUri: "evidence://demo/sprint7/circle-balance"
});
app.liquidityReconciliation.captureCircleBalanceSnapshot(maker, {
  accountOfDigitalAssetId: destinationAda.id,
  availableMinorUnits: sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(maker, destinationAda.id).totalMinorUnits
});

console.log(JSON.stringify({
  recommendation,
  approved,
  executed,
  reconciliationRun: reconciliation.run,
  reconciliationBreak: reconciliation.breaks[0],
  resolvedBreak,
  trialBalance: app.liquidityReconciliation.trialBalance(maker),
  operationsConsole: app.liquidityReconciliation.operationsConsole(maker, "2026-07-14"),
  sourceBalance: sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(maker, sourceAda.id),
  destinationBalance: sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(maker, destinationAda.id)
}, stringifyBigInts, 2));
