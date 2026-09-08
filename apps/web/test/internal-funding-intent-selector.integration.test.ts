import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInternalTreasuryInstructionCreateRequest,
  evaluateExternalizationIntentPolicy
} from "../src/internal/operations/internal-funding-intent-policy.ts";

test("intent selector policy gates wallet and fiat externalization correctly", () => {
  const virtualOnly = evaluateExternalizationIntentPolicy("none", false, false);
  assert.equal(virtualOnly.externalizationChecksPass, true);
  assert.equal(virtualOnly.railValidationBlockReason, "");

  const walletBlocked = evaluateExternalizationIntentPolicy("wallet", false, true);
  assert.equal(walletBlocked.externalizationChecksPass, false);
  assert.match(walletBlocked.railValidationBlockReason, /verified Circle wallet route/i);

  const walletAllowed = evaluateExternalizationIntentPolicy("wallet", true, false);
  assert.equal(walletAllowed.externalizationChecksPass, true);
  assert.equal(walletAllowed.railValidationBlockReason, "");

  const fiatBlocked = evaluateExternalizationIntentPolicy("fiat", true, false);
  assert.equal(fiatBlocked.externalizationChecksPass, false);
  assert.match(fiatBlocked.railValidationBlockReason, /active or verified fiat route/i);

  const fiatAllowed = evaluateExternalizationIntentPolicy("fiat", false, true);
  assert.equal(fiatAllowed.externalizationChecksPass, true);
  assert.equal(fiatAllowed.railValidationBlockReason, "");
});

test("create request preserves selected externalization intent", () => {
  const payload = buildInternalTreasuryInstructionCreateRequest({
    sourceAccountOfDigitalAssetId: "ada_source_001",
    destinationAccountOfDigitalAssetId: "ada_destination_001",
    externalizationIntent: "wallet",
    amountMinorUnits: "1000000",
    routePreference: "System Optimal",
    purpose: "Treasury rebalance"
  });

  assert.equal(payload.instructionType, "internal_ada_settlement");
  assert.equal(payload.externalizationIntent, "wallet");
  assert.equal(payload.currency, "USD");
  assert.equal(payload.amountMinorUnits, "1000000");
  assert.equal(payload.routePreference, "System Optimal");
});
