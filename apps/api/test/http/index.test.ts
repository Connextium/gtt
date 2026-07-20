import assert from "node:assert/strict";
import test from "node:test";
import { allowedCorsOrigin, corsHeaders } from "../../src/http/index.js";

const withCorsAllowedOrigin = (value: string | undefined, callback: () => void): void => {
  const previous = process.env.CORS_ALLOWED_ORIGIN;
  if (value === undefined) {
    delete process.env.CORS_ALLOWED_ORIGIN;
  } else {
    process.env.CORS_ALLOWED_ORIGIN = value;
  }
  try {
    callback();
  } finally {
    if (previous === undefined) {
      delete process.env.CORS_ALLOWED_ORIGIN;
    } else {
      process.env.CORS_ALLOWED_ORIGIN = previous;
    }
  }
};

test("allows all origins when CORS_ALLOWED_ORIGIN is unset", () => {
  withCorsAllowedOrigin(undefined, () => {
    assert.equal(allowedCorsOrigin("https://web.example.com"), "*");
    assert.equal(corsHeaders("https://web.example.com")["access-control-allow-origin"], "*");
  });
});

test("allows all origins when CORS_ALLOWED_ORIGIN contains wildcard", () => {
  withCorsAllowedOrigin("https://admin.example.com,*", () => {
    assert.equal(allowedCorsOrigin("https://web.example.com"), "*");
  });
});

test("echoes the request origin when it is in the configured CORS list", () => {
  withCorsAllowedOrigin("https://web.example.com, https://admin.example.com", () => {
    const headers = corsHeaders("https://admin.example.com");
    assert.equal(headers["access-control-allow-origin"], "https://admin.example.com");
    assert.equal(headers.vary, "Origin");
  });
});

test("omits access-control-allow-origin when request origin is not allowed", () => {
  withCorsAllowedOrigin("https://web.example.com, https://admin.example.com", () => {
    assert.equal(allowedCorsOrigin("https://other.example.com"), undefined);
    assert.equal(corsHeaders("https://other.example.com")["access-control-allow-origin"], undefined);
  });
});
