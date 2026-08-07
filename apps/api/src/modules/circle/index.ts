import { randomUUID } from "node:crypto";
import type { ApiState, CircleOperation } from "../../data.js";
import { newId } from "../../data.js";
import {
  CirclePayloadValidationError,
  buildBusinessAccountTransferPayload,
  buildSandboxWireAccountPayload,
  buildSandboxWireMockPayload,
  defaultFiatMintEndpoint
} from "./payload-builders.js";
import {
  redactMintPayloadForLog,
  redactWireAccountPayloadForLog
} from "./log-redaction.js";
import {
  circleHttpRequest,
  invokeCircleHttp
} from "./http-transport.js";
import {
  circleBaseUrl,
  circleEnvironment,
  circleRetryMaxAttempts,
  circleTimeoutMs
} from "./env-config.js";
import {
  provisionDeveloperControlledWallet
} from "./sdk-adapter.js";
export {
  circleWalletAccountType,
  initializeCircleWalletSet,
  initializeTenantCircleWallet
} from "./sdk-adapter.js";
import { asRecord, asString } from "./value-utils.js";
export { verifyCircleWebhook } from "./webhook-verification.js";

export type CircleEnvironment = "simulator" | "circle-sandbox" | "circle-production";
export type CircleStableErrorCode =
  | "circle_api_key_required"
  | "circle_fiat_mint_endpoint_not_configured"
  | "circle_endpoint_unreachable"
  | "circle_auth_failed"
  | "circle_rate_limited"
  | "circle_validation_failed"
  | "circle_provider_unavailable"
  | "circle_response_unmapped"
  | "circle_wallet_configuration_required"
  | "circle_webhook_signature_invalid";

export interface CircleProviderResult {
  providerReferenceId?: string;
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

export interface CircleTenantWalletRequest {
  tenantId: string;
  walletSetId: string;
  walletSetName?: string;
  walletBlockchains?: string[];
  idempotencyKey?: string;
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

export interface CircleFiatMintToWalletRequest {
  tenantId: string;
  accountOfDigitalAssetId: string;
  businessClientId: string;
  walletId: string;
  walletAddress?: string;
  amountMinorUnits: string;
  assetCode?: string;
  currency?: string;
  idempotencyKey?: string;
  correlationId?: string;
  payload?: Record<string, unknown>;
}

export interface CircleSandboxWireProvisioningRequest {
  tenantId: string;
  accountOfDigitalAssetId: string;
  businessClientId: string;
  idempotencyKey?: string;
  payload?: Record<string, unknown>;
}

export interface CircleSandboxWireInstructionsRequest {
  tenantId: string;
  wireAccountId: string;
  linkedWireAccount?: {
    trackingRef?: string;
    beneficiaryBankAccountNumber?: string;
    wireInstructions?: Record<string, unknown>;
  };
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
      errorCode: provider.errorCode,
      ...provider.responsePayload
    },
    providerRequestId: provider.providerRequestId,
    providerAccountId: provider.providerAccountId,
    providerWalletId: provider.providerWalletId,
    providerAddressId: provider.providerAddressId,
    status: provider.status,
    createdAt: new Date().toISOString()
  };
  state.circleOperations.push(operation);
  return operation;
};

export { circleEnvironment, circleBaseUrl, circleTimeoutMs, circleRetryMaxAttempts };

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
      providerAccountId: `circle_account_${suffix}`,
      providerWalletId: `circle_wallet_${suffix}`,
      providerAddressId: `circle_address_${suffix}`,
      providerRequestId: `circle_request_${suffix}`,
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

export const mintFiatToCircleWallet = async (request: CircleFiatMintToWalletRequest): Promise<CircleProviderResult> => {
  const environment = circleEnvironment();
  if (environment === "simulator") {
    return {
      providerReferenceId: request.walletId,
      providerRequestId: `circle_fiat_mint_${randomUUID()}`,
      providerWalletId: request.walletId,
      providerAddressId: request.walletAddress,
      status: "complete",
      responsePayload: {
        accepted: true,
        simulated: true,
        operationType: "fiat_wallet_mint",
        walletId: request.walletId,
        destinationWalletId: request.walletId,
        destinationWalletAddress: request.walletAddress,
        amountMinorUnits: request.amountMinorUnits,
        accountOfDigitalAssetId: request.accountOfDigitalAssetId,
        businessClientId: request.businessClientId
      }
    };
  }

  const endpoint = process.env.CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET ?? defaultFiatMintEndpoint(environment);
  const useSandboxMockFlow = (environment === "circle-sandbox" && !process.env.CIRCLE_ENDPOINT_FIAT_MINT_TO_WALLET)
    || endpoint.includes("/mocks/payments/wire");

  const mockMintApiKey = useSandboxMockFlow
    ? (process.env.CIRCLE_MINT_KEY ?? process.env.CIRCLE_API_KEY)
    : undefined;
  if (useSandboxMockFlow && !mockMintApiKey) {
    return failedCircleProviderResult("circle_api_key_required", {
      accepted: false,
      endpoint,
      detail: "Set CIRCLE_MINT_KEY (preferred) or CIRCLE_API_KEY for sandbox mock wire mint authentication"
    });
  }

  let mintPayload: Record<string, unknown>;
  try {
    mintPayload = useSandboxMockFlow
      ? buildSandboxWireMockPayload(request)
      : buildBusinessAccountTransferPayload(request, environment);
  } catch (error) {
    if (error instanceof CirclePayloadValidationError) {
      return failedCircleProviderResult("circle_validation_failed", {
        accepted: false,
        endpoint,
        detail: error.message
      });
    }
    throw error;
  }

  console.log("[circle] Mint fiat request", {
    endpoint,
    tenantId: request.tenantId,
    accountOfDigitalAssetId: request.accountOfDigitalAssetId,
    businessClientId: request.businessClientId,
    walletId: request.walletId,
    walletAddress: request.walletAddress,
    amountMinorUnits: request.amountMinorUnits,
    currency: request.currency ?? "USD",
    apiKeySource: useSandboxMockFlow
      ? (process.env.CIRCLE_MINT_KEY ? "CIRCLE_MINT_KEY" : "CIRCLE_API_KEY")
      : "CIRCLE_API_KEY",
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
    payload: redactMintPayloadForLog(mintPayload)
  });

  const response = await circleHttpRequest({
    method: "POST",
    path: endpoint,
    environment,
    apiKeyOverride: mockMintApiKey,
    apiKeySource: useSandboxMockFlow
      ? (process.env.CIRCLE_MINT_KEY ? "CIRCLE_MINT_KEY" : "CIRCLE_API_KEY")
      : undefined,
    idempotencyKey: request.idempotencyKey,
    payload: mintPayload
  });

  return {
    ...response,
    providerReferenceId: response.providerReferenceId ?? response.providerWalletId ?? request.walletId,
    providerWalletId: response.providerWalletId ?? request.walletId
  };
};

export const provisionSandboxWireFundingInstructions = async (
  request: CircleSandboxWireProvisioningRequest
): Promise<CircleProviderResult> => {
  const environment = circleEnvironment();
  if (environment === "simulator") {
    return {
      providerReferenceId: `circle_wire_${randomUUID().slice(0, 12)}`,
      status: "complete",
      responsePayload: {
        accepted: true,
        simulated: true,
        operationType: "sandbox_wire_funding_instructions",
        accountOfDigitalAssetId: request.accountOfDigitalAssetId,
        businessClientId: request.businessClientId
      }
    };
  }
  if (environment !== "circle-sandbox") {
    return {
      status: "complete",
      responsePayload: {
        accepted: true,
        skipped: true,
        reason: "sandbox_only"
      }
    };
  }

  const sandboxWireApiKey = process.env.CIRCLE_MINT_KEY;
  const sandboxWireApiKeySource = "CIRCLE_MINT_KEY";
  if (!sandboxWireApiKey) {
    return failedCircleProviderResult("circle_api_key_required", {
      accepted: false,
      endpoint: "/v1/businessAccount/banks/wires",
      detail: "Set CIRCLE_MINT_KEY for sandbox wire registration/instructions authentication"
    });
  }

  let wireAccountPayload: Record<string, unknown>;
  try {
    wireAccountPayload = buildSandboxWireAccountPayload(request);
  } catch (error) {
    if (error instanceof CirclePayloadValidationError) {
      return failedCircleProviderResult("circle_validation_failed", {
        accepted: false,
        endpoint: "/v1/businessAccount/banks/wires",
        detail: error.message,
        step: "register_wire_account"
      });
    }
    throw error;
  }
  console.log("[circle] Registering business wire account", {
    endpoint: "/v1/businessAccount/banks/wires",
    tenantId: request.tenantId,
    accountOfDigitalAssetId: request.accountOfDigitalAssetId,
    businessClientId: request.businessClientId,
    apiKeySource: sandboxWireApiKeySource,
    idempotencyKey: asString(wireAccountPayload.idempotencyKey) ?? request.idempotencyKey,
    payload: redactWireAccountPayloadForLog(wireAccountPayload)
  });

  const existingWireAccountMatches = await findExistingSandboxWireAccountsByLast4({
    environment,
    sandboxWireApiKey,
    wireAccountPayload
  });

  if (existingWireAccountMatches.length > 1) {
    return failedCircleProviderResult("circle_validation_failed", {
      accepted: false,
      endpoint: "/v1/businessAccount/banks/wires",
      detail: "Multiple existing business wire accounts matched the supplied account number suffix; provide businessWireAccountId to disambiguate.",
      step: "register_wire_account",
      matchingBusinessWireAccountIds: existingWireAccountMatches.map((match) => match.id)
    });
  }

  if (existingWireAccountMatches.length === 1) {
    const existingWireAccount = existingWireAccountMatches[0];
    console.log("[circle] Reusing existing business wire account", {
      endpoint: "/v1/businessAccount/banks/wires",
      tenantId: request.tenantId,
      accountOfDigitalAssetId: request.accountOfDigitalAssetId,
      businessClientId: request.businessClientId,
      businessWireAccountId: existingWireAccount.id,
      reason: "matched_account_number_suffix"
    });

    const existingInstructionsResponse = await retrieveSandboxWireFundingInstructions({
      tenantId: request.tenantId,
      wireAccountId: existingWireAccount.id,
      linkedWireAccount: {
        trackingRef: asString(existingWireAccount.wireData?.trackingRef),
        beneficiaryBankAccountNumber: asString(asRecord(asRecord(existingWireAccount.wireData?.beneficiaryBank))?.accountNumber),
        wireInstructions: existingWireAccount.wireData
      }
    });
    if (existingInstructionsResponse.status !== "complete") {
      return {
        ...existingInstructionsResponse,
        responsePayload: {
          ...existingInstructionsResponse.responsePayload,
          step: "retrieve_wire_instructions",
          businessWireAccountId: existingWireAccount.id,
          wireAccount: existingWireAccount.wireData
        }
      };
    }

    const existingInstructionsPayload = asRecord(existingInstructionsResponse.responsePayload) ?? {};
    const existingInstructionsData = asRecord(existingInstructionsPayload.wireInstructions)
      ?? asRecord(asRecord(existingInstructionsPayload.provider)?.data)
      ?? asRecord(existingInstructionsPayload.provider)
      ?? {};
    const existingTrackingRef = asString(existingInstructionsPayload.trackingRef)
      ?? asString(existingInstructionsData?.trackingRef)
      ?? asString(existingWireAccount.wireData?.trackingRef);
    const existingBeneficiaryBankAccountNumber = asString(existingInstructionsPayload.beneficiaryBankAccountNumber)
      ?? asString(asRecord(asRecord(existingInstructionsData?.beneficiaryBank))?.accountNumber);

    return {
      providerReferenceId: existingWireAccount.id,
      providerAccountId: existingWireAccount.id,
      providerRequestId: existingInstructionsResponse.providerRequestId,
      status: "complete",
      responsePayload: {
        accepted: true,
        reusedExistingBusinessWireAccountId: true,
        businessWireAccountId: existingWireAccount.id,
        trackingRef: existingTrackingRef,
        beneficiaryBankAccountNumber: existingBeneficiaryBankAccountNumber,
        wireAccount: existingWireAccount.wireData,
        wireInstructions: existingInstructionsData
      }
    };
  }

  const wireAccountResponse = await circleHttpRequest({
    method: "POST",
    path: "/v1/businessAccount/banks/wires",
    environment,
    apiKeyOverride: sandboxWireApiKey,
    apiKeySource: sandboxWireApiKeySource,
    idempotencyKey: request.idempotencyKey,
    payload: wireAccountPayload
  });
  if (wireAccountResponse.status !== "complete") {
    console.error("[circle] Business wire account registration failed", {
      endpoint: "/v1/businessAccount/banks/wires",
      tenantId: request.tenantId,
      accountOfDigitalAssetId: request.accountOfDigitalAssetId,
      businessClientId: request.businessClientId,
      apiKeySource: sandboxWireApiKeySource,
      providerRequestId: wireAccountResponse.providerRequestId,
      errorCode: wireAccountResponse.errorCode,
      detail: asString(wireAccountResponse.responsePayload?.detail),
      provider: wireAccountResponse.responsePayload?.provider
    });
    return {
      ...wireAccountResponse,
      responsePayload: {
        ...wireAccountResponse.responsePayload,
        step: "register_wire_account"
      }
    };
  }

  const wireProvider = asRecord(wireAccountResponse.responsePayload.provider);
  const wireData = asRecord(wireProvider?.data) ?? wireProvider;
  const wireAccountId = asString(wireData?.id) ?? wireAccountResponse.providerReferenceId ?? wireAccountResponse.providerAccountId;
  if (!wireAccountId) {
    return failedCircleProviderResult("circle_response_unmapped", {
      accepted: false,
      endpoint: "/v1/businessAccount/banks/wires",
      detail: "Wire account id missing from Circle response",
      provider: wireAccountResponse.responsePayload.provider
    });
  }

  const instructionsResponse = await retrieveSandboxWireFundingInstructions({
    tenantId: request.tenantId,
    wireAccountId,
    linkedWireAccount: {
      trackingRef: asString(wireData?.trackingRef),
      beneficiaryBankAccountNumber: asString(asRecord(asRecord(wireData?.beneficiaryBank))?.accountNumber),
      wireInstructions: wireData
    }
  });
  if (instructionsResponse.status !== "complete") {
    return {
      ...instructionsResponse,
      responsePayload: {
        ...instructionsResponse.responsePayload,
        step: "retrieve_wire_instructions",
        businessWireAccountId: wireAccountId,
        wireAccount: wireData
      }
    };
  }

  const instructionsPayload = asRecord(instructionsResponse.responsePayload) ?? {};
  const instructionsData = asRecord(instructionsPayload.wireInstructions)
    ?? asRecord(asRecord(instructionsPayload.provider)?.data)
    ?? asRecord(instructionsPayload.provider)
    ?? {};
  const trackingRef = asString(instructionsPayload.trackingRef)
    ?? asString(instructionsData?.trackingRef)
    ?? asString(wireData?.trackingRef);
  const beneficiaryBankAccountNumber = asString(instructionsPayload.beneficiaryBankAccountNumber)
    ?? asString(asRecord(asRecord(instructionsData?.beneficiaryBank))?.accountNumber);

  return {
    providerReferenceId: wireAccountId,
    providerAccountId: wireAccountId,
    providerRequestId: instructionsResponse.providerRequestId ?? wireAccountResponse.providerRequestId,
    status: "complete",
    responsePayload: {
      accepted: true,
      businessWireAccountId: wireAccountId,
      trackingRef,
      beneficiaryBankAccountNumber,
      wireAccount: wireData,
      wireInstructions: instructionsData
    }
  };
};

export const retrieveSandboxWireFundingInstructions = async (
  request: CircleSandboxWireInstructionsRequest
): Promise<CircleProviderResult> => {
  const environment = circleEnvironment();
  if (environment === "simulator") {
    const linkedWire = request.linkedWireAccount;
    const linkedInstructions = asRecord(linkedWire?.wireInstructions) ?? {};
    const linkedBeneficiaryBank = asRecord(linkedInstructions.beneficiaryBank) ?? {};
    const trackingRef = asString(linkedWire?.trackingRef)
      ?? asString(linkedInstructions.trackingRef)
      ?? asString(linkedInstructions.paymentTrackingRef)
      ?? asString(linkedInstructions.trackingReference);
    const beneficiaryBankAccountNumber = asString(linkedWire?.beneficiaryBankAccountNumber)
      ?? asString(linkedBeneficiaryBank.accountNumber);
    if (!trackingRef) {
      return failedCircleProviderResult("circle_response_unmapped", {
        accepted: false,
        detail: "trackingRef missing from linked wire account",
        businessWireAccountId: request.wireAccountId
      });
    }
    return {
      providerReferenceId: request.wireAccountId,
      providerAccountId: request.wireAccountId,
      status: "complete",
      responsePayload: {
        accepted: true,
        simulated: true,
        businessWireAccountId: request.wireAccountId,
        trackingRef,
        beneficiaryBankAccountNumber,
        wireInstructions: {
          ...linkedInstructions,
          trackingRef,
          beneficiaryBank: {
            ...linkedBeneficiaryBank,
            ...(beneficiaryBankAccountNumber ? { accountNumber: beneficiaryBankAccountNumber } : {})
          }
        }
      }
    };
  }
  if (environment !== "circle-sandbox") {
    return {
      status: "complete",
      responsePayload: {
        accepted: true,
        skipped: true,
        reason: "sandbox_only",
        businessWireAccountId: request.wireAccountId
      }
    };
  }

  const sandboxWireApiKey = process.env.CIRCLE_MINT_KEY;
  const instructionsPath = `/v1/businessAccount/banks/wires/${encodeURIComponent(request.wireAccountId)}/instructions`;
  if (!sandboxWireApiKey) {
    return failedCircleProviderResult("circle_api_key_required", {
      accepted: false,
      endpoint: instructionsPath,
      detail: "Set CIRCLE_MINT_KEY for sandbox wire instructions authentication"
    });
  }

  const response = await circleHttpRequest({
    method: "GET",
    path: instructionsPath,
    environment,
    apiKeyOverride: sandboxWireApiKey,
    apiKeySource: "CIRCLE_MINT_KEY"
  });
  if (response.status !== "complete") {
    return {
      ...response,
      responsePayload: {
        ...response.responsePayload,
        step: "retrieve_wire_instructions",
        businessWireAccountId: request.wireAccountId
      }
    };
  }

  const provider = asRecord(response.responsePayload.provider);
  const instructionsData = asRecord(provider?.data) ?? provider;
  const beneficiaryBank = asRecord(instructionsData?.beneficiaryBank);
  const trackingRef = asString(instructionsData?.trackingRef);
  const beneficiaryBankAccountNumber = asString(beneficiaryBank?.accountNumber);

  if (!trackingRef) {
    return failedCircleProviderResult("circle_response_unmapped", {
      accepted: false,
      endpoint: instructionsPath,
      detail: "trackingRef missing from Circle wire instructions response",
      businessWireAccountId: request.wireAccountId,
      provider: response.responsePayload.provider
    });
  }

  return {
    providerReferenceId: request.wireAccountId,
    providerAccountId: request.wireAccountId,
    providerRequestId: response.providerRequestId,
    status: "complete",
    responsePayload: {
      accepted: true,
      businessWireAccountId: request.wireAccountId,
      trackingRef,
      beneficiaryBankAccountNumber,
      wireInstructions: instructionsData,
      provider: response.responsePayload.provider
    }
  };
};

const simulateCircle = (request: CircleTransferRequest): CircleProviderResult => ({
  providerRequestId: `circle_${request.operationType}_${randomUUID()}`,
  status: "complete",
  responsePayload: {
    accepted: true,
    simulated: true,
    operationType: request.operationType
  }
});

const failedCircleProviderResult = (errorCode: CircleStableErrorCode, responsePayload: Record<string, unknown>): CircleProviderResult => ({
  status: "failed",
  errorCode,
  responsePayload
});

const findExistingSandboxWireAccountsByLast4 = async ({
  environment,
  sandboxWireApiKey,
  wireAccountPayload
}: {
  environment: Exclude<CircleEnvironment, "simulator">;
  sandboxWireApiKey: string;
  wireAccountPayload: Record<string, unknown>;
}): Promise<Array<{ id: string; wireData: Record<string, unknown> }>> => {
  const accountNumber = asString(wireAccountPayload.accountNumber);
  if (!accountNumber || accountNumber.length < 4) return [];

  const accountSuffix = accountNumber.slice(-4);
  const listResponse = await circleHttpRequest({
    method: "GET",
    path: "/v1/businessAccount/banks/wires",
    environment,
    apiKeyOverride: sandboxWireApiKey,
    apiKeySource: "CIRCLE_MINT_KEY"
  });

  if (listResponse.status !== "complete") {
    console.warn("[circle] Unable to list existing business wire accounts before registration", {
      endpoint: "/v1/businessAccount/banks/wires",
      providerRequestId: listResponse.providerRequestId,
      errorCode: listResponse.errorCode,
      detail: asString(listResponse.responsePayload?.detail)
    });
    return [];
  }

  const provider = asRecord(listResponse.responsePayload.provider);
  const providerData = provider?.data;
  if (!Array.isArray(providerData)) return [];

  const matches: Array<{ id: string; wireData: Record<string, unknown> }> = [];
  for (const item of providerData) {
    const wire = asRecord(item);
    if (!wire) continue;
    const id = asString(wire.id);
    const description = asString(wire.description);
    if (!id || !description) continue;
    if (!description.includes(`****${accountSuffix}`)) continue;
    matches.push({ id, wireData: wire });
  }
  return matches;
};

const numericPayload = (value: unknown): number | undefined => typeof value === "number" ? value : undefined;

