import { randomUUID } from "node:crypto";
import { circleBaseUrl, circleRetryMaxAttempts, circleTimeoutMs } from "./env-config.js";
import type {
  CircleEnvironment,
  CircleProviderResult,
  CircleStableErrorCode,
  CircleTransferRequest
} from "./types.js";
import { asRecord, asString } from "./value-utils.js";

export const invokeCircleHttp = async (
  request: CircleTransferRequest,
  environment: Exclude<CircleEnvironment, "simulator">
): Promise<CircleProviderResult> => {
  const endpoint = circleEndpoint(request.operationType);
  return circleHttpRequest({
    method: endpoint.method,
    path: endpoint.path,
    environment,
    idempotencyKey: request.idempotencyKey,
    payload: request.payload
  });
};

export const circleHttpRequest = async ({
  environment,
  idempotencyKey,
  method,
  path,
  payload = {},
  apiKeyOverride,
  apiKeySource
}: {
  environment: Exclude<CircleEnvironment, "simulator">;
  idempotencyKey?: string;
  method: "GET" | "POST";
  path: string;
  payload?: Record<string, unknown>;
  apiKeyOverride?: string;
  apiKeySource?: "CIRCLE_API_KEY" | "CIRCLE_MINT_KEY";
}): Promise<CircleProviderResult> => {
  const apiKey = apiKeyOverride ?? process.env.CIRCLE_API_KEY;
  const apiKeyName = apiKeySource ?? "CIRCLE_API_KEY";
  const baseUrl = circleBaseUrl(environment);
  if (!apiKey) {
    return failedCircleProviderResult("circle_api_key_required", {
      accepted: false,
      endpoint: path,
      detail: `Set ${apiKeyName} for Circle API authentication`
    });
  }

  const timeoutMs = circleTimeoutMs();
  const maxAttempts = circleRetryMaxAttempts();
  const url = new URL(path, baseUrl);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
        },
        body: method === "GET" ? undefined : JSON.stringify(payload),
        signal: controller.signal
      });
      const responsePayload = await parseCircleResponse(response);
      clearTimeout(timer);
      const errorCode = response.ok ? undefined : classifyCircleHttpStatus(response.status, responsePayload);
      const providerRequestId = response.headers.get("x-request-id") ?? response.headers.get("circle-request-id") ?? undefined;
      return {
        providerReferenceId: providerFieldFromPayload(responsePayload, ["id", "walletId", "transferId", "trackingRef"]),
        providerAccountId: providerFieldFromPayload(responsePayload, ["accountId", "account", "businessAccountId", "walletSetId"]),
        providerWalletId: providerFieldFromPayload(responsePayload, ["walletId", "wallet", "id"]),
        providerAddressId: providerFieldFromPayload(responsePayload, ["addressId", "address"]),
        providerRequestId,
        status: response.ok ? "complete" : "failed",
        errorCode,
        responsePayload: {
          accepted: response.ok,
          httpStatus: response.status,
          attempt,
          endpoint: path,
          providerRequestId,
          detail: !response.ok ? providerErrorDetail(responsePayload) : undefined,
          provider: responsePayload
        }
      };
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt < maxAttempts) await wait(100 * attempt);
    }
  }

  const errorCode = classifyCircleError(lastError);
  return failedCircleProviderResult(errorCode, { accepted: false, errorCode, endpoint: path });
};

export const classifyCircleHttpStatus = (status: number, payload: Record<string, unknown>): CircleStableErrorCode => {
  if (status === 401 || status === 403) return "circle_auth_failed";
  if (status === 429) return "circle_rate_limited";
  if (status >= 400 && status < 500) return "circle_validation_failed";
  if (status >= 500) return "circle_provider_unavailable";
  return providerReferenceFromPayload(payload).startsWith("circle_") ? "circle_response_unmapped" : "circle_provider_unavailable";
};

export const classifyCircleError = (error: unknown): CircleStableErrorCode => {
  if (error instanceof Error && error.name === "AbortError") return "circle_endpoint_unreachable";
  if (error instanceof Error) return "circle_endpoint_unreachable";
  return "circle_provider_unavailable";
};

export const providerFieldFromPayload = (payload: Record<string, unknown>, keys: string[]): string | undefined => {
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
  const firstWallet = firstPayloadItem(data.wallets);
  const walletSet = data.walletSet && typeof data.walletSet === "object" ? data.walletSet as Record<string, unknown> : undefined;
  for (const key of keys) {
    const value = firstWallet?.[key] ?? walletSet?.[key] ?? data[key] ?? payload[key];
    if (typeof value === "string") return value;
    if (value && typeof value === "object") {
      const nestedId = (value as Record<string, unknown>).id;
      if (typeof nestedId === "string") return nestedId;
    }
  }
  return undefined;
};

const circleEndpoint = (operationType: CircleTransferRequest["operationType"]): { method: "GET" | "POST"; path: string } => {
  const override = process.env[`CIRCLE_ENDPOINT_${operationType.toUpperCase()}`];
  if (override) return { method: operationType.endsWith("status") || operationType.includes("lookup") ? "GET" : "POST", path: override };
  const paths: Record<CircleTransferRequest["operationType"], { method: "GET" | "POST"; path: string }> = {
    client_onboarding: { method: "POST", path: "/v1/businessAccount/wallets" },
    application_status: { method: "GET", path: "/v1/businessAccount/wallets" },
    account_provision: { method: "POST", path: "/v1/wallets" },
    balance_lookup: { method: "GET", path: "/v1/balances" },
    internal_transfer: { method: "POST", path: "/v1/transfers" },
    external_crypto_transfer: { method: "POST", path: "/v1/transfers" },
    wire_deposit_evidence: { method: "GET", path: "/v1/businessAccount/banks/wires" },
    withdrawal: { method: "POST", path: "/v1/businessAccount/redeem" },
    transfer_status: { method: "GET", path: "/v1/transfers" }
  };
  return paths[operationType];
};

const parseCircleResponse = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
};

const providerReferenceFromPayload = (payload: Record<string, unknown>): string => {
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : payload;
  const firstWallet = firstPayloadItem(data.wallets);
  const walletSet = data.walletSet && typeof data.walletSet === "object" ? data.walletSet as Record<string, unknown> : undefined;
  const id = firstWallet?.id ?? walletSet?.id ?? data.id ?? data.transferId ?? data.walletId ?? payload.id;
  return typeof id === "string" ? id : `circle_${randomUUID()}`;
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const failedCircleProviderResult = (errorCode: CircleStableErrorCode, responsePayload: Record<string, unknown>): CircleProviderResult => ({
  status: "failed",
  errorCode,
  responsePayload
});

const providerErrorDetail = (payload: Record<string, unknown>): string | undefined => {
  const message = asString(payload.message)
    ?? asString(payload.detail)
    ?? asString(payload.error)
    ?? asString(asRecord(payload.error)?.message)
    ?? asString(asRecord(payload.error)?.description)
    ?? asString(asRecord(payload.data)?.message)
    ?? asString(asRecord(payload.data)?.error)
    ?? asString(asRecord(payload.details)?.message)
    ?? asString(asRecord(payload.providerError)?.message);
  const validationHint = firstCircleValidationHint(payload);
  if (message && validationHint) return `${message} (${validationHint})`;
  return message ?? validationHint;
};

const firstCircleValidationHint = (payload: Record<string, unknown>): string | undefined => {
  const payloadError = asRecord(payload.error);
  const payloadDetails = asRecord(payload.details);
  const payloadData = asRecord(payload.data);
  const payloadDataDetails = asRecord(payloadData?.details);
  const providerError = asRecord(payload.providerError);
  const providerErrorDetails = asRecord(providerError?.details);

  const candidates: unknown[] = [
    payload.errors,
    payload.validationErrors,
    payloadError?.errors,
    payloadError?.validationErrors,
    payloadDetails?.errors,
    payloadDetails?.violations,
    payloadData?.errors,
    payloadData?.validationErrors,
    payloadDataDetails?.errors,
    payloadDataDetails?.violations,
    providerError?.errors,
    providerErrorDetails?.errors,
    providerErrorDetails?.violations
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || candidate.length === 0) continue;
    const first = asRecord(candidate[0]);
    if (!first) continue;
    const field = asString(first.field)
      ?? asString(first.path)
      ?? asString(first.pointer)
      ?? asString(first.location);
    const issue = asString(first.message)
      ?? asString(first.reason)
      ?? asString(first.error)
      ?? asString(first.description);
    if (field && issue) return `${field}: ${issue}`;
    if (issue) return issue;
    if (field) return field;
  }
  return undefined;
};

const firstPayloadItem = (value: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  return first && typeof first === "object" ? first as Record<string, unknown> : undefined;
};
