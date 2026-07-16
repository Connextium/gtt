import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint4Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

resetIdsForTest();
const { app, sprint3 } = createSprint4Application();
const ctx: ActorContext = {
  tenantId: "tenant_demo",
  userId: "user_demo",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint4_demo"
};

const buyer = sprint3.sprint2.sprint1.createBusinessClient(ctx, {
  legalName: "Demo Buyer",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s4_buyer"
});
const supplier = sprint3.sprint2.sprint1.createBusinessClient(ctx, {
  legalName: "Demo Supplier",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s4_supplier"
});
const ada = sprint3.sprint2.sprint1.createAccountOfDigitalAsset(ctx, {
  businessClientId: buyer.id,
  accountName: "Demo Buyer ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s4_ada"
});
sprint3.sprint2.sprint1.postOpeningJournal(ctx, {
  accountOfDigitalAssetId: ada.id,
  description: "Sprint 4 liquidity",
  idempotencyKey: "demo_s4_opening",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "1000000000"
});
const balance = sprint3.sprint2.balances.projectBalancesForAccount(ctx, ada.id);
const obligation = sprint3.obligations.createTradePayable(ctx, {
  buyerBusinessClientId: buyer.id,
  supplierBusinessClientId: supplier.id,
  amountMinorUnits: "700000000",
  dueDate: "2026-10-15",
  externalReference: "INV-S4-DEMO"
});
sprint3.obligations.approveObligation(ctx, obligation.id);
sprint3.obligations.activateReservation(ctx, {
  settlementObligationId: obligation.id,
  accountOfDigitalAssetId: ada.id,
  amountMinorUnits: "300000000",
  expectedBalanceVersion: balance.version
});
app.positions.setPolicy(ctx, {
  scopeType: "account",
  scopeId: ada.id,
  minimumBalanceMinorUnits: 500000000n,
  targetBalanceMinorUnits: 700000000n,
  maximumBalanceMinorUnits: 900000000n,
  approvalThresholdMinorUnits: 100000000n,
  staleAfterSeconds: 1,
  permittedSourceAccountIds: [ada.id],
  permittedDestinationAccountIds: [ada.id]
});
const accountPosition = app.positions.calculateAccountPosition(ctx, ada.id);
const actorPosition = app.positions.calculateActorPosition(ctx, buyer.id);
const staleAutomationAllowed = app.positions.markStaleAndBlockAutomation(accountPosition.id);

console.log(
  JSON.stringify(
    {
      accountPosition,
      actorPosition,
      maturityLadder: app.positions.maturityLadder(ctx, buyer.id),
      alerts: app.positions.openAlerts(ctx),
      staleAutomationAllowed
    },
    stringifyBigInts,
    2
  )
);
