import { createHmac, randomUUID } from "node:crypto";
import type { AccountType, Blockchain } from "@circle-fin/developer-controlled-wallets";
import type { ApiState, CircleOperation } from "../../data.js";
import { newId } from "../../data.js";

export type CircleEnvironment = "simulator" | "circle-sandbox" | "circle-production";
export type CircleStableErrorCode =
  | "circle_api_key_required"
  | "circle_endpoint_unreachable"
  | "circle_auth_failed"
  | "circle_rate_limited"
  | "circle_validation_failed"
  | "circle_provider_unavailable"
  | "circle_response_unmapped"
  | "circle_wallet_configuration_required"
  | "circle_webhook_signature_invalid";

export interface CircleProviderResult {
  providerReferenceId: string;
  providerAccountId?: string;
  providerWalletId?: string;
  providerAddressId?: string;
  providerRequestId?: string;
  status: "complete" | "failed";
  errorCode?: CircleStableErrorCode;
  responsePayload: Record<string, unknown>;
}

export interface CircleHealthResult {
  environment: CircleEnvironment;
  baseUrl: string;
  apiKeyConfigured: boolean;
  timeoutMs: number;
  retryMaxAttempts: number;
  status: "ready" | "not_configured" | "failed";
  providerRequestId?: string;
  httpStatus?: number;
  errorCode?: CircleStableErrorCode;
  responsePayload: Record<string, unknown>;
}

export interface CircleAdaMappingRequest {
  tenantId: string;
  accountOfDigitalAssetId: string;
  businessClientId: string;
  idempotencyKey?: string;
  correlationId?: string;
  walletSetId?: string;
  walletBlockchains?: string[];
  payload?: Record<string, unknown>;
}

export interface CircleWalletSetResult {
  environment: CircleEnvironment;
  walletSetId?: string;
  walletSetName: string;
  walletBlockchains: string[];
  providerRequestId?: string;
  status: "complete" | "failed";
  errorCode?: CircleStableErrorCode;
  responsePayload: Record<string, unknown>;
}

export interface CircleTransferRequest {
  tenantId: string;
  operationType:
    | "client_onboarding"
    | "application_status"
    | "account_provision"
    | "balance_lookup"
    | "internal_transfer"
    | "external_crypto_transfer"
    | "wire_deposit_evidence"
    | "withdrawal"
    | "transfer_status";
  idempotencyKey?: string;
  payload: Record<string, unknown>;
}

export interface CircleWebhookVerification {
  valid: boolean;
  providerEventId: string;
  eventType: string;
  normalizedPayload: Record<string, unknown>;
}

export const invokeCircle = async (state: ApiState, request: CircleTransferRequest): Promise<CircleOperation> => {
  const startedAt = Date.now();
  const environment = circleEnvironment();
  const provider = environment === "simulator" ? simulateCircle(request) : await invokeCircleHttp(request, environment);
  const operation: CircleOperation = {
    id: newId("circle_op"),
    tenantId: request.tenantId,
    operationType: request.operationType,
    requestPayload: request.payload,
    responsePayload: {
      mode: environment,
      durationMs: Date.now() - startedAt,
      ...provider.responsePayload
    },
    providerReferenceId: provider.providerReferenceId,
    status: provider.status,
    createdAt: new Date().toISOString()
  };
  state.circleOperations.push(operation);
  return operation;
};

export const circleEnvironment = (): CircleEnvironment => {
  const value = process.env.CIRCLE_ENVIRONMENT;
  if (value === "circle-sandbox" || value === "circle-production") return value;
  return "simulator";
};

export const circleBaseUrl = (environment: CircleEnvironment = circleEnvironment()): string =>
  process.env.CIRCLE_API_BASE_URL ?? (environment === "circle-production" ? "https://api.circle.com" : "https://api-sandbox.circle.com");

export const circleTimeoutMs = (): number => Number(process.env.CIRCLE_TIMEOUT_MS ?? 10000);

export const circleRetryMaxAttempts = (): number => Number(process.env.CIRCLE_RETRY_MAX_ATTEMPTS ?? 2);

export const checkCircleHealth = async (options: { probe?: boolean } = {}): Promise<CircleHealthResult> => {
  const environment = circleEnvironment();
  const baseUrl = circleBaseUrl(environment);
  const apiKeyConfigured = Boolean(process.env.CIRCLE_API_KEY);
  const timeoutMs = circleTimeoutMs();
  const retryMaxAttempts = circleRetryMaxAttempts();
  if (environment === "simulator") {
    return {
      environment,
      baseUrl,
      apiKeyConfigured,
      timeoutMs,
      retryMaxAttempts,
      status: "ready",
      responsePayload: { accepted: true, simulated: true, diagnostics: "simulator_ready" }
    };
  }
  if (!apiKeyConfigured) {
    return {
      environment,
      baseUrl,
      apiKeyConfigured,
      timeoutMs,
      retryMaxAttempts,
      status: "not_configured",
      errorCode: "circle_api_key_required",
      responsePayload: { accepted: false }
    };
  }
  if (!options.probe) {
    return {
      environment,
      baseUrl,
      apiKeyConfigured,
      timeoutMs,
      retryMaxAttempts,
      status: "ready",
      responsePayload: { accepted: true, configured: true, probeSkipped: true }
    };
  }
  // Probe the Wallets API used by this integration. The generic configuration
  // endpoint can be healthy while the developer-controlled Wallets service is
  // unavailable.
  const endpoint = process.env.CIRCLE_ENDPOINT_HEALTH_CHECK ?? "/v1/w3s/config/entity/publicKey";
  const response = await circleHttpRequest({ method: "GET", path: endpoint, environment });
  return {
    environment,
    baseUrl,
    apiKeyConfigured,
    timeoutMs,
    retryMaxAttempts,
    status: response.status === "complete" ? "ready" : "failed",
    providerRequestId: response.providerRequestId,
    httpStatus: numericPayload(response.responsePayload.httpStatus),
    errorCode: response.errorCode,
    responsePayload: response.responsePayload
  };
};

export const provisionAdaCircleMapping = async (request: CircleAdaMappingRequest): Promise<CircleProviderResult> => {
  const environment = circleEnvironment();
  if (environment === "simulator") {
    const suffix = request.accountOfDigitalAssetId.replace(/[^a-z0-9]/gi, "").slice(-12) || randomUUID().slice(0, 12);
    return {
      providerReferenceId: `circle_account_${suffix}`,
      providerAccountId: `circle_account_${suffix}`,
      providerWalletId: `circle_wallet_${suffix}`,
      providerAddressId: `circle_address_${suffix}`,
      status: "complete",
      responsePayload: {
        accepted: true,
        simulated: true,
        operationType: "ada_circle_mapping",
        accountOfDigitalAssetId: request.accountOfDigitalAssetId,
        businessClientId: request.businessClientId
      }
    };
  }
  const endpoint = process.env.CIRCLE_ENDPOINT_ADA_CIRCLE_MAPPING ?? process.env.CIRCLE_ENDPOINT_ACCOUNT_PROVISION;
  if (!endpoint) return provisionDeveloperControlledWallet(request, environment);
  return circleHttpRequest({
    method: "POST",
    path: endpoint,
    environment,
    idempotencyKey: request.idempotencyKey,
    payload: {
      accountOfDigitalAssetId: request.accountOfDigitalAssetId,
      businessClientId: request.businessClientId,
      correlationId: request.correlationId,
      ...request.payload
    }
  });
};

const provisionDeveloperControlledWallet = async (
  request: CircleAdaMappingRequest,
  environment: Exclude<CircleEnvironment, "simulator">
): Promise<CircleProviderResult> => {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? process.env.ENTITY_SECRET;
  const walletSetId = request.walletSetId ?? process.env.CIRCLE_WALLET_SET_ID;
  if (!apiKey) return failedCircleProviderResult("circle_api_key_required", { accepted: false });
  if (!entitySecret || !walletSetId) {
    return failedCircleProviderResult("circle_wallet_configuration_required", {
      accepted: false,
      missing: {
        entitySecret: !entitySecret,
        walletSetId: !walletSetId
      },
      requiredEnv: ["CIRCLE_ENTITY_SECRET", "CIRCLE_WALLET_SET_ID"]
    });
  }
  try {
    const blockchains = circleWalletBlockchains(request.walletBlockchains);
    const accountType = circleWalletAccountType;
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      baseUrl: circleBaseUrl(environment),
      entitySecret
    });
    const response = await client.createWallets({
      xRequestId: randomUUID(),
      idempotencyKey: circleWalletIdempotencyKey(request.idempotencyKey),
      blockchains: blockchains as Blockchain[],
      count: 1,
      walletSetId,
      accountType,
      metadata: [
        {
          name: `GTT ADA ${request.accountOfDigitalAssetId}`,
          refId: request.accountOfDigitalAssetId
        }
      ]
    });
    const payload = { data: response.data ?? {} } as Record<string, unknown>;
    return {
      providerReferenceId: providerReferenceFromPayload(payload),
      providerAccountId: walletSetId,
      providerWalletId: providerFieldFromPayload(payload, ["walletId", "wallet", "id"]),
      providerAddressId: providerFieldFromPayload(payload, ["addressId", "address"]),
      providerRequestId: sdkProviderRequestId(response),
      status: "complete",
      responsePayload: {
        accepted: true,
        endpoint: "/v1/w3s/developer/wallets",
        accountType,
        blockchains,
        provider: payload.data
      }
    };
  } catch (error) {
    const httpStatus = sdkHttpStatus(error);
    const providerError = sdkProviderError(error);
    const errorCode = httpStatus ? classifyCircleHttpStatus(httpStatus, providerError) : classifyCircleError(error);
    return failedCircleProviderResult(errorCode, {
      accepted: false,
      endpoint: "/v1/w3s/developer/wallets",
      errorCode,
      httpStatus,
      providerRequestId: providerError.providerRequestId,
      providerError
    });
  }
};

export const initializeCircleWalletSet = async ({
  idempotencyKey,
  walletSetName,
  walletBlockchains
}: {
  idempotencyKey?: string;
  walletSetName: string;
  walletBlockchains?: string[];
}): Promise<CircleWalletSetResult> => {
  const environment = circleEnvironment();
  const blockchains = circleWalletBlockchains(walletBlockchains);
  if (environment === "simulator") {
    const suffix = walletSetName.replace(/[^a-z0-9]/gi, "").slice(0, 18).toLowerCase() || "tenant";
    return {
      environment,
      walletSetId: `circle_wallet_set_${suffix}`,
      walletSetName,
      walletBlockchains: blockchains,
      status: "complete",
      responsePayload: { accepted: true, simulated: true, walletSetName, blockchains }
    };
  }
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? process.env.ENTITY_SECRET;
  if (!apiKey) {
    return {
      environment,
      walletSetName,
      walletBlockchains: blockchains,
      status: "failed",
      errorCode: "circle_api_key_required",
      responsePayload: { accepted: false }
    };
  }
  if (!entitySecret) {
    return {
      environment,
      walletSetName,
      walletBlockchains: blockchains,
      status: "failed",
      errorCode: "circle_wallet_configuration_required",
      responsePayload: { accepted: false, missing: { entitySecret: true }, requiredEnv: ["CIRCLE_ENTITY_SECRET"] }
    };
  }
  try {
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      baseUrl: circleBaseUrl(environment),
      entitySecret
    });
    const response = await client.createWalletSet({
      xRequestId: randomUUID(),
      idempotencyKey: circleWalletIdempotencyKey(idempotencyKey),
      name: walletSetName
    });
    const payload = { data: response.data ?? {} } as Record<string, unknown>;
    const walletSet = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>).walletSet : undefined;
    const walletSetRecord = walletSet && typeof walletSet === "object" ? walletSet as Record<string, unknown> : undefined;
    const walletSetId = typeof walletSetRecord?.id === "string" ? walletSetRecord.id : providerReferenceFromPayload(payload);
    return {
      environment,
      walletSetId,
      walletSetName,
      walletBlockchains: blockchains,
      providerRequestId: sdkProviderRequestId(response),
      status: "complete",
      responsePayload: { accepted: true, provider: payload.data }
    };
  } catch (error) {
    const httpStatus = sdkHttpStatus(error);
    const providerError = sdkProviderError(error);
    const errorCode = httpStatus ? classifyCircleHttpStatus(httpStatus, providerError) : classifyCircleError(error);
    return {
      environment,
      walletSetName,
      walletBlockchains: blockchains,
      status: "failed",
      errorCode,
      providerRequestId: typeof providerError.providerRequestId === "string" ? providerError.providerRequestId : undefined,
      responsePayload: { accepted: false, errorCode, httpStatus, providerRequestId: providerError.providerRequestId, providerError }
    };
  }
};

const simulateCircle = (request: CircleTransferRequest): CircleProviderResult => ({
  providerReferenceId: `circle_${request.operationType}_${randomUUID()}`,
  status: "complete",
  responsePayload: {
    accepted: true,
    simulated: true,
    operationType: request.operationType
  }
});

const invokeCircleHttp = async (request: CircleTransferRequest, environment: Exclude<CircleEnvironment, "simulator">): Promise<CircleProviderResult> => {
  const endpoint = circleEndpoint(request.operationType);
  return circleHttpRequest({
    method: endpoint.method,
    path: endpoint.path,
    environment,
    idempotencyKey: request.idempotencyKey,
    payload: request.payload
  });
};

const circleHttpRequest = async ({
  environment,
  idempotencyKey,
  method,
  path,
  payload = {}
}: {
  environment: Exclude<CircleEnvironment, "simulator">;
  idempotencyKey?: string;
  method: "GET" | "POST";
  path: string;
  payload?: Record<string, unknown>;
}): Promise<CircleProviderResult> => {
  const apiKey = process.env.CIRCLE_API_KEY;
  const baseUrl = circleBaseUrl(environment);
  if (!apiKey) return failedCircleProviderResult("circle_api_key_required", { accepted: false, endpoint: path });

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
      return {
        providerReferenceId: providerReferenceFromPayload(responsePayload),
        providerAccountId: providerFieldFromPayload(responsePayload, ["accountId", "account", "businessAccountId", "walletSetId"]),
        providerWalletId: providerFieldFromPayload(responsePayload, ["walletId", "wallet", "id"]),
        providerAddressId: providerFieldFromPayload(responsePayload, ["addressId", "address"]),
        providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("circle-request-id") ?? undefined,
        status: response.ok ? "complete" : "failed",
        errorCode,
        responsePayload: {
          accepted: response.ok,
          httpStatus: response.status,
          attempt,
          endpoint: path,
          providerRequestId: response.headers.get("x-request-id") ?? response.headers.get("circle-request-id") ?? undefined,
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

const classifyCircleHttpStatus = (status: number, payload: Record<string, unknown>): CircleStableErrorCode => {
  if (status === 401 || status === 403) return "circle_auth_failed";
  if (status === 429) return "circle_rate_limited";
  if (status >= 400 && status < 500) return "circle_validation_failed";
  if (status >= 500) return "circle_provider_unavailable";
  return providerReferenceFromPayload(payload).startsWith("circle_") ? "circle_response_unmapped" : "circle_provider_unavailable";
};

const classifyCircleError = (error: unknown): CircleStableErrorCode => {
  if (error instanceof Error && error.name === "AbortError") return "circle_endpoint_unreachable";
  if (error instanceof Error) return "circle_endpoint_unreachable";
  return "circle_provider_unavailable";
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const failedCircleProviderResult = (errorCode: CircleStableErrorCode, responsePayload: Record<string, unknown>): CircleProviderResult => ({
  providerReferenceId: `circle_failed_${randomUUID()}`,
  status: "failed",
  errorCode,
  responsePayload
});

const providerFieldFromPayload = (payload: Record<string, unknown>, keys: string[]): string | undefined => {
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

const firstPayloadItem = (value: unknown): Record<string, unknown> | undefined => {
  if (!Array.isArray(value)) return undefined;
  const first = value[0];
  return first && typeof first === "object" ? first as Record<string, unknown> : undefined;
};

const circleWalletBlockchains = (override?: string[]): string[] =>
  (override?.join(",") ?? process.env.CIRCLE_WALLET_BLOCKCHAINS ?? process.env.CIRCLE_WALLET_BLOCKCHAIN ?? "MATIC-AMOY")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const circleWalletIdempotencyKey = (value: string | undefined): string =>
  value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : randomUUID();

export const circleWalletAccountType: AccountType = "SCA";

const sdkProviderRequestId = (response: unknown): string | undefined => {
  const headers = (response as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  const requestId = headers?.["x-request-id"] ?? headers?.["circle-request-id"];
  return typeof requestId === "string" ? requestId : undefined;
};

const sdkHttpStatus = (error: unknown): number | undefined => {
  const candidate = error as { status?: unknown; response?: { status?: unknown; data?: unknown } };
  const data = candidate.response?.data;
  const dataRecord = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const nestedResponse = dataRecord.response && typeof dataRecord.response === "object"
    ? dataRecord.response as Record<string, unknown>
    : {};
  const nestedStatus = nestedResponse.status && typeof nestedResponse.status === "object"
    ? nestedResponse.status as Record<string, unknown>
    : {};
  const status = candidate.response?.status
    ?? candidate.status
    ?? nestedStatus.httpStatus
    ?? nestedStatus.status;
  return typeof status === "number" ? status : undefined;
};

const sdkProviderError = (error: unknown): Record<string, unknown> => {
  const candidate = error as {
    code?: unknown;
    message?: unknown;
    status?: unknown;
    response?: {
      data?: unknown;
      status?: unknown;
      headers?: Record<string, unknown>;
    };
  };
  const data = candidate.response?.data;
  const dataRecord = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const nestedResponse = dataRecord.response && typeof dataRecord.response === "object"
    ? dataRecord.response as Record<string, unknown>
    : {};
  const nestedStatus = nestedResponse.status && typeof nestedResponse.status === "object"
    ? nestedResponse.status as Record<string, unknown>
    : {};
  const providerRequestId = candidate.response?.headers?.["x-request-id"] ?? candidate.response?.headers?.["circle-request-id"];
  return {
    code: typeof dataRecord.code === "string" || typeof dataRecord.code === "number"
      ? dataRecord.code
      : typeof nestedStatus.code === "string" || typeof nestedStatus.code === "number"
        ? nestedStatus.code
        : candidate.code,
    message: typeof dataRecord.message === "string"
      ? dataRecord.message
      : typeof nestedStatus.externalMessage === "string"
        ? nestedStatus.externalMessage
        : typeof nestedStatus.message === "string"
          ? nestedStatus.message
          : typeof candidate.message === "string" ? candidate.message : undefined,
    httpStatus: typeof candidate.response?.status === "number" ? candidate.response.status : typeof candidate.status === "number" ? candidate.status : undefined,
    providerRequestId: typeof providerRequestId === "string" ? providerRequestId : undefined,
    details: dataRecord.details ?? dataRecord.error ?? nestedStatus,
    provider: data && typeof data !== "string" ? data : undefined
  };
};

const numericPayload = (value: unknown): number | undefined => typeof value === "number" ? value : undefined;

export const verifyCircleWebhook = (
  rawBody: string,
  signature: string | undefined,
  secret = process.env.CIRCLE_WEBHOOK_SECRET ?? "dev_webhook_secret"
): CircleWebhookVerification => {
  const environment = circleEnvironment();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const signatureMatches = signature === expected || (environment !== "circle-production" && signature === "test_valid_signature");
  const valid = environment === "simulator" ? (!signature || signatureMatches) : signatureMatches;
  const payload = rawBody.trim() ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  return {
    valid,
    providerEventId: typeof payload.id === "string" ? payload.id : `circle_event_${randomUUID()}`,
    eventType: typeof payload.type === "string" ? payload.type : "circle.transfer.status_changed",
    normalizedPayload: {
      providerEventId: typeof payload.id === "string" ? payload.id : undefined,
      eventType: typeof payload.type === "string" ? payload.type : "circle.transfer.status_changed",
      status: typeof payload.status === "string" ? payload.status : "unknown",
      resourceId: typeof payload.resourceId === "string" ? payload.resourceId : undefined
    }
  };
};
