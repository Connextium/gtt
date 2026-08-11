import assert from "node:assert/strict";
import test from "node:test";
import { isPostgresRoute } from "../../src/db/components/postgres-route-registry.js";

test("postgres route registry recognizes supported route families", () => {
  const supportedRoutes = [
    ["GET", "/api-keys/key-1"],
    ["GET", "/business-clients/client-1"],
    ["GET", "/accounts-of-digital-asset/account-1/balances"],
    ["GET", "/accounts-of-digital-asset/account-1/statements"],
    ["GET", "/accounts-of-digital-asset/account-1/linked-instruments"],
    ["GET", "/ledger/journals/journal-1"],
    ["GET", "/funding-instructions/instruction-1/orders"],
    ["GET", "/business/me/funding-instructions"],
    ["GET", "/business/me/funding-instructions/instruction-1"],
    ["GET", "/business/me/funding-instructions/instruction-1/orders"],
    ["GET", "/fiat/redemptions/redemption-1"],
    ["GET", "/internal/treasury/credit-line"],
    ["GET", "/internal/treasury/settlement-advance"],
    ["GET", "/internal/treasury/settlement-advance/transfer-1"],
    ["GET", "/internal/treasury/tenant-disbursements"],
    ["GET", "/internal/treasury/tenant-disbursements/disbursement-1"],
    ["GET", "/internal/operations/linked-wire-accounts"],
    ["GET", "/internal/operations/linked-wire-accounts/instrument-1"],
    ["GET", "/treasury-accounting/trial-balance"],
    ["POST", "/api-keys/key-1/rotate"],
    ["POST", "/accounts-of-digital-asset/account-1/provision-circle"],
    ["POST", "/accounts-of-digital-asset/account-1/linked-instruments/instrument-1/verify"],
    ["POST", "/funding-reservations/reservation-1/release"],
    ["POST", "/business/me/funding-instructions"],
    ["POST", "/payments/payment-1/refresh-status"],
    ["POST", "/fiat/wire-accounts/wire-1/mint"],
    ["POST", "/internal/treasury/settlement-advance/reserve"],
    ["POST", "/internal/treasury/tenant-disbursements"],
    ["POST", "/internal/treasury/tenant-disbursements/disbursement-1/approve"],
    ["POST", "/internal/operations/linked-wire-accounts/instrument-1/refresh-instructions"],
    ["PUT", "/internal/treasury/settlement-advance/transfer-1/request"],
    ["PUT", "/internal/treasury/settlement-advance/transfer-1/cancel"],
    ["PUT", "/internal/treasury/tenant-disbursements/disbursement-1/submit"],
    ["POST", "/webhooks/circle"],
    ["POST", "/internal/webhooks/circle/event-1/reprocess"],
    ["POST", "/ledger/journals/journal-1/reverse"],
    ["PATCH", "/accounts-of-digital-asset/account-1/linked-instruments/instrument-1"]
  ] as const;

  for (const [method, pathname] of supportedRoutes) {
    assert.equal(isPostgresRoute(method, pathname), true, `${method} ${pathname}`);
  }
});

test("postgres route registry rejects unsupported method and path combinations", () => {
  const unsupportedRoutes = [
    ["DELETE", "/api-keys/key-1"],
    ["PATCH", "/accounts-of-digital-asset/account-1"],
    ["GET", "/webhooks/circle"],
    ["POST", "/ledger/chart-of-accounts"],
    ["POST", "/accounts-of-digital-asset/account-1/linked-instruments/instrument-1"],
    ["GET", "/funding-instructions/instruction-1/orders/extra"]
  ] as const;

  for (const [method, pathname] of unsupportedRoutes) {
    assert.equal(isPostgresRoute(method, pathname), false, `${method} ${pathname}`);
  }
});
