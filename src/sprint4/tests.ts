import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint4Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const context = (): ActorContext => ({
  tenantId: "tenant_a",
  userId: "user_a",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_s4"
});

const prepare = () => {
  resetIdsForTest();
  const { app, sprint3 } = createSprint4Application();
  const ctx = context();
  const buyer = sprint3.sprint2.sprint1.createBusinessClient(ctx, {
    legalName: "Buyer",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s4_buyer"
  });
  const supplier = sprint3.sprint2.sprint1.createBusinessClient(ctx, {
    legalName: "Supplier",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "s4_supplier"
  });
  const ada = sprint3.sprint2.sprint1.createAccountOfDigitalAsset(ctx, {
    businessClientId: buyer.id,
    accountName: "Buyer ADA",
    usePurpose: "settlement",
    idempotencyKey: "s4_ada"
  });
  sprint3.sprint2.sprint1.postOpeningJournal(ctx, {
    accountOfDigitalAssetId: ada.id,
    description: "S4 balance",
    idempotencyKey: "s4_opening",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "1000000000"
  });
  const balance = sprint3.sprint2.balances.projectBalancesForAccount(ctx, ada.id);
  const obligation = sprint3.obligations.createTradePayable(ctx, {
    buyerBusinessClientId: buyer.id,
    supplierBusinessClientId: supplier.id,
    amountMinorUnits: "600000000",
    dueDate: "2026-09-30",
    externalReference: "INV-S4"
  });
  sprint3.obligations.approveObligation(ctx, obligation.id);
  sprint3.obligations.activateReservation(ctx, {
    settlementObligationId: obligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "300000000",
    expectedBalanceVersion: balance.version
  });
  return { app, sprint3, ctx, buyer, supplier, ada };
};

const testPositionsAndPolicy = (): void => {
  const { app, ctx, buyer, ada } = prepare();
  app.positions.setPolicy(ctx, {
    scopeType: "account",
    scopeId: ada.id,
    minimumBalanceMinorUnits: 200000000n,
    targetBalanceMinorUnits: 500000000n,
    maximumBalanceMinorUnits: 900000000n,
    approvalThresholdMinorUnits: 250000000n,
    staleAfterSeconds: 1,
    permittedSourceAccountIds: [ada.id],
    permittedDestinationAccountIds: [ada.id]
  });
  const position = app.positions.calculateAccountPosition(ctx, ada.id);
  assert(position.currentMinorUnits === 1000000000n, "current position should sum buckets");
  assert(position.deployableMinorUnits === 200000000n, "deployable should subtract reserved and buffer");
  assert(position.expectedPayableMinorUnits === 600000000n, "expected payable should include approved obligation");
  assert(position.projectedMinorUnits === 400000000n, "projected position should reflect payable");
  assert(position.positionVersion === 1, "first position version should be one");

  const next = app.positions.calculateAccountPosition(ctx, ada.id, { pendingInboundMinorUnits: 100000000n });
  assert(next.positionVersion === 2, "position version should increment");

  const actor = app.positions.calculateActorPosition(ctx, buyer.id);
  assert(actor.currentMinorUnits >= position.currentMinorUnits, "actor position should consolidate account positions");
};

const testAlertsStaleAndMaturity = (): void => {
  const { app, ctx, buyer, ada } = prepare();
  app.positions.setPolicy(ctx, {
    scopeType: "account",
    scopeId: ada.id,
    minimumBalanceMinorUnits: 500000000n,
    targetBalanceMinorUnits: 700000000n,
    maximumBalanceMinorUnits: 800000000n,
    approvalThresholdMinorUnits: 100000000n,
    staleAfterSeconds: 1,
    permittedSourceAccountIds: [ada.id],
    permittedDestinationAccountIds: [ada.id]
  });
  const shortfallPosition = app.positions.calculateAccountPosition(ctx, ada.id);
  assert(app.positions.openAlerts(ctx).some((alert) => alert.alertType === "shortfall"), "shortfall alert should open");

  app.positions.setPolicy(ctx, {
    scopeType: "account",
    scopeId: ada.id,
    minimumBalanceMinorUnits: 0n,
    targetBalanceMinorUnits: 100000000n,
    maximumBalanceMinorUnits: 300000000n,
    approvalThresholdMinorUnits: 100000000n,
    staleAfterSeconds: 1,
    permittedSourceAccountIds: [ada.id],
    permittedDestinationAccountIds: [ada.id]
  });
  app.positions.calculateAccountPosition(ctx, ada.id, { expectedReceivableMinorUnits: 100000000n });
  assert(app.positions.openAlerts(ctx).some((alert) => alert.alertType === "surplus"), "surplus alert should open");
  assert(app.positions.markStaleAndBlockAutomation(shortfallPosition.id) === false, "stale position should block automation");
  assert(app.positions.openAlerts(ctx).some((alert) => alert.alertType === "stale_position"), "stale alert should open");

  const ladder = app.positions.maturityLadder(ctx, buyer.id);
  assert(ladder.length === 1 && ladder[0]?.dueDate === "2026-09-30", "maturity ladder should include obligation due date");
};

testPositionsAndPolicy();
testAlertsStaleAndMaturity();

console.log("Sprint 4 tests passed");
