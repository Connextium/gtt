import { DomainError } from "../sprint1/errors.js";
import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint7Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const operator = (userId = "operator_a"): ActorContext => ({
  tenantId: "tenant_a",
  userId,
  roles: ["platform_operator", "treasury_operator"],
  correlationId: `corr_s7_${userId}`
});

const prepare = () => {
  resetIdsForTest();
  const { app, sprint6 } = createSprint7Application();
  const context = operator();
  const treasury = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(context, {
    legalName: "Treasury",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s7_treasury"
  });
  const buyer = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createBusinessClient(context, {
    legalName: "Buyer",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s7_buyer"
  });
  const sourceAda = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(context, {
    businessClientId: treasury.id,
    accountName: "Treasury Source ADA",
    usePurpose: "operating",
    idempotencyKey: "s7_source_ada"
  });
  const destinationAda = sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.createAccountOfDigitalAsset(context, {
    businessClientId: buyer.id,
    accountName: "Settlement Destination ADA",
    usePurpose: "settlement",
    idempotencyKey: "s7_destination_ada"
  });
  sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: sourceAda.id,
    description: "Treasury liquidity source",
    idempotencyKey: "s7_opening_source",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "1000000000"
  });
  sprint6.sprint5.sprint4.sprint3.sprint2.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: destinationAda.id,
    description: "Settlement starting balance",
    idempotencyKey: "s7_opening_destination",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "100000000"
  });
  sprint6.sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(context, sourceAda.id);
  sprint6.sprint5.sprint4.sprint3.sprint2.balances.projectBalancesForAccount(context, destinationAda.id);
  return { app, sprint6, context, sourceAda, destinationAda };
};

const testRebalanceRecommendationApprovalAndExecution = (): void => {
  const { app, sprint6, context, sourceAda, destinationAda } = prepare();
  const recommendation = app.liquidityReconciliation.recommendForShortfall(context, {
    destinationAccountOfDigitalAssetId: destinationAda.id,
    targetBalanceMinorUnits: "350000000",
    approvalThresholdMinorUnits: "200000000",
    permittedSourceAccountIds: [sourceAda.id],
    estimatedFeeMinorUnits: "0"
  });
  assert(recommendation.amountMinorUnits === 250000000n, "recommendation should cover destination shortfall");
  assert(recommendation.status === "pending_approval", "above-threshold recommendation should require approval");
  assert(app.liquidityReconciliation.operationsConsole(context, "2026-07-14").approvalInbox.length === 1, "approval inbox should show recommendation");

  let makerCheckerBlocked = false;
  try {
    app.liquidityReconciliation.approveRebalance(context, recommendation.id);
  } catch (error) {
    makerCheckerBlocked = error instanceof DomainError && error.code === "maker_checker_same_user_not_allowed";
  }
  assert(makerCheckerBlocked, "maker-checker should reject same user approval");

  const approved = app.liquidityReconciliation.approveRebalance(operator("operator_b"), recommendation.id);
  assert(approved.status === "approved", "second operator should approve recommendation");
  const executed = app.liquidityReconciliation.executeRebalance(context, approved.id);
  assert(executed.status === "executed", "approved rebalance should execute");
  const sourceBalance = sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, sourceAda.id);
  const destinationBalance = sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, destinationAda.id);
  assert(sourceBalance.availableMinorUnits === 750000000n, "source balance should decrease");
  assert(destinationBalance.availableMinorUnits === 350000000n, "destination balance should reach target");
};

const testStalePositionBlocksExecution = (): void => {
  const { app, context, sourceAda, destinationAda } = prepare();
  const recommendation = app.liquidityReconciliation.recommendForShortfall(context, {
    destinationAccountOfDigitalAssetId: destinationAda.id,
    targetBalanceMinorUnits: "250000000",
    approvalThresholdMinorUnits: "500000000",
    permittedSourceAccountIds: [sourceAda.id]
  });
  app.liquidityReconciliation.markPositionSnapshotBroken(recommendation.sourcePositionSnapshotId);
  let blocked = false;
  try {
    app.liquidityReconciliation.executeRebalance(context, recommendation.id);
  } catch (error) {
    blocked = error instanceof DomainError && error.code === "source_position_not_executable";
  }
  assert(blocked, "broken source position should block execution");
};

const testReconciliationBreakAndDailyClose = (): void => {
  const { app, sprint6, context, sourceAda, destinationAda } = prepare();
  app.liquidityReconciliation.captureCircleBalanceSnapshot(context, {
    accountOfDigitalAssetId: sourceAda.id,
    availableMinorUnits: "1000000000"
  });
  app.liquidityReconciliation.captureCircleBalanceSnapshot(context, {
    accountOfDigitalAssetId: destinationAda.id,
    availableMinorUnits: "90000000"
  });
  const reconciliation = app.liquidityReconciliation.runDailyReconciliation(context);
  assert(reconciliation.breaks.length === 1, "one Circle mismatch should create one break");
  const assigned = app.liquidityReconciliation.assignBreak(context, reconciliation.breaks[0]!.id, "ops_user", "Investigating Circle fixture delta");
  assert(assigned.status === "assigned", "break should be assigned");
  const resolved = app.liquidityReconciliation.resolveBreak(context, assigned.id, {
    resolutionType: "evidence_attached",
    note: "Circle snapshot fixture corrected by evidence attachment.",
    evidenceUri: "evidence://circle-balance-s7"
  });
  assert(resolved.status === "resolved", "break should resolve through evidence");
  app.liquidityReconciliation.captureCircleBalanceSnapshot(context, {
    accountOfDigitalAssetId: destinationAda.id,
    availableMinorUnits: sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, destinationAda.id).totalMinorUnits
  });
  const dailyClose = app.liquidityReconciliation.generateDailyClose(context, "2026-07-14");
  assert(dailyClose.status === "ready", "resolved breaks and balanced trial balance should make daily close ready");
  assert(dailyClose.trialBalance.balanced, "trial balance should balance");
};

testRebalanceRecommendationApprovalAndExecution();
testStalePositionBlocksExecution();
testReconciliationBreakAndDailyClose();

console.log("Sprint 7 tests passed");
