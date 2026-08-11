import { randomUUID } from "node:crypto";
import type { AdaCircleProvisionRepository } from "../db/repositories/ada-circle-provision-repository.js";
import type { CircleTreasuryService } from "./circle-treasury-service.js";
import type { PostgresRouteInput } from "../db/postgres-route-types.js";

export interface ProvisionCircleAccountResult {
  status: number;
  body: Record<string, unknown>;
}

export const provisionCircleAccountService = async (
  repo: AdaCircleProvisionRepository,
  circleTreasury: CircleTreasuryService,
  writeAuditAndOutbox: (eventType: string, payload: Record<string, unknown>) => Promise<void>,
  getAccount: (accountId: string) => Promise<unknown | undefined>,
  getCircleOperation: (operationId: string) => Promise<unknown | undefined>,
  tenantId: string,
  input: PostgresRouteInput,
  accountId: string,
  circleEnvironment: () => string,
  circleWalletBlockchainsFromEnv: () => string[],
  circleWalletAccountType: string
): Promise<ProvisionCircleAccountResult> => {
  const account = await repo.findAccountWithClient(tenantId, accountId);
  if (!account) return { status: 404, body: { error: "account_not_found" } };
  if (account.onboardingStatus !== "approved") return { status: 400, body: { error: "business_client_not_approved" } };
  if (["restricted", "frozen", "closed"].includes(account.status)) {
    return { status: 400, body: { error: "account_status_blocks_circle_provisioning" } };
  }

  const requestWalletSetId = optionalStringBody(input.body, "walletSetId");
  const businessClientWalletSetId = account.circleWalletSetId;
  const requestedWalletBlockchains = stringArrayBody(input.body, "walletBlockchains", circleWalletBlockchainsFromEnv());
  const requestedWalletBlockchain = requestedWalletBlockchains[0];
  const expectedExistingWalletSetId = requestWalletSetId ?? businessClientWalletSetId;

  const existingRow = await repo.findExistingCircleWallet(tenantId, accountId, expectedExistingWalletSetId);
  if (existingRow && expectedExistingWalletSetId) {
    const existingInstrumentWalletSetId = walletSetIdFromLinkedInstrument(existingRow);
    const existingInstrumentMatchesWalletSet = existingInstrumentWalletSetId === expectedExistingWalletSetId;
    if (existingInstrumentMatchesWalletSet) {
      const circleOp = await getCircleOperation(String(existingRow.id));
      return {
        status: 200,
        body: {
          account: await getAccount(accountId),
          linkedInstrument: mapLinkedInstrumentRow(existingRow),
          circleOperation: circleOp,
          reusedExistingMapping: true
        }
      };
    }
  }

  const successfulRow = await repo.findSuccessfulMappingOperation(tenantId, accountId, expectedExistingWalletSetId);
  if (successfulRow && expectedExistingWalletSetId) {
    const successfulWalletSetId = typeof successfulRow.provider_account_id === "string" ? successfulRow.provider_account_id : undefined;
    const successfulRowMatchesWalletSet = successfulWalletSetId === expectedExistingWalletSetId;
    if (successfulRowMatchesWalletSet) {
      const providerWalletId = typeof successfulRow.provider_wallet_id === "string" && successfulRow.provider_wallet_id.trim()
        ? successfulRow.provider_wallet_id
        : undefined;
      const providerAddressId = typeof successfulRow.provider_address_id === "string" && successfulRow.provider_address_id.trim()
        ? successfulRow.provider_address_id
        : undefined;

      if (providerWalletId) {
        const recoveredWalletSetId = businessClientWalletSetId
          ?? (typeof successfulRow.provider_account_id === "string" ? successfulRow.provider_account_id : undefined);
        const linkedInstrumentId = randomUUID();
        const recoveredInstrumentRow = await repo.insertLinkedInstrument(
          linkedInstrumentId,
          accountId,
          tenantId,
          providerWalletId,
          account.usePurpose,
          {
            walletSetId: recoveredWalletSetId,
            walletId: providerWalletId,
            address: providerAddressId,
            blockchain: requestedWalletBlockchain,
            recoveredExistingWallet: true,
            recoveredFromCircleOperationId: successfulRow.id
          },
          requestedWalletBlockchain!
        );
        await repo.updateLinkedInstrumentCircleOperationId(String(successfulRow.id), linkedInstrumentId);
        await writeAuditAndOutbox("account_of_digital_asset.circle_mapping.recovered", {
          accountOfDigitalAssetId: accountId,
          businessClientId: account.businessClientId,
          circleOperationId: successfulRow.id,
          providerWalletId,
          providerAddressId,
          linkedInstrumentId
        });
        return {
          status: 200,
          body: {
            account: await getAccount(accountId),
            linkedInstrument: mapLinkedInstrumentRow(recoveredInstrumentRow),
            circleOperation: mapCircleOperationRow(successfulRow),
            reusedExistingMapping: true
          }
        };
      }

      return {
        status: 200,
        body: {
          account: await getAccount(accountId),
          circleOperation: mapCircleOperationRow(successfulRow),
          reusedExistingMapping: true
        }
      };
    }
  }

  const replayed = await repo.findReplayedOperation(tenantId, accountId, input.idempotencyKey!);
  if (replayed) {
    return {
      status: 200,
      body: {
        account: await getAccount(accountId),
        circleOperation: mapCircleOperationRow(replayed)
      }
    };
  }

  let effectiveWalletSetId = requestWalletSetId ?? businessClientWalletSetId;
  if (!effectiveWalletSetId) {
    const walletSetName = `${account.legalName ?? "Business Client"} Wallet Set`;
    const walletSet = await circleTreasury.initializeWalletSet({
      idempotencyKey: input.idempotencyKey!,
      walletSetName,
      walletBlockchains: requestedWalletBlockchains
    });
    if (walletSet.status !== "complete" || !walletSet.walletSetId) {
      const operationId = randomUUID();
      const responsePayload = {
        walletSet,
        authDebug: walletSet.responsePayload.authDebug,
        provider: walletSet.responsePayload
      };
      await repo.insertCircleOperation(
        operationId,
        tenantId,
        accountId,
        account.businessClientId,
        input.idempotencyKey!,
        input.correlationId!,
        { accountOfDigitalAssetId: accountId, provider: "circle", walletSetName, walletBlockchains: requestedWalletBlockchains },
        responsePayload,
        undefined,
        undefined,
        undefined,
        "failed",
        walletSet.errorCode
      );
      await writeAuditAndOutbox("account_of_digital_asset.circle_mapping.failed", {
        accountOfDigitalAssetId: accountId,
        businessClientId: account.businessClientId,
        circleOperationId: operationId,
        errorCode: walletSet.errorCode
      });
      const status = walletSet.errorCode === "circle_api_key_required"
        || walletSet.errorCode === "circle_wallet_configuration_required"
        || walletSet.errorCode === "circle_fiat_mint_endpoint_not_configured"
        ? 400
        : 502;
      return {
        status,
        body: {
          error: walletSet.errorCode ?? "circle_provider_unavailable",
          detail: tenantActivationFailureDetail(walletSet.responsePayload),
          authDebug: walletSet.responsePayload.authDebug,
          walletSet,
          circleOperation: await getCircleOperation(operationId)
        }
      };
    }
    effectiveWalletSetId = walletSet.walletSetId;
    await repo.updateBusinessClientWalletSetId(tenantId, account.businessClientId, effectiveWalletSetId);
    await writeAuditAndOutbox("business_client.circle_wallet_set.provisioned", {
      businessClientId: account.businessClientId,
      walletSetId: effectiveWalletSetId,
      walletSetName,
      walletBlockchains: requestedWalletBlockchains
    });
  }

  if (!effectiveWalletSetId) {
    return { status: 502, body: { error: "circle_wallet_configuration_required", detail: "walletSetId missing after business client wallet set provisioning" } };
  }

  const mappingPayload = { ...input.body };
  delete mappingPayload.wireAccount;
  delete mappingPayload.wireFunding;

  const provider = await circleTreasury.provisionAdaMapping({
    tenantId,
    accountOfDigitalAssetId: accountId,
    businessClientId: account.businessClientId,
    idempotencyKey: input.idempotencyKey!,
    correlationId: input.correlationId!,
    walletSetId: effectiveWalletSetId,
    walletBlockchains: requestedWalletBlockchains,
    payload: mappingPayload
  });

  const needsSandboxWireSetup = circleEnvironment() === "circle-sandbox";
  const sandboxWireSetup = provider.status === "complete" && needsSandboxWireSetup
    ? await circleTreasury.provisionSandboxWire({
        tenantId,
        accountOfDigitalAssetId: accountId,
        businessClientId: account.businessClientId,
        idempotencyKey: input.idempotencyKey!,
        payload: input.body
      })
    : undefined;

  const provisioningStatus = provider.status === "complete" && (sandboxWireSetup?.status ?? "complete") === "complete"
    ? "complete"
    : "failed";
  const provisioningErrorCode = provider.status === "complete"
    ? sandboxWireSetup?.errorCode
    : provider.errorCode;
  const failedProviderPayload = provider.status === "complete"
    ? sandboxWireSetup?.responsePayload
    : provider.responsePayload;

  const providerAccountId = provider.providerAccountId ?? provider.providerWalletId ?? provider.providerRequestId;
  const providerWalletId = provider.providerWalletId ?? provider.providerAccountId ?? provider.providerRequestId;
  const providerAddressId = provider.providerAddressId;
  const operationId = randomUUID();
  const failedAuthDebug = failedProviderPayload && typeof failedProviderPayload === "object"
    ? (failedProviderPayload as Record<string, unknown>).authDebug
    : undefined;
  const responsePayload = {
    providerAccountId,
    providerWalletId,
    providerAddressId,
    providerRequestId: provider.providerRequestId,
    status: provisioningStatus,
    errorCode: provisioningErrorCode,
    authDebug: failedAuthDebug,
    provider: provider.responsePayload,
    wireSetup: sandboxWireSetup?.responsePayload
  };
  await repo.insertCircleOperation(
    operationId,
    tenantId,
    accountId,
    account.businessClientId,
    input.idempotencyKey!,
    input.correlationId!,
    { accountOfDigitalAssetId: accountId, provider: "circle", walletSetId: effectiveWalletSetId, walletBlockchains: requestedWalletBlockchains },
    responsePayload,
    providerAccountId,
    providerWalletId,
    providerAddressId,
    provisioningStatus === "complete" ? "succeeded" : "failed",
    provisioningErrorCode
  );
  
  if (provisioningStatus !== "complete") {
    await writeAuditAndOutbox("account_of_digital_asset.circle_mapping.failed", {
      accountOfDigitalAssetId: accountId,
      businessClientId: account.businessClientId,
      circleOperationId: operationId,
      errorCode: provisioningErrorCode
    });
    const status = provisioningErrorCode === "circle_api_key_required"
      || provisioningErrorCode === "circle_wallet_configuration_required"
      || provisioningErrorCode === "circle_auth_failed"
      || provisioningErrorCode === "circle_validation_failed"
      || provisioningErrorCode === "circle_fiat_mint_endpoint_not_configured"
      ? 400
      : 502;
    return {
      status,
      body: {
        error: provisioningErrorCode ?? "circle_provider_unavailable",
        detail: failedProviderPayload ? tenantActivationFailureDetail(failedProviderPayload as Record<string, unknown>) : undefined,
        authDebug: failedAuthDebug,
        circleOperation: await getCircleOperation(operationId)
      }
    };
  }

  const wireSetupPayload = sandboxWireSetup?.responsePayload && typeof sandboxWireSetup.responsePayload === "object"
    ? sandboxWireSetup.responsePayload as Record<string, unknown>
    : undefined;
  const wireTrackingRef = typeof wireSetupPayload?.trackingRef === "string"
    ? wireSetupPayload.trackingRef
    : undefined;
  const wireBeneficiaryBankAccountNumber = typeof wireSetupPayload?.beneficiaryBankAccountNumber === "string"
    ? wireSetupPayload.beneficiaryBankAccountNumber
    : undefined;
  const providerWireAccountId = typeof wireSetupPayload?.wireAccountId === "string"
    ? wireSetupPayload.wireAccountId
    : undefined;
  const businessWireAccountId = typeof wireSetupPayload?.businessWireAccountId === "string"
    ? wireSetupPayload.businessWireAccountId
    : providerWireAccountId;
  const wireInstructions = wireSetupPayload?.wireInstructions && typeof wireSetupPayload.wireInstructions === "object"
    ? wireSetupPayload.wireInstructions
    : undefined;
  const linkedInstrumentMetadata = {
    walletSetId: effectiveWalletSetId,
    walletId: providerWalletId,
    address: providerAddressId,
    blockchain: requestedWalletBlockchain,
    providerRequestId: provider.providerRequestId,
    circleOperationId: operationId,
    ...(businessWireAccountId ? { businessWireAccountId } : {}),
    ...(wireTrackingRef ? { trackingRef: wireTrackingRef, wireTrackingRef } : {}),
    ...(wireBeneficiaryBankAccountNumber ? { beneficiaryBankAccountNumber: wireBeneficiaryBankAccountNumber } : {}),
    ...(wireInstructions ? { wireInstructions } : {})
  };
  const linkedInstrument = await repo.insertLinkedInstrument(
    randomUUID(),
    accountId,
    tenantId,
    providerWalletId!,
    account.usePurpose,
    linkedInstrumentMetadata,
    requestedWalletBlockchain!
  );
  await repo.updateLinkedInstrumentCircleOperationId(operationId, String(linkedInstrument.id));
  await writeAuditAndOutbox("account_of_digital_asset.circle_mapping.provisioned", {
    accountOfDigitalAssetId: accountId,
    businessClientId: account.businessClientId,
    circleOperationId: operationId,
    providerAccountId,
    providerWalletId,
    providerAddressId,
    linkedInstrumentId: linkedInstrument.id
  });
  const circleOperation = await getCircleOperation(operationId);
  return {
    status: 200,
    body: {
      account: await getAccount(accountId),
      linkedInstrument: mapLinkedInstrumentRow(linkedInstrument),
      circleOperation
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

const mapLinkedInstrumentRow = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  accountId: row.account_of_digital_asset_id,
  instrumentType: row.instrument_type,
  status: row.status,
  assetCode: row.asset_code ?? undefined,
  railType: row.rail_type ?? undefined,
  purpose: row.purpose ?? undefined,
  provider: row.provider ?? undefined,
  verificationStatus: row.verification_status ?? undefined,
  networkCode: row.network_code ?? undefined,
  isDefault: row.is_default === true,
  metadata: row.metadata ?? {},
  createdAt: toIsoString(row.created_at)
});

const mapCircleOperationRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  operationType: row.operation_type,
  idempotencyKey: row.idempotency_key ?? undefined,
  correlationId: row.correlation_id ?? undefined,
  requestPayload: row.request_payload ?? {},
  responsePayload: row.response_payload ?? {},
  providerRequestId:
    (typeof row.response_payload === "object" && row.response_payload !== null
      ? ((row.response_payload as Record<string, unknown>).providerRequestId as string | undefined)
      : undefined),
  providerAccountId: row.provider_account_id ?? undefined,
  providerWalletId: row.provider_wallet_id ?? undefined,
  providerAddressId: row.provider_address_id ?? undefined,
  status: row.status,
  errorCode: row.error_code ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const walletSetIdFromLinkedInstrument = (row: Record<string, unknown>): string | undefined => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : undefined;
  const walletSetId = metadata?.walletSetId;
  return typeof walletSetId === "string" && walletSetId.trim().length > 0 ? walletSetId : undefined;
};

const toIsoString = (value: unknown): string | undefined => {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
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
