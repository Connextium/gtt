import { DomainError } from "../sprint1/errors.js";
import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint2Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertThrowsCode = async (work: () => unknown | Promise<unknown>, code: string): Promise<void> => {
  try {
    await work();
  } catch (error) {
    if (error instanceof DomainError) {
      assert(error.code === code, `expected ${code}, got ${error.code}`);
      return;
    }
    if (error instanceof Error) {
      assert(error.message === code, `expected ${code}, got ${error.message}`);
      return;
    }
    throw error;
  }
  throw new Error(`expected ${code} to be thrown`);
};

const makeContext = (tenantId: string, userId: string, correlationId: string): ActorContext => ({
  tenantId,
  userId,
  correlationId,
  roles: ["platform_operator", "treasury_operator"]
});

const prepareApprovedAda = async () => {
  resetIdsForTest();
  const { app, store } = createSprint2Application();
  const context = makeContext("tenant_a", "user_operator", "corr_sprint2");
  const client = app.sprint1.createBusinessClient(context, {
    legalName: "Summit Trading LLC",
    country: "US",
    onboardingStatus: "draft",
    idempotencyKey: "s2_client"
  });
  const onboarding = await app.onboarding.createOnboardingApplication(context, client.id);
  const schema = await app.onboarding.retrieveOnboardingSchema(context, onboarding.id);
  const section = app.onboarding.saveOnboardingSection(context, onboarding.id, "business_information", {
    legal_name: "Summit Trading LLC",
    country: "US",
    registration_number: "REG-001"
  });
  const document = app.onboarding.addDocumentMetadata(context, onboarding.id, {
    documentType: "articles_of_incorporation",
    fileName: "articles.pdf",
    externalReference: "sim-doc-001"
  });
  await app.onboarding.submitOnboardingApplication(context, onboarding.id);
  const approved = await app.onboarding.pollOnboardingStatus(context, onboarding.id);
  const account = app.onboarding.mapApprovedApplication(context, onboarding.id);
  return { app, store, context, client, onboarding: approved, schema, section, document, account };
};

const testOnboardingLifecycle = async (): Promise<void> => {
  const { app, context, client, onboarding, schema, section, document, account } = await prepareApprovedAda();

  assert(onboarding.status === "approved", "onboarding should reach approved state");
  assert(schema.schemaBody.sections.length >= 2, "schema should include sections");
  assert(section.version === 1, "section should be persisted");
  assert(document.status === "metadata_recorded", "document metadata should be recorded");
  assert(account.businessClientId === client.id, "approved onboarding should map to ADA");
  assert(app.onboarding.schemaSnapshotCount() === 1, "schema snapshot should be stored");
  assert(app.onboarding.sectionCount() === 1, "section response should be stored");
  assert(app.onboarding.documentCount() === 1, "document metadata should be stored");

  const mappedClient = app.sprint1.getBusinessClient(context, client.id);
  assert(mappedClient?.onboardingStatus === "approved", "business client should be approved");
  assert(Boolean(mappedClient?.circleApplicationId), "business client should carry Circle application id");
};

const testBalanceProjectionAndStatement = async (): Promise<void> => {
  const { app, context, account } = await prepareApprovedAda();

  app.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: account.id,
    description: "Opening available balance",
    idempotencyKey: "s2_opening_available",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "500000000"
  });
  app.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: account.id,
    description: "Opening suspense balance",
    idempotencyKey: "s2_opening_suspense",
    debitLedgerAccountCode: "10150",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "25000000"
  });

  const balance = app.balances.projectBalancesForAccount(context, account.id);
  assert(balance.availableMinorUnits === 500000000n, "available balance should project from ledger");
  assert(balance.pendingMinorUnits === 0n, "pending bucket should exist");
  assert(balance.reservedMinorUnits === 0n, "reserved bucket should exist");
  assert(balance.lockedMinorUnits === 0n, "locked bucket should exist");
  assert(balance.suspenseMinorUnits === 25000000n, "suspense balance should project from suspense ledger");
  assert(balance.totalMinorUnits === 525000000n, "total should sum buckets");

  const statement = app.balances.generateAccountStatement(context, account.id);
  assert(statement.movements.length === 2, "statement should include movements");
  assert(statement.endingBalance.totalMinorUnits === 525000000n, "statement should include ending balance");

  const updated = app.balances.applyProjectionUpdate(context, account.id, balance.version, {
    ...balance,
    pendingMinorUnits: 1000n
  });
  assert(updated.version === balance.version + 1, "projection update should increment version");

  await assertThrowsCode(async () => {
    app.balances.applyProjectionUpdate(context, account.id, balance.version, {
      ...balance,
      pendingMinorUnits: 2000n
    });
  }, "balance_projection_version_conflict");
};

const testTenantIsolationAndWebhookIdempotency = async (): Promise<void> => {
  const { app, store, context, account, onboarding } = await prepareApprovedAda();
  const otherTenant = makeContext("tenant_b", "user_b", "corr_other");

  await assertThrowsCode(async () => {
    app.balances.getClassifiedBalance(otherTenant, account.id);
  }, "tenant_access_denied");

  assert(app.onboarding.listApplications(otherTenant).length === 0, "other tenant should not list onboarding applications");

  app.onboarding.handleWebhookEvent(context, {
    eventId: "webhook_001",
    eventType: "onboarding.application_approved",
    payload: { onboardingApplicationId: onboarding.id }
  });
  app.onboarding.handleWebhookEvent(context, {
    eventId: "webhook_001",
    eventType: "onboarding.application_approved",
    payload: { onboardingApplicationId: onboarding.id }
  });

  const inboundCount = store.read((state) => state.inboundEvents.size);
  assert(inboundCount === 1, "duplicate webhook should process once");
};

const testProductSurfaceSnapshot = async (): Promise<void> => {
  const { app, context, account } = await prepareApprovedAda();
  app.sprint1.postOpeningJournal(context, {
    accountOfDigitalAssetId: account.id,
    description: "Opening balance",
    idempotencyKey: "s2_surface_opening",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400",
    amountMinorUnits: "1000000"
  });
  app.balances.projectBalancesForAccount(context, account.id);
  const snapshot = app.getProductSurfaceSnapshot(context);
  assert(snapshot.businessClients.length === 1, "surface should list business client");
  assert(snapshot.onboardingApplications.length === 1, "surface should list onboarding application");
  assert(snapshot.accountsOfDigitalAsset.length === 1, "surface should list ADA");
  assert(snapshot.accountBalanceCards[0]?.availableMinorUnits === 1000000n, "surface should show balance card");
};

await testOnboardingLifecycle();
await testBalanceProjectionAndStatement();
await testTenantIsolationAndWebhookIdempotency();
await testProductSurfaceSnapshot();

console.log("Sprint 2 tests passed");
