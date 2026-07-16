import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint3Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => {
  return typeof value === "bigint" ? value.toString() : value;
};

resetIdsForTest();

const { app, sprint2 } = createSprint3Application();
const operator: ActorContext = {
  tenantId: "tenant_demo",
  userId: "user_platform_operator",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint3_demo"
};

const buyer = sprint2.sprint1.createBusinessClient(operator, {
  legalName: "Cascadia Buyer LLC",
  country: "US",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s3_buyer"
});
const supplier = sprint2.sprint1.createBusinessClient(operator, {
  legalName: "Pacific Supplier Inc.",
  country: "CA",
  onboardingStatus: "approved",
  idempotencyKey: "demo_s3_supplier"
});
const ada = sprint2.sprint1.createAccountOfDigitalAsset(operator, {
  businessClientId: buyer.id,
  accountName: "Cascadia Funding ADA",
  usePurpose: "settlement",
  idempotencyKey: "demo_s3_ada"
});
sprint2.sprint1.postOpeningJournal(operator, {
  accountOfDigitalAssetId: ada.id,
  description: "Sprint 3 available balance",
  idempotencyKey: "demo_s3_opening",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "1200000000"
});
let balance = sprint2.balances.projectBalancesForAccount(operator, ada.id);

const fullObligation = app.obligations.createTradePayable(operator, {
  buyerBusinessClientId: buyer.id,
  supplierBusinessClientId: supplier.id,
  amountMinorUnits: "700000000",
  dueDate: "2026-08-31",
  externalReference: "INV-DEMO-001"
});
app.obligations.approveObligation(operator, fullObligation.id);
const fullReservation = app.obligations.activateReservation(operator, {
  settlementObligationId: fullObligation.id,
  accountOfDigitalAssetId: ada.id,
  amountMinorUnits: "700000000",
  expectedBalanceVersion: balance.version
});

balance = sprint2.balances.getClassifiedBalance(operator, ada.id);
const partialObligation = app.obligations.createTradePayable(operator, {
  buyerBusinessClientId: buyer.id,
  supplierBusinessClientId: supplier.id,
  amountMinorUnits: "500000000",
  disputedMinorUnits: "100000000",
  dueDate: "2026-09-15",
  externalReference: "INV-DEMO-002"
});
app.obligations.approveObligation(operator, partialObligation.id);
const partialReservation = app.obligations.activateReservation(operator, {
  settlementObligationId: partialObligation.id,
  accountOfDigitalAssetId: ada.id,
  amountMinorUnits: "200000000",
  expectedBalanceVersion: balance.version
});

let overReservationBlocked = false;
try {
  app.obligations.activateReservation(operator, {
    settlementObligationId: partialObligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "400000000",
    expectedBalanceVersion: sprint2.balances.getClassifiedBalance(operator, ada.id).version
  });
} catch {
  overReservationBlocked = true;
}

app.obligations.releaseReservation(operator, partialReservation.id, "buyer_dispute");
const expiringReservation = app.obligations.activateReservation(operator, {
  settlementObligationId: partialObligation.id,
  accountOfDigitalAssetId: ada.id,
  amountMinorUnits: "100000000",
  expectedBalanceVersion: sprint2.balances.getClassifiedBalance(operator, ada.id).version,
  expiresAt: "2026-09-01T00:00:00.000Z"
});
app.obligations.expireReservation(operator, expiringReservation.id, "reservation_expired");

const concurrent = app.obligations.simulateConcurrentReservationAttempts(operator, [
  {
    settlementObligationId: partialObligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "100000000",
    expectedBalanceVersion: sprint2.balances.getClassifiedBalance(operator, ada.id).version
  },
  {
    settlementObligationId: partialObligation.id,
    accountOfDigitalAssetId: ada.id,
    amountMinorUnits: "100000000",
    expectedBalanceVersion: sprint2.balances.getClassifiedBalance(operator, ada.id).version
  }
]);

const fullDetail = app.obligations.getObligationDetail(operator, fullObligation.id);
const partialDetail = app.obligations.getObligationDetail(operator, partialObligation.id);

console.log(
  JSON.stringify(
    {
      fullObligation: {
        id: fullDetail.obligation.id,
        fundingStatus: fullDetail.obligation.fundingStatus,
        fundedMinorUnits: fullDetail.fundedMinorUnits,
        reservationId: fullReservation.id
      },
      partialObligation: {
        id: partialDetail.obligation.id,
        fundingStatus: partialDetail.obligation.fundingStatus,
        reservableMinorUnits: partialDetail.reservableMinorUnits,
        timelineEvents: partialDetail.timeline.map((event) => ({
          eventType: event.eventType,
          reasonCode: event.reasonCode
        }))
      },
      classifiedBalance: sprint2.balances.getClassifiedBalance(operator, ada.id),
      overReservationBlocked,
      concurrentReservationResult: {
        accepted: concurrent.accepted.length,
        rejected: concurrent.rejected
      },
      accountingEvidenceBalanced: app.obligations.accountingEvidenceFor().every((event) => event.balanced)
    },
    stringifyBigInts,
    2
  )
);
