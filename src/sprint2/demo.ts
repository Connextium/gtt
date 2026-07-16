import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint2Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => {
  return typeof value === "bigint" ? value.toString() : value;
};

resetIdsForTest();

const { app, store } = createSprint2Application();
const operator: ActorContext = {
  tenantId: "tenant_demo",
  userId: "user_platform_operator",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint2_demo"
};

const client = app.sprint1.createBusinessClient(operator, {
  legalName: "Harbor Components Inc.",
  country: "CA",
  onboardingStatus: "draft",
  idempotencyKey: "demo_s2_client"
});

const onboarding = await app.onboarding.createOnboardingApplication(operator, client.id);
const schema = await app.onboarding.retrieveOnboardingSchema(operator, onboarding.id);
app.onboarding.saveOnboardingSection(operator, onboarding.id, "business_information", {
  legal_name: "Harbor Components Inc.",
  country: "CA",
  registration_number: "BC-2026-001"
});
app.onboarding.addDocumentMetadata(operator, onboarding.id, {
  documentType: "business_registration",
  fileName: "business-registration.pdf",
  externalReference: "sim-doc-demo"
});
await app.onboarding.submitOnboardingApplication(operator, onboarding.id);
const approved = await app.onboarding.pollOnboardingStatus(operator, onboarding.id);
const account = app.onboarding.mapApprovedApplication(operator, onboarding.id);

app.sprint1.postOpeningJournal(operator, {
  accountOfDigitalAssetId: account.id,
  description: "Sprint 2 opening available balance",
  idempotencyKey: "demo_s2_opening_available",
  debitLedgerAccountCode: "10020",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "750000000"
});
app.sprint1.postOpeningJournal(operator, {
  accountOfDigitalAssetId: account.id,
  description: "Sprint 2 suspense balance",
  idempotencyKey: "demo_s2_suspense",
  debitLedgerAccountCode: "10150",
  creditLedgerAccountCode: "20400",
  amountMinorUnits: "10000000"
});

const balance = app.balances.projectBalancesForAccount(operator, account.id);
let staleVersionRejected = false;
try {
  app.balances.applyProjectionUpdate(operator, account.id, balance.version - 1, {
    ...balance,
    pendingMinorUnits: 1n
  });
} catch {
  staleVersionRejected = true;
}

app.onboarding.handleWebhookEvent(operator, {
  eventId: "demo_webhook_001",
  eventType: "onboarding.application_approved",
  payload: { onboardingApplicationId: onboarding.id }
});
app.onboarding.handleWebhookEvent(operator, {
  eventId: "demo_webhook_001",
  eventType: "onboarding.application_approved",
  payload: { onboardingApplicationId: onboarding.id }
});

const statement = app.balances.generateAccountStatement(operator, account.id);
const surface = app.getProductSurfaceSnapshot(operator);

console.log(
  JSON.stringify(
    {
      onboardingApplicationId: onboarding.id,
      providerApplicationId: onboarding.providerApplicationId,
      onboardingStatus: approved.status,
      schemaVersion: schema.schemaVersion,
      accountOfDigitalAssetId: account.id,
      classifiedBalance: balance,
      statementMovementCount: statement.movements.length,
      staleVersionRejected,
      inboundEventCount: store.read((state) => state.inboundEvents.size),
      surfaceCounts: {
        businessClients: surface.businessClients.length,
        onboardingApplications: surface.onboardingApplications.length,
        accountsOfDigitalAsset: surface.accountsOfDigitalAsset.length,
        accountBalanceCards: surface.accountBalanceCards.length
      }
    },
    stringifyBigInts,
    2
  )
);
