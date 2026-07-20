import assert from "node:assert/strict";
import test from "node:test";
import { parseRequestUrl } from "../../src/server.js";

test("parses double-leading-slash request URLs as local API paths", () => {
  const url = parseRequestUrl("//onboarding/me");
  assert.equal(url.origin, "http://localhost");
  assert.equal(url.pathname, "/onboarding/me");
});

test("normalizes duplicate slashes in request paths without changing the query", () => {
  const url = parseRequestUrl("/onboarding//me?next=/review//status");
  assert.equal(url.pathname, "/onboarding/me");
  assert.equal(url.searchParams.get("next"), "/review//status");
});
