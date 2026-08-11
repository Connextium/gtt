import { randomUUID } from "node:crypto";
import type { TenantActivationRepository } from "../db/repositories/tenant-activation-repository.js";
import type { CircleTreasuryService } from "./circle-treasury-service.js";
import type { PostgresRouteInput } from "../db/postgres-route-types.js";

export const activateTenantService = async (
  repo: TenantActivationRepository,
  circleTreasury: CircleTreasuryService,
  writeAuditAndOutbox: (eventType: string, payload: Record<string, unknown>) => Promise<void>,
  tenantId: string,
  input: PostgresRouteInput,
  circleEnvironment: () => string,
  circleWalletBlockchainsFromEnv: () => string[],
  circleWalletAccountType: string
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const tenant = await repo.findTenant(tenantId);
  if (!tenant) return { status: 404, body: { error: "tenant_not_found" } };

  const existingIntegration = await repo.findCircleIntegration(tenantId);
  const existingWalletSetId = typeof existingIntegration?.wallet_set_id === "string"
    ? existingIntegration.wallet_set_id
    : undefined;
  const existingWalletSetName = typeof existingIntegration?.wallet_set_name === "string"
    ? existingIntegration.wallet_set_name
    : undefined;
  const existingWalletBlockchains = existingIntegration?.wallet_blockchain
    ? normalizeStringList(existingIntegration.wallet_blockchain)
    : [];

  const requestWalletSetId = optionalStringBody(input.body, "walletSetId");
  const requestWalletBlockchains = stringArrayBody(input.body, "walletBlockchains", circleWalletBlockchainsFromEnv());
  const tenantName = typeof tenant.tenant_name === "string" ? tenant.tenant_name : "Platform Tenant";
  const walletSetName = optionalStringBody(input.body, "walletSetName") ?? existingWalletSetName ?? `${tenantName} Wallet Set`;
  const walletBlockchains = requestWalletBlockchains.length > 0 ? requestWalletBlockchains : existingWalletBlockchains.length > 0 ? existingWalletBlockchains : circleWalletBlockchainsFromEnv();
  const walletBlockchain = walletBlockchains[0];

  let effectiveWalletSetId = requestWalletSetId ?? existingWalletSetId;
  if (!effectiveWalletSetId) {
    const walletSetResult = await circleTreasury.initializeWalletSet({
      idempotencyKey: input.idempotencyKey!,
      walletSetName,
      walletBlockchains
    });
    if (walletSetResult.status !== "complete" || !walletSetResult.walletSetId) {
      await writeAuditAndOutbox("platform_tenant.circle_activation.failed", {
        tenantId,
        errorCode: walletSetResult.errorCode,
        detail: walletSetResult.responsePayload && typeof walletSetResult.responsePayload === "object"
          ? tenantActivationFailureDetail(walletSetResult.responsePayload as Record<string, unknown>)
          : undefined
      });
      const failureStatus = walletSetResult.errorCode === "circle_api_key_required"
        || walletSetResult.errorCode === "circle_wallet_configuration_required"
        || walletSetResult.errorCode === "circle_fiat_mint_endpoint_not_configured"
        ? 400
        : 502;
      return {
        status: failureStatus,
        body: {
          error: walletSetResult.errorCode ?? "circle_provider_unavailable",
          detail: walletSetResult.responsePayload && typeof walletSetResult.responsePayload === "object"
            ? tenantActivationFailureDetail(walletSetResult.responsePayload as Record<string, unknown>)
            : undefined,
          walletSet: walletSetResult
        }
      };
    }
    effectiveWalletSetId = walletSetResult.walletSetId;
  }

  const existingIntegrationMetadata = existingIntegration?.metadata && typeof existingIntegration.metadata === "object"
    ? existingIntegration.metadata as Record<string, unknown>
    : {};
  const existingTenantWalletId = typeof existingIntegrationMetadata.tenantWalletId === "string"
    ? existingIntegrationMetadata.tenantWalletId
    : undefined;
  const existingTenantWalletAddress = typeof existingIntegrationMetadata.tenantWalletAddress === "string"
    ? existingIntegrationMetadata.tenantWalletAddress
    : undefined;
  const walletSetMatches = existingWalletSetId === effectiveWalletSetId;
  let tenantWalletId = existingTenantWalletId;
  let tenantWalletAddress = existingTenantWalletAddress;

  if (!walletSetMatches || !tenantWalletId) {
    const tenantWalletResult = await circleTreasury.initializeTenantWallet({
      tenantId,
      idempotencyKey: input.idempotencyKey!,
      walletSetId: effectiveWalletSetId,
      walletBlockchains
    });
    if (tenantWalletResult.status !== "complete") {
      await writeAuditAndOutbox("platform_tenant.circle_activation.failed", {
        tenantId,
        walletSetId: effectiveWalletSetId,
        errorCode: tenantWalletResult.errorCode,
        detail: tenantWalletResult.responsePayload && typeof tenantWalletResult.responsePayload === "object"
          ? tenantActivationFailureDetail(tenantWalletResult.responsePayload as Record<string, unknown>)
          : undefined
      });
      const failureStatus = tenantWalletResult.errorCode === "circle_api_key_required"
        || tenantWalletResult.errorCode === "circle_auth_failed"
        || tenantWalletResult.errorCode === "circle_validation_failed"
        || tenantWalletResult.errorCode === "circle_wallet_configuration_required"
        || tenantWalletResult.errorCode === "circle_fiat_mint_endpoint_not_configured"
        ? 400
        : 502;
      return {
        status: failureStatus,
        body: {
          error: tenantWalletResult.errorCode ?? "circle_provider_unavailable",
          detail: tenantWalletResult.responsePayload && typeof tenantWalletResult.responsePayload === "object"
            ? tenantActivationFailureDetail(tenantWalletResult.responsePayload as Record<string, unknown>)
            : undefined,
          walletSetId: effectiveWalletSetId,
          tenantWallet: tenantWalletResult
        }
      };
    }
    tenantWalletId = tenantWalletResult.providerWalletId
      ?? tenantWalletResult.providerAccountId
      ?? tenantWalletResult.providerRequestId;
    tenantWalletAddress = tenantWalletResult.providerAddressId;
  }

  const integrationMetadata = {
    ...existingIntegrationMetadata,
    tenantWalletId,
    tenantWalletAddress,
    responsePayload: {
      walletSetId: effectiveWalletSetId,
      walletSetName,
      walletBlockchains,
      tenantWallet: {
        walletId: tenantWalletId,
        address: tenantWalletAddress
      }
    }
  };

  await repo.upsertCircleIntegration(
    randomUUID(),
    tenantId,
    circleEnvironment(),
    effectiveWalletSetId,
    walletSetName,
    walletBlockchain!,
    "tenant_managed",
    "active",
    integrationMetadata
  );

  await writeAuditAndOutbox("platform_tenant.circle_wallet_set.activated", {
    walletSetId: effectiveWalletSetId,
    walletSetName,
    walletBlockchains,
    tenantWalletId,
    tenantWalletAddress
  });

  const pseudoClient = await repo.findTenantPseudoClient(tenantId);
  const pseudoClientId = pseudoClient?.id ?? randomUUID();
  if (!pseudoClient) {
    await repo.createTenantPseudoClient(
      pseudoClientId,
      tenantId,
      "Platform Internal Treasury Client",
      input.correlationId
    );
    await writeAuditAndOutbox("business_client.pseudo_internal.created", {
      businessClientId: pseudoClientId,
      legalName: "Platform Internal Treasury Client",
      onboardingStatus: "approved"
    });
  } else if (pseudoClient.onboardingStatus !== "approved") {
    await repo.approveTenantPseudoClient(tenantId, pseudoClientId);
    await writeAuditAndOutbox("business_client.pseudo_internal.normalized", {
      businessClientId: pseudoClientId,
      legalName: "Platform Internal Treasury Client",
      onboardingStatus: "approved"
    });
  }

  const centralAda = await repo.findTenantCentralAda(tenantId, "tenant_central");
  if (centralAda) {
    if (centralAda.businessClientId !== pseudoClientId) {
      await repo.relinkTenantAda(tenantId, centralAda.id, pseudoClientId);
      await writeAuditAndOutbox("account_of_digital_asset.tenant_central.linked", {
        accountOfDigitalAssetId: centralAda.id,
        businessClientId: pseudoClientId,
        usePurpose: "tenant_central",
        status: "active"
      });
    }
  } else {
    const accountId = randomUUID();
    await repo.createTenantAda(accountId, tenantId, pseudoClientId, "tenant_central", "Tenant ADA (central)", "active");
    await writeAuditAndOutbox("account_of_digital_asset.tenant_central.created", {
      accountOfDigitalAssetId: accountId,
      businessClientId: pseudoClientId,
      usePurpose: "tenant_central",
      status: "active"
    });
  }

  return {
    status: 200,
    body: {
      tenantId,
      walletSetId: effectiveWalletSetId,
      walletSetName,
      walletBlockchains,
      tenantWalletId,
      tenantWalletAddress,
      walletAccountType: circleWalletAccountType,
      walletStrategy: "tenant_managed",
      status: "active",
      activatedAt: new Date().toISOString()
    }
  };
};

// Helper functions
const optionalStringBody = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const stringArrayBody = (body: Record<string, unknown>, key: string, fallback: string[]): string[] => {
  const value = body[key];
  if (!Array.isArray(value)) return fallback;
  const filtered = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return filtered.length ? filtered : fallback;
};

const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const tenantActivationFailureDetail = (payload: Record<string, unknown>): string | undefined => {
  const detail = payload.detail;
  if (typeof detail === "string" && detail.trim().length > 0) return detail;
  const message = payload.message;
  if (typeof message === "string" && message.trim().length > 0) return message;
  const error = payload.error;
  if (error && typeof error === "object") {
    const errorPayload = error as Record<string, unknown>;
    const errorMessage = errorPayload.message;
    if (typeof errorMessage === "string" && errorMessage.trim().length > 0) return errorMessage;
  }
  return undefined;
};
