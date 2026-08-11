import assert from "node:assert/strict";
import test from "node:test";
import { mintFromFiatWireAccountService } from "../../src/services/fiat-wire-mint-service.js";

test("mint request remains pending and does not mutate ADA balance before webhook confirmation", async () => {
  const statusUpdates: string[] = [];
  const events: string[] = [];
  let balanceMutationCount = 0;
  const repository = {
    findWireAccount: async () => ({
      id: "wire-linked-instrument",
      accountOfDigitalAssetId: "tenant-fiat-ada",
      status: "active",
      metadata: {}
    }),
    findLatestVerifiedCircleWalletLinkedInstrument: async () => ({
      id: "wallet-linked-instrument",
      metadata: { walletId: "circle-wallet", address: "0x1234" }
    }),
    findDefaultFiatWireLinkedInstrument: async () => ({ id: "wire-linked-instrument", metadata: {} }),
    findFundingInstruction: async () => ({ instructionRole: "internal_treasury_mint" }),
    updateFundingInstructionStatus: async (_tenantId: string, _instructionId: string, status: string) => {
      statusUpdates.push(status);
    },
    updateFundingInstructionOrders: async () => undefined,
    insertMintCircleOperation: async () => undefined,
    findTargetAccountBalance: async () => {
      balanceMutationCount += 1;
      return undefined;
    },
    updateTargetAccountBalance: async () => {
      balanceMutationCount += 1;
    },
    insertTargetAccountBalance: async () => {
      balanceMutationCount += 1;
    }
  };
  const circleTreasury = {
    mintFiatToWallet: async () => ({
      status: "complete",
      providerRequestId: "provider-mint-request",
      providerWalletId: "circle-wallet",
      responsePayload: {}
    })
  };

  const result = await mintFromFiatWireAccountService(
    repository as never,
    circleTreasury as never,
    async () => ({ status: 201, body: {} }),
    async (eventType) => { events.push(eventType); },
    async () => ({ businessClientId: "internal-client", status: "active" }),
    async () => ({ id: "circle-operation" }),
    "tenant-id",
    {
      method: "POST",
      pathname: "/fiat/wire-accounts/wire-linked-instrument/mint",
      body: {
        targetAccountOfDigitalAssetId: "tenant-usdc-ada",
        amountMinorUnits: "2500000",
        fundingInstructionId: "funding-instruction"
      },
      idempotencyKey: "mint-request-key",
      correlationId: "mint-correlation"
    },
    "wire-linked-instrument",
    () => "simulator"
  );

  assert.equal(result.status, 201);
  assert.equal((result.body.mint as { status: string }).status, "pending_confirmation");
  assert.deepEqual(statusUpdates, ["pending_provider", "pending_confirmation"]);
  assert.deepEqual(events, ["fiat.mint.requested"]);
  assert.equal(balanceMutationCount, 0);
});