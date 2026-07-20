import { createSprint1Application } from "./application.js";
import { resetIdsForTest } from "./ids.js";
import type { ActorContext } from "./types.js";

resetIdsForTest();

const { app, store } = createSprint1Application();

const operator: ActorContext = {
  tenantId: "tenant_demo",
  userId: "user_platform_operator",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint1_demo"
};

const client = app.createBusinessClient(operator, {
  legalName: "Northstar Buyer LLC",
  country: "US",
  onboardingStatus: "approved",
  circleClientEntityId: "circle_client_demo",
  circleApplicationId: "circle_application_demo",
  idempotencyKey: "demo_client_create"
});

const account = app.createAccountOfDigitalAsset(operator, {
  businessClientId: client.id,
  accountName: "Northstar Settlement ADA",
  usePurpose: "settlement",
  circleAccountId: "circle_account_demo",
  circleSubAccountId: "circle_sub_account_demo",
  idempotencyKey: "demo_ada_create"
});

const journal = app.postOpeningJournal(operator, {
  accountOfDigitalAssetId: account.id,
  description: "Sprint 1 balanced opening journal",
  idempotencyKey: "demo_opening_journal",
  amountMinorUnits: "250000000"
});

let unbalancedRejected = false;
try {
  app.postOpeningJournal(operator, {
    accountOfDigitalAssetId: account.id,
    description: "Invalid fractional journal",
    idempotencyKey: "demo_invalid_journal",
    amountMinorUnits: "1.5"
  });
} catch {
  unbalancedRejected = true;
}

const retriedJournal = app.postOpeningJournal(operator, {
  accountOfDigitalAssetId: account.id,
  description: "Sprint 1 balanced opening journal",
  idempotencyKey: "demo_opening_journal",
  amountMinorUnits: "250000000"
});

const statement = app.getAccountStatement(operator, account.id);

const result = {
  businessClientId: client.id,
  accountOfDigitalAssetId: account.id,
  journalEntryId: journal.id,
  retriedJournalEntryId: retriedJournal.id,
  duplicatePostingPrevented: store.journalEntries().length === 1 && journal.id === retriedJournal.id,
  invalidMoneyRejected: unbalancedRejected,
  statementJournalCount: statement.journalEntries.length,
  auditTraceCount: statement.auditTrail.length,
  outboxEventCount: store.outboxEvents().length
};

console.log(JSON.stringify(result, null, 2));
