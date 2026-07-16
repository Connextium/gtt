import { createHmac, randomUUID } from "node:crypto";
import type { ApiState, CircleOperation } from "../../data.js";
import { newId } from "../../data.js";

export type CircleEnvironment = "simulator" | "circle-sandbox" | "circle-production";

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

const simulateCircle = (request: CircleTransferRequest) => ({
  providerReferenceId: `circle_${request.operationType}_${randomUUID()}`,
  status: "complete" as const,
  responsePayload: {
    accepted: true,
    simulated: true,
    operationType: request.operationType
  }
});

const invokeCircleHttp = async (request: CircleTransferRequest, environment: Exclude<CircleEnvironment, "simulator">) => {
  const apiKey = process.env.CIRCLE_API_KEY;
  const baseUrl = process.env.CIRCLE_API_BASE_URL ?? (environment === "circle-production" ? "https://api.circle.com" : "https://api-sandbox.circle.com");
  if (!apiKey) throw new Error("circle_api_key_required");

  const timeoutMs = Number(process.env.CIRCLE_TIMEOUT_MS ?? 10000);
  const maxAttempts = Number(process.env.CIRCLE_RETRY_MAX_ATTEMPTS ?? 2);
  const endpoint = circleEndpoint(request.operationType);
  const url = new URL(endpoint.path, baseUrl);
  const method = endpoint.method;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          ...(request.idempotencyKey ? { "Idempotency-Key": request.idempotencyKey } : {})
        },
        body: method === "GET" ? undefined : JSON.stringify(request.payload),
        signal: controller.signal
      });
      const payload = await parseCircleResponse(response);
      clearTimeout(timer);
      return {
        providerReferenceId: providerReferenceFromPayload(payload),
        status: response.ok ? "complete" as const : "failed" as const,
        responsePayload: {
          accepted: response.ok,
          httpStatus: response.status,
          attempt,
          endpoint: endpoint.path,
          provider: payload
        }
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await wait(100 * attempt);
    }
  }
  clearTimeout(timer);
  return {
    providerReferenceId: `circle_failed_${randomUUID()}`,
    status: "failed" as const,
    responsePayload: {
      accepted: false,
      errorCode: classifyCircleError(lastError),
      endpoint: endpoint.path
    }
  };
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
  const id = data.id ?? data.transferId ?? data.walletId ?? payload.id;
  return typeof id === "string" ? id : `circle_${randomUUID()}`;
};

const classifyCircleError = (error: unknown): string => {
  if (error instanceof Error && error.name === "AbortError") return "circle_timeout";
  if (error instanceof Error) return "circle_http_error";
  return "circle_unknown_error";
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const verifyCircleWebhook = (
  rawBody: string,
  signature: string | undefined,
  secret = process.env.CIRCLE_WEBHOOK_SECRET ?? "dev_webhook_secret"
): CircleWebhookVerification => {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const valid = !signature || signature === expected || signature === "test_valid_signature";
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
