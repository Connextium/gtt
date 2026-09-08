import assert from "node:assert/strict";
import test from "node:test";
import { provisionCircleAccountService } from "../../src/services/ada-circle-provision-service.js";
import type { AdaCircleProvisionRepository } from "../../src/db/repositories/ada-circle-provision-repository.js";
import type { CircleTreasuryService } from "../../src/services/circle-treasury-service.js";
import type { PostgresRouteInput } from "../../src/db/postgres-route-types.js";

const tenantId = "tenant-1";
const accountId = "ada-1";
const businessClientId = "client-1";
const correlationId = "corr-1";
const idempotencyKey = "idem-1";

const baseInput = (body: Record<string, unknown>): PostgresRouteInput => ({
  method: "POST",
  pathname: `/accounts-of-digital-asset/${accountId}/provision-circle`,
  body,
  correlationId,
  idempotencyKey
});

const baseAccount = {
  id: accountId,
  status: "active",
  businessClientId,
  usePurpose: "tenant_central",
  onboardingStatus: "approved",
  circleWalletSetId: "wallet-set-1",
  legalName: "Client One"
};

test("wallet-only provisioning skips sandbox wire setup", async () => {
  let sandboxWireCalls = 0;
  let linkedInstrumentInserts = 0;

  const repo: AdaCircleProvisionRepository = {
    findAccountWithClient: async () => baseAccount,
    findExistingCircleWallet: async () => undefined,
    findSuccessfulMappingOperation: async () => undefined,
    findReplayedOperation: async () => undefined,
    insertCircleOperation: async () => undefined,
    insertLinkedInstrument: async () => {
      linkedInstrumentInserts += 1;
      return {
        id: "linked-1",
        account_of_digital_asset_id: accountId,
        instrument_type: "circle_wallet",
        status: "active",
        asset_code: "circle_wallet_1",
        rail_type: "on-chain",
        purpose: "tenant_central",
        provider: "circle",
        verification_status: "verified",
        network_code: "ETH-SEPOLIA",
        is_default: true,
        metadata: { walletSetId: "wallet-set-1", walletId: "wallet-1" },
        created_at: "2026-01-01T00:00:00.000Z"
      };
    },
    updateLinkedInstrumentCircleOperationId: async () => undefined,
    updateBusinessClientWalletSetId: async () => undefined
  };

  const circleTreasury: CircleTreasuryService = {
    initializeWalletSet: async () => {
      throw new Error("initializeWalletSet should not be called");
    },
    initializeTenantWallet: async () => {
      throw new Error("initializeTenantWallet should not be called");
    },
    mintFiatToWallet: async () => {
      throw new Error("mintFiatToWallet should not be called");
    },
    provisionAdaMapping: async () => ({
      status: "complete",
      providerAccountId: "acct-1",
      providerWalletId: "wallet-1",
      providerAddressId: "addr-1",
      providerRequestId: "req-1",
      responsePayload: { accepted: true }
    }),
    provisionSandboxWire: async () => {
      sandboxWireCalls += 1;
      return {
        status: "complete",
        providerRequestId: "wire-req-1",
        responsePayload: { accepted: true }
      };
    },
    retrieveSandboxWireInstructions: async () => {
      throw new Error("retrieveSandboxWireInstructions should not be called");
    }
  };

  const result = await provisionCircleAccountService(
    repo,
    circleTreasury,
    async () => undefined,
    async () => ({ id: accountId }),
    async () => ({ id: "op-1" }),
    tenantId,
    baseInput({ reason: "Provision Circle developer-controlled wallet" }),
    accountId,
    () => "circle-sandbox",
    () => ["ETH-SEPOLIA"],
    "SCA"
  );

  assert.equal(result.status, 200);
  assert.equal(sandboxWireCalls, 0);
  assert.equal(linkedInstrumentInserts, 1);
  assert.equal((result.body.circleOperation as { id: string }).id, "op-1");
});

test("partial wire fields trigger wire setup path and return validation failure", async () => {
  let sandboxWireCalls = 0;
  let linkedInstrumentInserts = 0;

  const repo: AdaCircleProvisionRepository = {
    findAccountWithClient: async () => baseAccount,
    findExistingCircleWallet: async () => undefined,
    findSuccessfulMappingOperation: async () => undefined,
    findReplayedOperation: async () => undefined,
    insertCircleOperation: async () => undefined,
    insertLinkedInstrument: async () => {
      linkedInstrumentInserts += 1;
      return {
        id: "linked-1",
        account_of_digital_asset_id: accountId,
        instrument_type: "circle_wallet",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z"
      };
    },
    updateLinkedInstrumentCircleOperationId: async () => undefined,
    updateBusinessClientWalletSetId: async () => undefined
  };

  const circleTreasury: CircleTreasuryService = {
    initializeWalletSet: async () => {
      throw new Error("initializeWalletSet should not be called");
    },
    initializeTenantWallet: async () => {
      throw new Error("initializeTenantWallet should not be called");
    },
    mintFiatToWallet: async () => {
      throw new Error("mintFiatToWallet should not be called");
    },
    provisionAdaMapping: async () => ({
      status: "complete",
      providerAccountId: "acct-1",
      providerWalletId: "wallet-1",
      providerAddressId: "addr-1",
      providerRequestId: "req-1",
      responsePayload: { accepted: true }
    }),
    provisionSandboxWire: async () => {
      sandboxWireCalls += 1;
      return {
        status: "failed",
        errorCode: "circle_validation_failed",
        responsePayload: {
          detail: "wireAccount.accountNumber is required for /v1/businessAccount/banks/wires"
        }
      };
    },
    retrieveSandboxWireInstructions: async () => {
      throw new Error("retrieveSandboxWireInstructions should not be called");
    }
  };

  const result = await provisionCircleAccountService(
    repo,
    circleTreasury,
    async () => undefined,
    async () => ({ id: accountId }),
    async () => ({ id: "op-2" }),
    tenantId,
    baseInput({
      reason: "Provision Circle developer-controlled wallet",
      routingNumber: "021000021"
    }),
    accountId,
    () => "circle-sandbox",
    () => ["ETH-SEPOLIA"],
    "SCA"
  );

  assert.equal(sandboxWireCalls, 1);
  assert.equal(linkedInstrumentInserts, 0);
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "circle_validation_failed");
  assert.equal(result.body.detail, "wireAccount.accountNumber is required for /v1/businessAccount/banks/wires");
});
