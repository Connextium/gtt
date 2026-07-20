import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState } from "../../src/data.js";
import { findIdempotentResponse, recordIdempotentResponse, requestHash } from "../../src/events/idempotency.js";

test("records and replays matching idempotent responses", () => {
  const state = createInitialState();
  const hash = requestHash({ method: "POST", pathname: "/business-clients", body: { legalName: "Acme" } });

  recordIdempotentResponse(state, {
    key: "idem_001",
    hash,
    responseSnapshot: { businessClient: { id: "client_001" } }
  });

  const replay = findIdempotentResponse(state, { key: "idem_001", hash });

  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.responseSnapshot, { businessClient: { id: "client_001" } });
});

test("rejects reused idempotency key with different request hash", () => {
  const state = createInitialState();
  const firstHash = requestHash({ method: "POST", pathname: "/business-clients", body: { legalName: "Acme" } });
  const secondHash = requestHash({ method: "POST", pathname: "/business-clients", body: { legalName: "Other" } });

  recordIdempotentResponse(state, { key: "idem_001", hash: firstHash, responseSnapshot: { ok: true } });

  assert.throws(
    () => findIdempotentResponse(state, { key: "idem_001", hash: secondHash }),
    /idempotency_key_reused_with_different_request/
  );
});
