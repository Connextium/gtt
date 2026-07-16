import { DomainError, invariant } from "./errors.js";
import { nowIso } from "./ids.js";
import type { IdempotencyRecord } from "./types.js";

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
};

export const hashRequest = (value: unknown): string => stableStringify(value);

export const executeIdempotently = <T>(
  records: Map<string, IdempotencyRecord>,
  idempotencyKey: string,
  requestHash: string,
  action: () => T
): T => {
  invariant(idempotencyKey.length > 0, "idempotency_key_required");

  const existing = records.get(idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new DomainError("idempotency_key_reused_with_different_request");
    }
    return existing.responseBody as T;
  }

  const responseBody = action();
  records.set(idempotencyKey, {
    idempotencyKey,
    requestHash,
    responseBody,
    createdAt: nowIso()
  });
  return responseBody;
};
