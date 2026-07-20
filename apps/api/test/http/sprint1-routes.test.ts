import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { handleApiRequest } from "../../src/http/router.js";

test("business client lifecycle rejects approval before submission", async () => {
  const state = createInitialState();
  const created = await handleApiRequest(state, {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "Lifecycle Client", country: "US" }
  });
  const clientId = ((created.body as { businessClient: { id: string } }).businessClient.id);

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: `/business-clients/${clientId}/map-circle`,
    body: { circleClientEntityId: "circle_client_lifecycle", circleApplicationId: "circle_app_lifecycle" }
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "business_client_invalid_status_transition" });
});

test("approved business client can receive an ADA", async () => {
  const state = createInitialState();
  const created = await handleApiRequest(state, {
    method: "POST",
    pathname: "/business-clients",
    body: { legalName: "ADA Client", country: "US" }
  });
  const clientId = ((created.body as { businessClient: { id: string } }).businessClient.id);
  await handleApiRequest(state, { method: "POST", pathname: `/business-clients/${clientId}/submit-onboarding` });
  await handleApiRequest(state, {
    method: "POST",
    pathname: `/business-clients/${clientId}/map-circle`,
    body: { circleClientEntityId: "circle_client_ada", circleApplicationId: "circle_app_ada" }
  });

  const account = await handleApiRequest(state, {
    method: "POST",
    pathname: "/accounts-of-digital-asset",
    body: { businessClientId: clientId, accountName: "Primary ADA" }
  });

  assert.equal(account.status, 201);
  assert.equal((account.body as { account: { businessClientId: string } }).account.businessClientId, clientId);
});

test("posting rule endpoint and opening journal event use controlled ledger accounts", async () => {
  const state = createInitialState();
  const rules = await handleApiRequest(state, { method: "GET", pathname: "/ledger/posting-rules" });

  assert.equal(rules.status, 200);
  assert.equal((rules.body as { postingRules: Array<{ debitLedgerAccountCode: string }> }).postingRules[0]?.debitLedgerAccountCode, "10020");

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: "/ledger/events/opening-journal",
    body: {
      accountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "1000000",
      description: "Opening event"
    }
  });

  const journal = (result.body as { journal: { debitLedgerAccountCode: string; creditLedgerAccountCode: string } }).journal;
  assert.equal(result.status, 201);
  assert.equal(journal.debitLedgerAccountCode, "10020");
  assert.equal(journal.creditLedgerAccountCode, "20400");
});

test("chart of accounts includes customer ADA liability accounts", async () => {
  const state = createInitialState();
  const result = await handleApiRequest(state, { method: "GET", pathname: "/ledger/chart-of-accounts" });
  const codes = (result.body as { accounts: Array<{ accountCode: string }> }).accounts.map((account) => account.accountCode);

  assert.equal(codes.includes("20430"), true);
  assert.equal(codes.includes("20440"), true);
});
