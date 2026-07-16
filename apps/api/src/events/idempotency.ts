import { createHash } from "node:crypto";
import type { ApiState } from "../data.js";
import { newId, type ApiIdempotencyRecord } from "../data.js";

export const requestHash = (input: { method: string; pathname: string; body: unknown }): string => {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
};

export const findIdempotentResponse = (
  state: ApiState,
  input: { key?: string; hash: string }
): { replayed: true; responseSnapshot: unknown } | { replayed: false } => {
  if (!input.key) return { replayed: false };
  const record = state.idempotencyRecords.find((item) => item.idempotencyKey === input.key);
  if (!record) return { replayed: false };
  if (record.requestHash !== input.hash) throw new Error("idempotency_key_reused_with_different_request");
  return { replayed: true, responseSnapshot: record.responseSnapshot };
};

export const recordIdempotentResponse = (
  state: ApiState,
  input: { key?: string; hash: string; responseSnapshot: unknown }
): ApiIdempotencyRecord | undefined => {
  if (!input.key) return undefined;
  const existing = state.idempotencyRecords.find((item) => item.idempotencyKey === input.key);
  if (existing) return existing;
  const record: ApiIdempotencyRecord = {
    id: newId("idempotency"),
    tenantId: state.tenantId,
    idempotencyKey: input.key,
    requestHash: input.hash,
    responseSnapshot: input.responseSnapshot,
    createdAt: new Date().toISOString()
  };
  state.idempotencyRecords.push(record);
  return record;
};
