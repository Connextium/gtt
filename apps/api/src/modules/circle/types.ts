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
