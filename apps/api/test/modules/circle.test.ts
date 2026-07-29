import assert from "node:assert/strict";
import test from "node:test";
import {
  checkCircleHealth,
  circleEnvironment,
  provisionAdaCircleMapping,
  verifyCircleWebhook
} from "../../src/modules/circle/index.js";

const withCircleEnv = async (
  env: Record<string, string | undefined>,
  work: () => Promise<void> | void
): Promise<void> => {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await work();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

const withFetch = async (fetchImpl: typeof fetch, work: () => Promise<void>): Promise<void> => {
  const previous = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await work();
  } finally {
    globalThis.fetch = previous;
  }
};

test("Circle environment accepts explicit sandbox and defaults to simulator", async () => {
  await withCircleEnv({ CIRCLE_ENVIRONMENT: undefined }, () => {
    assert.equal(circleEnvironment(), "simulator");
  });
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "circle-sandbox" }, () => {
    assert.equal(circleEnvironment(), "circle-sandbox");
  });
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "unexpected" }, () => {
    assert.equal(circleEnvironment(), "simulator");
  });
});

test("Circle health reports simulator without requiring an API key", async () => {
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "simulator", CIRCLE_API_KEY: undefined }, async () => {
    const result = await checkCircleHealth({ probe: true });
    assert.equal(result.status, "ready");
    assert.equal(result.environment, "simulator");
    assert.equal(result.apiKeyConfigured, false);
    assert.equal(result.responsePayload.simulated, true);
  });
});

test("Circle sandbox health reports missing API key without exposing secrets", async () => {
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "circle-sandbox", CIRCLE_API_KEY: undefined }, async () => {
    const result = await checkCircleHealth({ probe: true });
    assert.equal(result.status, "not_configured");
    assert.equal(result.errorCode, "circle_api_key_required");
    assert.equal(result.apiKeyConfigured, false);
    assert.equal(JSON.stringify(result).includes("TEST_API_KEY"), false);
  });
});

test("Circle sandbox health maps unauthorized response to stable auth failure", async () => {
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "circle-sandbox", CIRCLE_API_KEY: "sandbox_secret" }, async () => {
    await withFetch(async () => new Response(JSON.stringify({ code: "unauthorized" }), { status: 401 }), async () => {
      const result = await checkCircleHealth({ probe: true });
      assert.equal(result.status, "failed");
      assert.equal(result.errorCode, "circle_auth_failed");
      assert.equal(result.httpStatus, 401);
    });
  });
});

test("ADA Circle mapping requires developer wallet configuration in sandbox mode", async () => {
  await withCircleEnv({
    CIRCLE_ENVIRONMENT: "circle-sandbox",
    CIRCLE_API_KEY: "sandbox_secret",
    CIRCLE_WALLET_SET_ID: undefined,
    CIRCLE_ENTITY_SECRET: undefined,
    ENTITY_SECRET: undefined
  }, async () => {
    const result = await provisionAdaCircleMapping({
      tenantId: "tenant_1",
      accountOfDigitalAssetId: "ada_1",
      businessClientId: "client_1",
      idempotencyKey: "idem_1"
    });
    assert.equal(result.status, "failed");
    assert.equal(result.errorCode, "circle_wallet_configuration_required");
    assert.equal(JSON.stringify(result).includes("sandbox_secret"), false);
  });
});

test("ADA Circle mapping normalizes provider ids from sandbox developer wallet response", async () => {
  await withCircleEnv({
    CIRCLE_ENVIRONMENT: "circle-sandbox",
    CIRCLE_API_KEY: "sandbox_secret",
    CIRCLE_WALLET_SET_ID: "wallet_set_1",
    CIRCLE_ENTITY_SECRET: "entity_secret_1",
    CIRCLE_ENDPOINT_ADA_CIRCLE_MAPPING: "/v1/w3s/developer/wallets"
  }, async () => {
    let requestPayload: Record<string, unknown> | undefined;
    await withFetch(async (_url, init) => {
      requestPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
      data: {
        wallets: [
          {
            id: "circle_wallet_1",
            address: "0xabc",
            walletSetId: "wallet_set_1"
          }
        ]
      }
    }), { status: 200, headers: { "x-request-id": "req_1" } });
    }, async () => {
      const result = await provisionAdaCircleMapping({
        tenantId: "tenant_1",
        accountOfDigitalAssetId: "ada_1",
        businessClientId: "client_1",
        idempotencyKey: "idem_1"
      });
      assert.equal(result.status, "complete");
      assert.equal(result.providerReferenceId, "circle_wallet_1");
      assert.equal(result.providerAccountId, "wallet_set_1");
      assert.equal(result.providerWalletId, "circle_wallet_1");
      assert.equal(result.providerAddressId, "0xabc");
      assert.equal(result.providerRequestId, "req_1");
      assert.equal(requestPayload?.accountOfDigitalAssetId, "ada_1");
      assert.equal(requestPayload?.businessClientId, "client_1");
    });
  });
});

test("Sandbox webhooks reject missing signatures while simulator allows local unsigned events", async () => {
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "simulator" }, () => {
    assert.equal(verifyCircleWebhook("{\"id\":\"evt_1\"}", undefined).valid, true);
  });
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "circle-sandbox" }, () => {
    assert.equal(verifyCircleWebhook("{\"id\":\"evt_1\"}", undefined).valid, false);
    assert.equal(verifyCircleWebhook("{\"id\":\"evt_1\"}", "test_valid_signature").valid, true);
  });
});
