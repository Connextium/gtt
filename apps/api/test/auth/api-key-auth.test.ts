import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { authenticateApiRequest } from "../../src/auth/middleware.js";
import { createApiClientAndKey, createInitialState } from "../../src/data.js";

const requestWithKey = (key?: string): IncomingMessage => ({
  headers: key ? { authorization: `Bearer ${key}` } : {},
  socket: { remoteAddress: "127.0.0.1" }
}) as IncomingMessage;

test("authenticates scoped API keys and tracks last-used metadata", () => {
  const state = createInitialState();
  const created = createApiClientAndKey(state, {
    clientName: "Read Client",
    scopes: ["read:operations"],
    secret: "read_secret",
    keyId: "api_key_read"
  });

  const result = authenticateApiRequest(state, requestWithKey(created.plaintextKey), ["read:operations"]);

  assert.equal(result.error, undefined);
  assert.equal(result.auth?.apiKeyId, "api_key_read");
  assert.equal(state.apiKeys.find((key) => key.id === "api_key_read")?.lastUsedIp, "127.0.0.1");
});

test("rejects missing, revoked, expired, and scope-mismatched API keys", () => {
  const state = createInitialState();
  const created = createApiClientAndKey(state, {
    clientName: "Limited Client",
    scopes: ["read:operations"],
    secret: "limited_secret",
    keyId: "api_key_limited"
  });

  assert.deepEqual(authenticateApiRequest(state, requestWithKey()).error?.body, { error: "api_key_required" });

  const missingScope = authenticateApiRequest(state, requestWithKey(created.plaintextKey), ["write:clients"]);
  assert.deepEqual(missingScope.error?.body, { error: "api_key_scope_missing:write:clients" });

  const key = state.apiKeys.find((item) => item.id === "api_key_limited");
  assert.ok(key);
  key.status = "revoked";
  assert.deepEqual(authenticateApiRequest(state, requestWithKey(created.plaintextKey)).error?.body, { error: "api_key_not_active" });

  key.status = "active";
  key.expiresAt = "2020-01-01T00:00:00.000Z";
  assert.deepEqual(authenticateApiRequest(state, requestWithKey(created.plaintextKey)).error?.body, { error: "api_key_expired" });
});

test("created API keys never expose key hash in public response", () => {
  const state = createInitialState();
  const created = createApiClientAndKey(state, { clientName: "Public Shape Client" });

  assert.equal("keyHash" in created.key, false);
  assert.equal(typeof created.plaintextKey, "string");
});
