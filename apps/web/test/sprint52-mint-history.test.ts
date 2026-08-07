import assert from "node:assert/strict";
import test from "node:test";
import { buildMintHistoryCsv, buildMintHistoryQuery } from "../src/internal/treasury-works/sprint52-mint-history-utils.ts";

test("buildMintHistoryQuery encodes pagination and filters", () => {
  const query = buildMintHistoryQuery({
    page: 2,
    pageSize: 10,
    search: "ada_buyer",
    status: "completed"
  });

  const params = new URLSearchParams(query);
  assert.equal(params.get("page"), "2");
  assert.equal(params.get("pageSize"), "10");
  assert.equal(params.get("search"), "ada_buyer");
  assert.equal(params.get("status"), "completed");
});

test("buildMintHistoryCsv renders escaped csv rows", () => {
  const csv = buildMintHistoryCsv([
    {
      id: "fiat_mint_001",
      wireAccountId: "wire_001",
      targetAccountOfDigitalAssetId: "ada_buyer",
      amountMinorUnits: "1000000",
      status: "completed",
      providerMintId: "provider_001",
      createdAt: "2026-08-05T00:00:00.000Z"
    },
    {
      id: "fiat_mint_\"quoted\"",
      wireAccountId: "wire_002",
      targetAccountOfDigitalAssetId: "ada_supplier",
      amountMinorUnits: "2500000",
      status: "failed",
      providerMintId: "provider_002",
      createdAt: "2026-08-05T01:00:00.000Z"
    }
  ]);

  assert.equal(csv.includes("mint_id,wire_account_id,target_ada_id"), true);
  assert.equal(csv.includes('"fiat_mint_""quoted"""'), true);
  assert.equal(csv.includes('"1.000000 USDC"'), true);
  assert.equal(csv.includes('"2.500000 USDC"'), true);
});
