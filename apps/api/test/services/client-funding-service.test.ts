import assert from "node:assert/strict";
import test from "node:test";
import type {
  ClientFundingInstructionSeed,
  ClientFundingRepository
} from "../../src/db/repositories/client-funding-repository.js";
import { createClientFundingService } from "../../src/services/client-funding-service.js";

const tenantId = "00000000-0000-4000-8000-000000000001";
const authUserId = "00000000-0000-4000-8000-000000000101";
const businessClientId = "00000000-0000-4000-8000-000000000201";
const sourceAccountId = "00000000-0000-4000-8000-000000000301";
const destinationAccountId = "00000000-0000-4000-8000-000000000302";

test("sprint5b: authenticated client creation writes exactly two dependent stages", async () => {
  let created: ClientFundingInstructionSeed | undefined;
  const repository = createRepository({
    createInstruction: async (seed) => {
      created = seed;
    }
  });
  const service = createClientFundingService(repository);

  const result = await service.create(tenantId, { authUserId, email: "client@example.com" }, {
    method: "POST",
    pathname: "/business/me/funding-instructions",
    body: {
      sourceAccountOfDigitalAssetId: sourceAccountId,
      destinationAccountOfDigitalAssetId: destinationAccountId,
      amountMinorUnits: "2500000",
      businessClientId: "00000000-0000-4000-8000-000000000999"
    },
    idempotencyKey: "idem-client-funding",
    correlationId: "corr-client-funding"
  });

  assert.equal(result.status, 201);
  assert.ok(created);
  assert.equal(created.businessClientId, businessClientId);
  assert.equal(created.sourceAccountId, sourceAccountId);
  assert.equal(created.destinationAccountId, destinationAccountId);
  assert.notEqual(created.wireOrderId, created.usdcOrderId);
  assert.equal(created.routeEvidence.platformIntermediaryStatus, "pending_internal_route_assignment");
});

test("sprint5b: client cannot create an instruction with another client's ADA", async () => {
  let createCount = 0;
  const repository = createRepository({
    findOwnedAccount: async (_tenant, _client, accountId) => accountId === sourceAccountId
      ? activeAccount(sourceAccountId)
      : undefined,
    createInstruction: async () => {
      createCount += 1;
    }
  });
  const service = createClientFundingService(repository);

  const result = await service.create(tenantId, { authUserId, email: "client@example.com" }, {
    method: "POST",
    pathname: "/business/me/funding-instructions",
    body: {
      sourceAccountOfDigitalAssetId: sourceAccountId,
      destinationAccountOfDigitalAssetId: destinationAccountId,
      amountMinorUnits: "2500000"
    },
    idempotencyKey: "idem-other-client",
    correlationId: "corr-other-client"
  });

  assert.equal(result.status, 403);
  assert.deepEqual(result.body, { error: "account_not_authorized_for_business_client" });
  assert.equal(createCount, 0);
});

test("sprint5b: client accepts a legacy verified fiat payment route", async () => {
  let created: ClientFundingInstructionSeed | undefined;
  const repository = createRepository({
    findEligibleLinkedInstrument: async (_tenant, accountId, capability) => capability === "fiat"
      ? {
          id: `${accountId}:fiat`,
          instrumentType: "fiat_wire_bank_account",
          railType: "fiat",
          purpose: "payment"
        }
      : { id: `${accountId}:usdc`, instrumentType: "circle_wallet" },
    createInstruction: async (seed) => {
      created = seed;
    }
  });
  const service = createClientFundingService(repository);

  const result = await service.create(tenantId, { authUserId, email: "client@example.com" }, {
    method: "POST",
    pathname: "/business/me/funding-instructions",
    body: {
      sourceAccountOfDigitalAssetId: sourceAccountId,
      destinationAccountOfDigitalAssetId: destinationAccountId,
      amountMinorUnits: "2500000"
    },
    idempotencyKey: "idem-legacy-payment-route",
    correlationId: "corr-legacy-payment-route"
  });

  assert.equal(result.status, 201);
  assert.deepEqual(created?.routeEvidence.clientSource, {
    accountOfDigitalAssetId: sourceAccountId,
    linkedInstrument: {
      id: `${sourceAccountId}:fiat`,
      instrumentType: "fiat_wire_bank_account",
      railType: "fiat",
      purpose: "payment"
    }
  });
});

test("sprint5b: client detail includes stages and omits provider payload evidence", async () => {
  const repository = createRepository();
  const service = createClientFundingService(repository);
  const result = await service.detail(
    tenantId,
    { authUserId, email: "client@example.com" },
    "00000000-0000-4000-8000-000000000401"
  );

  assert.equal(result.status, 200);
  const body = result.body as { fundingInstruction: Record<string, unknown>; orders: Record<string, unknown>[] };
  assert.equal(body.orders.length, 2);
  assert.equal(body.orders[0]?.stage, "fiat_received");
  assert.equal(body.orders[1]?.stage, "usdc_delivered");
  assert.equal("providerPayload" in body.orders[0]!, false);
  assert.equal("providerReferenceId" in body.orders[0]!, false);
});

const createRepository = (overrides: Partial<ClientFundingRepository> = {}): ClientFundingRepository => ({
  resolveIdentity: async () => ({ businessClientId, businessClientName: "Client One" }),
  findOwnedAccount: async (_tenant, _client, accountId) => activeAccount(accountId),
  findEligibleLinkedInstrument: async (_tenant, accountId, capability) => ({
    id: `${accountId}:${capability}`,
    instrumentType: capability === "fiat" ? "fiat_wire_bank_account" : "circle_wallet"
  }),
  createInstruction: async () => undefined,
  listInstructions: async () => [instructionRow()],
  getInstruction: async () => instructionRow(),
  listOrders: async () => [
    {
      id: "wire-order",
      order_kind: "ada_wire_transfer",
      amount_minor_units: "2500000",
      currency: "USD",
      status: "completed",
      completed_webhook_event_id: "wire-event",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:01:00.000Z"
    },
    {
      id: "usdc-order",
      order_kind: "ada_usdc_transfer",
      dependency_order_id: "wire-order",
      amount_minor_units: "2500000",
      currency: "USD",
      status: "pending_provider",
      provider_payload_json: { secret: true },
      provider_reference_id: "provider-secret",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:01:00.000Z"
    }
  ],
  writeAuditAndOutbox: async () => undefined,
  ...overrides
});

const activeAccount = (id: string) => ({
  id,
  businessClientId,
  accountName: "Client ADA",
  status: "active",
  assetCode: "USDC"
});

const instructionRow = () => ({
  id: "00000000-0000-4000-8000-000000000401",
  source_account_of_digital_asset_id: sourceAccountId,
  destination_account_of_digital_asset_id: destinationAccountId,
  amount_minor_units: "2500000",
  pending_usdc_minor_units: "2500000",
  available_usdc_minor_units: "0",
  status: "pending_usdc_reserved",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:01:00.000Z"
});