import { validateBalancedJournal } from "./accounting.js";
import { createSprint1Application } from "./application.js";
import { DomainError } from "./errors.js";
import { resetIdsForTest } from "./ids.js";
import type { ActorContext, TreasuryJournalLine } from "./types.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertThrowsCode = (work: () => unknown, code: string): void => {
  try {
    work();
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

const testSprint1Flow = (): void => {
  resetIdsForTest();
  const { app, store } = createSprint1Application();
  const context = makeContext("tenant_a", "user_operator", "corr_001");

  const client = app.createBusinessClient(context, {
    legalName: "Acme Imports Ltd.",
    country: "CA",
    onboardingStatus: "approved",
    circleClientEntityId: "circle_client_001",
    circleApplicationId: "circle_application_001",
    idempotencyKey: "idem_client_001"
  });

  const account = app.createAccountOfDigitalAsset(context, {
    businessClientId: client.id,
    accountName: "Acme Settlement ADA",
    usePurpose: "settlement",
    circleAccountId: "circle_account_001",
    circleSubAccountId: "circle_sub_account_001",
    idempotencyKey: "idem_ada_001"
  });

  const journal = app.postOpeningJournal(context, {
    accountOfDigitalAssetId: account.id,
    description: "Opening USDC position",
    idempotencyKey: "idem_opening_001",
    amountMinorUnits: "100000000"
  });

  const retriedJournal = app.postOpeningJournal(context, {
    accountOfDigitalAssetId: account.id,
    description: "Opening USDC position",
    idempotencyKey: "idem_opening_001",
    amountMinorUnits: "100000000"
  });

  assert(journal.id === retriedJournal.id, "idempotent retry should return original journal");
  assert(store.journalEntries().length === 1, "idempotent retry must not duplicate posting");
  assert(journal.lines[0]?.ledgerAccountId === "ledger_10020", "opening journal should use posting-rule debit account");
  assert(journal.lines[1]?.ledgerAccountId === "ledger_20400", "opening journal should use posting-rule credit account");

  const statement = app.getAccountStatement(context, account.id);
  assert(statement.journalEntries.length === 1, "statement should include one journal");
  assert(statement.auditTrail.length === 2, "statement should include account and journal audit trail");
  assert(store.outboxEvents().length >= 3, "business client, ADA, and journal writes should emit outbox events");

  assertThrowsCode(() => {
    app.postOpeningJournal(context, {
      accountOfDigitalAssetId: account.id,
      description: "Opening USDC position changed",
      idempotencyKey: "idem_opening_001",
      amountMinorUnits: "100000001"
    });
  }, "idempotency_key_reused_with_different_request");

  assertThrowsCode(() => {
    store.appendOnlyUpdateJournalForTest(journal.id);
  }, "posted_journals_are_append_only");
};

const testTenantIsolation = (): void => {
  resetIdsForTest();
  const { app } = createSprint1Application();
  const tenantA = makeContext("tenant_a", "user_a", "corr_a");
  const tenantB = makeContext("tenant_b", "user_b", "corr_b");

  const client = app.createBusinessClient(tenantA, {
    legalName: "Tenant A Client",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "idem_tenant_client"
  });

  assert(app.getBusinessClient(tenantA, client.id)?.id === client.id, "own tenant should read client");
  assert(app.getBusinessClient(tenantB, client.id) === undefined, "other tenant should not read client");

  assertThrowsCode(() => {
    app.createAccountOfDigitalAsset(tenantB, {
      businessClientId: client.id,
      accountName: "Invalid cross-tenant ADA",
      usePurpose: "settlement",
      idempotencyKey: "idem_cross_tenant_ada"
    });
  }, "tenant_access_denied");
};

const testJournalValidation = (): void => {
  const lineBase = {
    journalEntryId: "journal_1",
    ledgerAccountId: "ledger_1",
    assetCode: "USDC" as const,
    currency: "USD" as const,
    createdAt: "2026-07-14T00:00:00.000Z"
  };

  assertThrowsCode(() => {
    validateBalancedJournal([
      {
        ...lineBase,
        id: "line_1",
        debitMinorUnits: 1n,
        creditMinorUnits: 1n
      }
    ] satisfies TreasuryJournalLine[]);
  }, "journal_line_must_be_single_sided");

  assertThrowsCode(() => {
    validateBalancedJournal([
      {
        ...lineBase,
        id: "line_1",
        debitMinorUnits: 2n,
        creditMinorUnits: 0n
      },
      {
        ...lineBase,
        id: "line_2",
        debitMinorUnits: 0n,
        creditMinorUnits: 1n
      }
    ] satisfies TreasuryJournalLine[]);
  }, "journal_entry_unbalanced");
};

const testMoneyValidation = (): void => {
  resetIdsForTest();
  const { app } = createSprint1Application();
  const context = makeContext("tenant_a", "user_operator", "corr_money");
  const client = app.createBusinessClient(context, {
    legalName: "Money Test Client",
    country: "CA",
    onboardingStatus: "approved",
    idempotencyKey: "idem_money_client"
  });
  const account = app.createAccountOfDigitalAsset(context, {
    businessClientId: client.id,
    accountName: "Money Test ADA",
    usePurpose: "settlement",
    idempotencyKey: "idem_money_ada"
  });

  assertThrowsCode(() => {
    app.postOpeningJournal(context, {
      accountOfDigitalAssetId: account.id,
      description: "Invalid fractional minor units",
      idempotencyKey: "idem_money_fraction",
      amountMinorUnits: "1.25"
    });
  }, "money_amount_must_be_integer_minor_units");
};

const testPostingRuleRejectsAdHocLedgerCodes = (): void => {
  resetIdsForTest();
  const { app } = createSprint1Application();
  const context = makeContext("tenant_a", "user_operator", "corr_posting_rule");
  const client = app.createBusinessClient(context, {
    legalName: "Posting Rule Client",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "idem_posting_rule_client"
  });
  const account = app.createAccountOfDigitalAsset(context, {
    businessClientId: client.id,
    accountName: "Posting Rule ADA",
    usePurpose: "settlement",
    idempotencyKey: "idem_posting_rule_ada"
  });

  assertThrowsCode(() => {
    app.postOpeningJournal(context, {
      accountOfDigitalAssetId: account.id,
      description: "Ad hoc debit account",
      idempotencyKey: "idem_posting_rule_journal",
      debitLedgerAccountCode: "10150",
      amountMinorUnits: "100"
    });
  }, "posting_rule_debit_account_mismatch");
};

const testLifecycleTransitions = (): void => {
  resetIdsForTest();
  const { app } = createSprint1Application();
  const context = makeContext("tenant_a", "user_operator", "corr_lifecycle");

  const draftClient = app.createBusinessClient(context, {
    legalName: "Draft Client",
    country: "US",
    onboardingStatus: "draft",
    idempotencyKey: "idem_lifecycle_draft"
  });

  assertThrowsCode(() => {
    app.mapApprovedOnboarding(context, draftClient.id, "circle_draft_client", "circle_draft_application");
  }, "business_client_invalid_status_transition");

  const submittedClient = app.createBusinessClient(context, {
    legalName: "Submitted Client",
    country: "US",
    onboardingStatus: "submitted",
    idempotencyKey: "idem_lifecycle_submitted"
  });
  const approvedClient = app.mapApprovedOnboarding(
    context,
    submittedClient.id,
    "circle_submitted_client",
    "circle_submitted_application"
  );

  assert(approvedClient.onboardingStatus === "approved", "submitted client should transition to approved");
};

const testOutboxIdsMatchStorageKeys = (): void => {
  resetIdsForTest();
  const { app, store } = createSprint1Application();
  const context = makeContext("tenant_a", "user_operator", "corr_outbox");

  const client = app.createBusinessClient(context, {
    legalName: "Outbox Client",
    country: "US",
    onboardingStatus: "approved",
    idempotencyKey: "idem_outbox_client"
  });
  const account = app.createAccountOfDigitalAsset(context, {
    businessClientId: client.id,
    accountName: "Outbox ADA",
    usePurpose: "settlement",
    idempotencyKey: "idem_outbox_ada"
  });
  app.postOpeningJournal(context, {
    accountOfDigitalAssetId: account.id,
    description: "Outbox journal",
    idempotencyKey: "idem_outbox_journal",
    amountMinorUnits: "100"
  });

  const events = store.outboxEvents();
  assert(new Set(events.map((event) => event.id)).size === events.length, "outbox IDs should be unique");
  assert(events.every((event) => event.id.startsWith("outbox_")), "outbox IDs should use outbox prefix");
  assert(store.outboxEventIdsMatchStorageKeys(), "outbox map keys should match event IDs");
};

const testInboxIdempotency = (): void => {
  const { store } = createSprint1Application();
  const event = store.createInboundEvent("circle_simulator", "event_001", "account_of_digital_asset.provisioned", {
    accountId: "circle_account_001"
  });

  store.insertInboundEvent(event);
  assertThrowsCode(() => {
    store.insertInboundEvent(event);
  }, "inbound_event_duplicate");
};

testSprint1Flow();
testTenantIsolation();
testJournalValidation();
testMoneyValidation();
testPostingRuleRejectsAdHocLedgerCodes();
testLifecycleTransitions();
testOutboxIdsMatchStorageKeys();
testInboxIdempotency();

console.log("Sprint 1 tests passed");
