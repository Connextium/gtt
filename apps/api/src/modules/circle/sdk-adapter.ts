import { randomUUID } from "node:crypto";
import type { AccountType, Blockchain } from "@circle-fin/developer-controlled-wallets";
import { circleBaseUrl, circleEnvironment } from "./env-config.js";
import { classifyCircleError, classifyCircleHttpStatus, providerFieldFromPayload } from "./http-transport.js";
import { maskedApiKeyPrefix } from "./log-redaction.js";
import type {
  CircleAdaMappingRequest,
  CircleEnvironment,
  CircleProviderResult,
  CircleStableErrorCode,
  CircleTenantWalletRequest,
  CircleWalletSetResult
} from "./types.js";

interface CircleAuthDebugOptions {
  environment: CircleEnvironment;
  endpoint: string;
  apiKeyConfigured: boolean;
  apiKeySource?: string;
  apiKeyValue?: string;
  entitySecretConfigured?: boolean;
  providerRequestId?: string;
  httpStatus?: number;
  providerError?: Record<string, unknown>;
}

export const circleWalletAccountType: AccountType = "SCA";

export const circleWalletBlockchains = (override?: string[]): string[] =>
  (override?.join(",") ?? process.env.CIRCLE_WALLET_BLOCKCHAINS ?? process.env.CIRCLE_WALLET_BLOCKCHAIN ?? defaultCircleBlockchainByEnvironment())
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const circleWalletIdempotencyKey = (value: string | undefined): string =>
  value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : randomUUID();

export const sdkProviderRequestId = (response: unknown): string | undefined => {
  const headers = (response as { response?: { headers?: Record<string, unknown> } }).response?.headers;
  const requestId = headers?.["x-request-id"] ?? headers?.["circle-request-id"];
  return typeof requestId === "string" ? requestId : undefined;
};

export const sdkHttpStatus = (error: unknown): number | undefined => {
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

export const sdkProviderError = (error: unknown): Record<string, unknown> => {
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
    console.log(`Initiating Circle Wallet Set: ${walletSetName} with blockchains: ${blockchains.join(", ")}`);
    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret
    });
    console.log(`Creating Circle Wallet Set: ${walletSetName} with blockchains: ${blockchains.join(", ")}`);
    const response = await client.createWalletSet({
      xRequestId: randomUUID(),
      idempotencyKey: circleWalletIdempotencyKey(idempotencyKey),
      name: walletSetName
    });
    const payload = { data: response.data ?? {} } as Record<string, unknown>;
    const walletSet = payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>).walletSet : undefined;
    const walletSetRecord = walletSet && typeof walletSet === "object" ? walletSet as Record<string, unknown> : undefined;
    const walletSetId = typeof walletSetRecord?.id === "string"
      ? walletSetRecord.id
      : (providerFieldFromPayload(payload, ["walletSetId", "id", "walletId"]) ?? `circle_wallet_set_${randomUUID().slice(0, 12)}`);
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
    const providerRequestId = typeof providerError.providerRequestId === "string" ? providerError.providerRequestId : undefined;
    const authDebug = errorCode === "circle_auth_failed"
      ? circleAuthDebugInfo({
          environment,
          endpoint: "/v1/w3s/developer/walletSets",
          apiKeyConfigured: Boolean(apiKey),
          entitySecretConfigured: Boolean(entitySecret),
          providerRequestId,
          httpStatus,
          providerError
        })
      : undefined;
    return {
      environment,
      walletSetName,
      walletBlockchains: blockchains,
      status: "failed",
      errorCode,
      providerRequestId,
      responsePayload: { accepted: false, errorCode, httpStatus, providerRequestId, providerError, authDebug }
    };
  }
};

export const initializeTenantCircleWallet = async (request: CircleTenantWalletRequest): Promise<CircleProviderResult> => {
  const environment = circleEnvironment();
  const blockchains = circleWalletBlockchains(request.walletBlockchains);
  if (environment === "simulator") {
    const suffix = request.tenantId.replace(/[^a-z0-9]/gi, "").slice(-12) || randomUUID().slice(0, 12);
    return {
      providerAccountId: request.walletSetId,
      providerWalletId: `circle_tenant_wallet_${suffix}`,
      providerAddressId: `circle_tenant_address_${suffix}`,
      providerRequestId: `circle_request_${suffix}`,
      status: "complete",
      responsePayload: {
        accepted: true,
        simulated: true,
        walletSetId: request.walletSetId,
        blockchains,
        accountType: circleWalletAccountType
      }
    };
  }
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? process.env.ENTITY_SECRET;
  if (!apiKey) return failedCircleProviderResult("circle_api_key_required", { accepted: false });
  if (!entitySecret || !request.walletSetId) {
    return failedCircleProviderResult("circle_wallet_configuration_required", {
      accepted: false,
      missing: {
        entitySecret: !entitySecret,
        walletSetId: !request.walletSetId
      },
      requiredEnv: ["CIRCLE_ENTITY_SECRET"]
    });
  }

  try {
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret
    });
    const response = await client.createWallets({
      xRequestId: randomUUID(),
      idempotencyKey: circleWalletIdempotencyKey(request.idempotencyKey),
      blockchains: blockchains as Blockchain[],
      count: 1,
      walletSetId: request.walletSetId,
      accountType: circleWalletAccountType,
      metadata: [
        {
          name: `${request.walletSetName ?? "GTT Tenant"} Treasury Wallet`,
          refId: request.tenantId
        }
      ]
    });
    const payload = { data: response.data ?? {} } as Record<string, unknown>;
    return {
      providerAccountId: request.walletSetId,
      providerWalletId: providerFieldFromPayload(payload, ["walletId", "wallet", "id"]),
      providerAddressId: providerFieldFromPayload(payload, ["addressId", "address"]),
      providerRequestId: sdkProviderRequestId(response),
      status: "complete",
      responsePayload: {
        accepted: true,
        endpoint: "/v1/w3s/developer/wallets",
        accountType: circleWalletAccountType,
        blockchains,
        provider: payload.data
      }
    };
  } catch (error) {
    const httpStatus = sdkHttpStatus(error);
    const providerError = sdkProviderError(error);
    const errorCode = httpStatus ? classifyCircleHttpStatus(httpStatus, providerError) : classifyCircleError(error);
    const providerRequestId = typeof providerError.providerRequestId === "string" ? providerError.providerRequestId : undefined;
    const authDebug = errorCode === "circle_auth_failed"
      ? circleAuthDebugInfo({
          environment,
          endpoint: "/v1/w3s/developer/wallets",
          apiKeyConfigured: Boolean(apiKey),
          entitySecretConfigured: Boolean(entitySecret),
          providerRequestId,
          httpStatus,
          providerError
        })
      : undefined;
    return failedCircleProviderResult(errorCode, {
      accepted: false,
      endpoint: "/v1/w3s/developer/wallets",
      errorCode,
      httpStatus,
      providerRequestId,
      providerError,
      authDebug
    });
  }
};

export const provisionDeveloperControlledWallet = async (
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
    const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
    console.log(`Initiating Circle Wallets Client for ADA Account: ${request.accountOfDigitalAssetId} with blockchains: ${blockchains.join(", ")}`);
    const client = initiateDeveloperControlledWalletsClient({
      apiKey,
      entitySecret
    });
    console.log(`Creating Circle Wallet for ADA Account: ${request.accountOfDigitalAssetId} with blockchains: ${blockchains.join(", ")}`);
    const response = await client.createWallets({
      xRequestId: randomUUID(),
      idempotencyKey: circleWalletIdempotencyKey(request.idempotencyKey),
      blockchains: blockchains as Blockchain[],
      count: 1,
      walletSetId,
      accountType: circleWalletAccountType,
      metadata: [
        {
          name: `GTT ADA ${request.accountOfDigitalAssetId}`,
          refId: request.accountOfDigitalAssetId
        }
      ]
    });
    const payload = { data: response.data ?? {} } as Record<string, unknown>;
    return {
      providerAccountId: walletSetId,
      providerWalletId: providerFieldFromPayload(payload, ["walletId", "wallet", "id"]),
      providerAddressId: providerFieldFromPayload(payload, ["addressId", "address"]),
      providerRequestId: sdkProviderRequestId(response),
      status: "complete",
      responsePayload: {
        accepted: true,
        endpoint: "/v1/w3s/developer/wallets",
        accountType: circleWalletAccountType,
        blockchains,
        provider: payload.data
      }
    };
  } catch (error) {
    const httpStatus = sdkHttpStatus(error);
    const providerError = sdkProviderError(error);
    const errorCode = httpStatus ? classifyCircleHttpStatus(httpStatus, providerError) : classifyCircleError(error);
    const providerRequestId = typeof providerError.providerRequestId === "string" ? providerError.providerRequestId : undefined;
    const authDebug = errorCode === "circle_auth_failed"
      ? circleAuthDebugInfo({
          environment,
          endpoint: "/v1/w3s/developer/wallets",
          apiKeyConfigured: Boolean(apiKey),
          entitySecretConfigured: Boolean(entitySecret),
          providerRequestId,
          httpStatus,
          providerError
        })
      : undefined;
    return failedCircleProviderResult(errorCode, {
      accepted: false,
      endpoint: "/v1/w3s/developer/wallets",
      errorCode,
      httpStatus,
      providerRequestId,
      providerError,
      authDebug
    });
  }
};

const defaultCircleBlockchainByEnvironment = (): string =>
  circleEnvironment() === "circle-sandbox" ? "ARC-TESTNET" : "ARC";

const failedCircleProviderResult = (errorCode: CircleStableErrorCode, responsePayload: Record<string, unknown>): CircleProviderResult => ({
  status: "failed",
  errorCode,
  responsePayload
});

const circleAuthDebugInfo = ({
  environment,
  endpoint,
  apiKeyConfigured,
  apiKeySource,
  apiKeyValue,
  entitySecretConfigured,
  providerRequestId,
  httpStatus,
  providerError
}: CircleAuthDebugOptions): Record<string, unknown> => ({
  authContext: "circle_credential_check",
  environment,
  baseUrl: circleBaseUrl(environment),
  endpoint,
  httpStatus,
  providerRequestId,
  apiKeyConfigured,
  apiKeySource,
  entitySecretConfigured,
  apiKeyPrefix: maskedApiKeyPrefix(apiKeyValue ?? process.env.CIRCLE_API_KEY),
  entitySecretPrefix: maskedApiKeyPrefix(process.env.CIRCLE_ENTITY_SECRET ?? process.env.ENTITY_SECRET),
  providerError
});
