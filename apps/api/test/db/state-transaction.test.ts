import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { withApiStateTransaction } from "../../src/db/state-transaction.js";

test("commits state transaction changes atomically on success", async () => {
  const state = createInitialState();

  await withApiStateTransaction(state, (draft) => {
    draft.businessClients.push({
      id: "client_txn",
      tenantId: state.tenantId,
      legalName: "Transaction Client",
      country: "US",
      onboardingStatus: "draft",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
  });

  assert.equal(state.businessClients.some((client) => client.id === "client_txn"), true);
});

test("rolls back state transaction changes when work throws", async () => {
  const state = createInitialState();
  const beforeCount = state.businessClients.length;

  await assert.rejects(
    () =>
      withApiStateTransaction(state, (draft) => {
        draft.businessClients.push({
          id: "client_rolled_back",
          tenantId: state.tenantId,
          legalName: "Rolled Back Client",
          country: "US",
          onboardingStatus: "draft",
          createdAt: "2026-01-01T00:00:00.000Z"
        });
        throw new Error("boom");
      }),
    /boom/
  );

  assert.equal(state.businessClients.length, beforeCount);
  assert.equal(state.businessClients.some((client) => client.id === "client_rolled_back"), false);
});

test("rolls back state transaction changes when before-commit persistence throws", async () => {
  const state = createInitialState();
  const beforeCount = state.internalUserInvitations.length;

  await assert.rejects(
    () =>
      withApiStateTransaction(
        state,
        (draft) => {
          draft.internalUserInvitations.push({
            id: "00000000-0000-4000-8000-000000000099",
            tenantId: "00000000-0000-4000-8000-000000000001",
            email: "root@gtt.example",
            displayName: "Root Admin",
            roleCode: "super_admin",
            status: "sent",
            idempotencyKey: "bootstrap-root",
            invitedByUserId: "bootstrap",
            invitedAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2026-01-02T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z"
          });
          return { status: 201 };
        },
        () => {
          throw new Error("database unavailable");
        }
      ),
    /database unavailable/
  );

  assert.equal(state.internalUserInvitations.length, beforeCount);
  assert.equal(state.internalUserInvitations.some((invite) => invite.email === "root@gtt.example"), false);
});
