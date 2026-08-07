import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  checkCircleHealth,
  circleEnvironment,
  mintFiatToCircleWallet,
  provisionAdaCircleMapping,
  provisionSandboxWireFundingInstructions,
  retrieveSandboxWireFundingInstructions,
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

test("sandbox mock wire mint uses CIRCLE_MINT_KEY when configured", async () => {
  await withCircleEnv({
    CIRCLE_ENVIRONMENT: "circle-sandbox",
    CIRCLE_API_KEY: "sandbox_general_key",
    CIRCLE_MINT_KEY: "sandbox_mint_key",
    CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET: undefined
  }, async () => {
    let authorizationHeader: string | undefined;
    await withFetch(async (_url, init) => {
      const headers = init?.headers as Record<string, unknown> | undefined;
      authorizationHeader = typeof headers?.authorization === "string"
        ? headers.authorization
        : undefined;
      return new Response(JSON.stringify({
        data: {
          trackingRef: "CIRTEST001",
          status: "pending"
        }
      }), { status: 200, headers: { "x-request-id": "req_mint_1" } });
    }, async () => {
      const result = await mintFiatToCircleWallet({
        tenantId: "tenant_1",
        accountOfDigitalAssetId: "ada_1",
        businessClientId: "client_1",
        walletId: "wallet_1",
        amountMinorUnits: "1000000",
        currency: "USD"
      });
      assert.equal(result.status, "complete");
      assert.equal(authorizationHeader, "Bearer sandbox_mint_key");
    });
  });
});

test("sandbox mock wire mint reads legacy tracking aliases but emits canonical trackingRef only", async () => {
  await withCircleEnv({
    CIRCLE_ENVIRONMENT: "circle-sandbox",
    CIRCLE_API_KEY: "sandbox_general_key",
    CIRCLE_MINT_KEY: "sandbox_mint_key",
    CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET: undefined
  }, async () => {
    let requestPayload: Record<string, unknown> | undefined;
    await withFetch(async (_url, init) => {
      requestPayload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        data: {
          trackingRef: "LEGACY_TRACK_001",
          status: "pending"
        }
      }), { status: 200, headers: { "x-request-id": "req_mint_alias_1" } });
    }, async () => {
      const result = await mintFiatToCircleWallet({
        tenantId: "tenant_legacy",
        accountOfDigitalAssetId: "ada_legacy",
        businessClientId: "client_legacy",
        walletId: "wallet_legacy",
        amountMinorUnits: "1000000",
        currency: "USD",
        payload: {
          wireTrackingRef: "LEGACY_TRACK_001",
          providerTrackingRef: "LEGACY_PROVIDER_TRACK_001"
        }
      });

      assert.equal(result.status, "complete");
      assert.equal(requestPayload?.trackingRef, "LEGACY_TRACK_001");
      assert.equal("wireTrackingRef" in (requestPayload ?? {}), false);
      assert.equal("providerTrackingRef" in (requestPayload ?? {}), false);
    });
  });
});

test("sandbox wire provisioning uses CIRCLE_MINT_KEY for wire registration and instruction retrieval", async () => {
  await withCircleEnv({
    CIRCLE_ENVIRONMENT: "circle-sandbox",
    CIRCLE_API_KEY: "sandbox_general_key",
    CIRCLE_MINT_KEY: "sandbox_mint_key"
  }, async () => {
    const authHeaders: string[] = [];
    const requestedPaths: string[] = [];
    let registerWireBody: Record<string, unknown> | undefined;
    await withFetch(async (url, init) => {
      requestedPaths.push(String(url));
      const headers = init?.headers as Record<string, unknown> | undefined;
      authHeaders.push(typeof headers?.authorization === "string" ? headers.authorization : "");
      const method = String(init?.method ?? "GET").toUpperCase();

      if (String(url).includes("/v1/businessAccount/banks/wires") && !String(url).includes("/instructions") && method === "GET") {
        return new Response(JSON.stringify({
          data: {
            wireAccounts: []
          }
        }), { status: 200, headers: { "x-request-id": "req_wire_list_1" } });
      }

      if (String(url).includes("/v1/businessAccount/banks/wires") && !String(url).includes("/instructions") && method === "POST") {
        registerWireBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({
          data: {
            id: "wire_business_1"
          }
        }), { status: 200, headers: { "x-request-id": "req_wire_register_1" } });
      }

      if (String(url).includes("/v1/businessAccount/banks/wires/") && String(url).includes("/instructions")) {
        return new Response(JSON.stringify({
          data: {
            trackingRef: "CIRTRACK001",
            beneficiaryBank: {
              accountNumber: "1234567890"
            }
          }
        }), { status: 200, headers: { "x-request-id": "req_wire_instructions_1" } });
      }

      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }, async () => {
      const result = await provisionSandboxWireFundingInstructions({
        tenantId: "tenant_1",
        accountOfDigitalAssetId: "ada_1",
        businessClientId: "client_1",
        idempotencyKey: "c1a2e61d-c9a9-47eb-9ee3-1d3fa6147b12",
        payload: {
          accountNumber: "1234567890",
          routingNumber: "121000248",
          billingDetails: {
            name: "Satoshi Nakamoto",
            city: "San Francisco",
            country: "US",
            line1: "100 Money Street",
            district: "CA",
            postalCode: "94105"
          },
          bankAddress: {
            bankName: "WESTERN CAPITAL BANK",
            city: "San Francisco",
            country: "US",
            line1: "700 West Georgia Street",
            district: "CA"
          }
        }
      });

      assert.equal(result.status, "complete");
      assert.equal(authHeaders.length, 3);
      assert.equal(authHeaders[0], "Bearer sandbox_mint_key");
      assert.equal(authHeaders[1], "Bearer sandbox_mint_key");
      assert.equal(authHeaders[2], "Bearer sandbox_mint_key");
      assert.equal(requestedPaths.some((path) => path.includes("/v1/businessAccount/banks/wires")), true);
      assert.equal(requestedPaths.some((path) => path.includes("/v1/businessAccount/banks/wires/wire_business_1/instructions")), true);
      assert.deepEqual(registerWireBody, {
        idempotencyKey: "c1a2e61d-c9a9-47eb-9ee3-1d3fa6147b12",
        accountNumber: "1234567890",
        routingNumber: "121000248",
        billingDetails: {
          name: "Satoshi Nakamoto",
          city: "San Francisco",
          country: "US",
          line1: "100 Money Street",
          district: "CA",
          postalCode: "94105"
        },
        bankAddress: {
          bankName: "WESTERN CAPITAL BANK",
          city: "San Francisco",
          country: "US",
          line1: "700 West Georgia Street",
          district: "CA"
        }
      });
      assert.equal(result.providerAccountId, "wire_business_1");
      assert.equal(result.responsePayload.businessWireAccountId, "wire_business_1");
      assert.equal(result.responsePayload.trackingRef, "CIRTRACK001");
      assert.equal(result.responsePayload.beneficiaryBankAccountNumber, "1234567890");
    });
  });
});

test("sandbox wire instruction retrieval uses CIRCLE_MINT_KEY when configured", async () => {
  await withCircleEnv({
    CIRCLE_ENVIRONMENT: "circle-sandbox",
    CIRCLE_API_KEY: "sandbox_general_key",
    CIRCLE_MINT_KEY: "sandbox_mint_key"
  }, async () => {
    let authorizationHeader: string | undefined;
    await withFetch(async (_url, init) => {
      const headers = init?.headers as Record<string, unknown> | undefined;
      authorizationHeader = typeof headers?.authorization === "string"
        ? headers.authorization
        : undefined;
      return new Response(JSON.stringify({
        data: {
          trackingRef: "CIRTRACK002",
          beneficiaryBank: {
            accountNumber: "9988776655"
          }
        }
      }), { status: 200, headers: { "x-request-id": "req_wire_instructions_2" } });
    }, async () => {
      const result = await retrieveSandboxWireFundingInstructions({
        tenantId: "tenant_2",
        wireAccountId: "wire_business_2"
      });

      assert.equal(result.status, "complete");
      assert.equal(authorizationHeader, "Bearer sandbox_mint_key");
      assert.equal(result.responsePayload.businessWireAccountId, "wire_business_2");
      assert.equal(result.responsePayload.trackingRef, "CIRTRACK002");
      assert.equal(result.responsePayload.beneficiaryBankAccountNumber, "9988776655");
    });
  });
});

test("Sandbox webhooks reject missing signatures while simulator allows local unsigned events", async () => {
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "simulator" }, async () => {
    assert.equal((await verifyCircleWebhook("{\"id\":\"evt_1\"}", undefined)).valid, true);
  });
  await withCircleEnv({ CIRCLE_ENVIRONMENT: "circle-sandbox" }, async () => {
    assert.equal((await verifyCircleWebhook("{\"id\":\"evt_1\"}", undefined)).valid, false);
    assert.equal((await verifyCircleWebhook("{\"id\":\"evt_1\"}", "test_valid_signature")).valid, true);
  });
});

test("Sandbox webhooks verify Circle v2 asymmetric signatures with key id", async () => {
  const keyId = "879dc113-5ca4-4ff7-a6b7-54652083fcf8";
  const payload = JSON.stringify({
    notificationId: "notif_1",
    notificationType: "webhooks.test",
    version: 2
  });
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signer = createSign("sha256");
  signer.update(payload);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");

  await withCircleEnv({ CIRCLE_ENVIRONMENT: "circle-sandbox", CIRCLE_API_KEY: "sandbox_key" }, async () => {
    await withFetch(async () => new Response(JSON.stringify({
      data: {
        id: keyId,
        algorithm: "ECDSA_SHA_256",
        publicKey: publicKeyDer
      }
    }), { status: 200 }), async () => {
      const verification = await verifyCircleWebhook(payload, signature, undefined, keyId);
      assert.equal(verification.valid, true);
      assert.equal(verification.providerEventId, "notif_1");
      assert.equal(verification.eventType, "webhooks.test");
    });
  });
});
