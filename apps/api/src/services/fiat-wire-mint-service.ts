import { randomUUID } from "node:crypto";
import type { FiatWireMintRepository } from "../db/repositories/fiat-wire-mint-repository.js";
import type { PostgresRouteInput } from "../db/postgres-route-types.js";
import type { CircleTreasuryService } from "./circle-treasury-service.js";
import type { ProvisionCircleAccountResult } from "./ada-circle-provision-service.js";

export const mintFromFiatWireAccountService = async (
  repository: FiatWireMintRepository,
  circleTreasury: CircleTreasuryService,
  provisionCircleAccount: (accountId: string) => Promise<ProvisionCircleAccountResult>,
  writeAuditAndOutbox: (eventType: string, payload: Record<string, unknown>) => Promise<void>,
  getAccount: (accountId: string) => Promise<unknown | undefined>,
  getCircleOperation: (operationId: string) => Promise<unknown | undefined>,
  tenantId: string,
  input: PostgresRouteInput,
  wireAccountId: string,
  circleEnvironment: () => string
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const wireAccount = await repository.findWireAccount(tenantId, wireAccountId);
  if (!wireAccount) return { status: 404, body: { error: "wire_account_not_found" } };
  if (wireAccount.status !== "active") return { status: 400, body: { error: "wire_account_not_active" } };
  const sourceAccountOfDigitalAssetId = optionalString(wireAccount.accountOfDigitalAssetId) ?? wireAccountId;

  const targetAccountOfDigitalAssetId = stringBody(input.body, "targetAccountOfDigitalAssetId", "ada_platform_treasury");
  const amountMinorUnits = asBigInt(stringBody(input.body, "amountMinorUnits", "0"));
  if (amountMinorUnits <= 0n) return { status: 400, body: { error: "mint_amount_must_be_positive" } };

  const targetAccount = await getAccount(targetAccountOfDigitalAssetId);
  if (!targetAccount) return { status: 404, body: { error: "account_not_found" } };
  const targetAccountRecord = targetAccount as Record<string, unknown>;
  const targetBusinessClientId = optionalString(targetAccountRecord.businessClientId);
  if (!targetBusinessClientId) return { status: 400, body: { error: "account_business_client_missing" } };

  let linkedWallet = await repository.findLatestVerifiedCircleWalletLinkedInstrument(tenantId, targetAccountOfDigitalAssetId);
  if (!linkedWallet) {
    const shouldAutoProvision = targetAccountRecord.usePurpose === "tenant_central"
      || targetAccountRecord.status === "pending_activation";
    if (shouldAutoProvision) {
      const provisioned = await provisionCircleAccount(targetAccountOfDigitalAssetId);
      if (provisioned.status >= 400) return provisioned;
      linkedWallet = await repository.findLatestVerifiedCircleWalletLinkedInstrument(tenantId, targetAccountOfDigitalAssetId);
    }
  }
  if (!linkedWallet) return { status: 400, body: { error: "account_circle_wallet_not_linked" } };

  const destinationWalletId = metadataString(linkedWallet, "walletId");
  if (!destinationWalletId) return { status: 400, body: { error: "account_circle_wallet_reference_missing" } };
  const destinationWalletAddress = metadataString(linkedWallet, "address");
  if (!destinationWalletAddress) return { status: 400, body: { error: "account_circle_wallet_address_missing" } };

  const sourceWire = await repository.findDefaultFiatWireLinkedInstrument(tenantId, sourceAccountOfDigitalAssetId)
    ?? wireAccount;
  const sourceFiatWireLinkedInstrumentId = String(sourceWire.id);
  const sourceMetadata = recordMetadata(sourceWire);
  let trackingRef = optionalString(sourceMetadata.trackingRef) ?? optionalString(sourceMetadata.wireTrackingRef);
  let beneficiaryBankAccountNumber = optionalString(sourceMetadata.beneficiaryBankAccountNumber);
  let wireInstructions = objectValue(sourceMetadata.wireInstructions);
  const businessWireAccountId = optionalString(sourceMetadata.businessWireAccountId)
    ?? optionalString(sourceMetadata.wireAccountId);

  const hydrateWireInstructions = (): Record<string, unknown> | undefined => {
    const hydrated = wireInstructions ? { ...wireInstructions } : {};
    if (!optionalString(hydrated.trackingRef) && trackingRef) hydrated.trackingRef = trackingRef;
    const beneficiaryBank = objectValue(hydrated.beneficiaryBank) ?? {};
    if (!optionalString(beneficiaryBank.accountNumber) && beneficiaryBankAccountNumber) {
      beneficiaryBank.accountNumber = beneficiaryBankAccountNumber;
    }
    if (Object.keys(beneficiaryBank).length) hydrated.beneficiaryBank = beneficiaryBank;
    return Object.keys(hydrated).length ? hydrated : undefined;
  };
  wireInstructions = hydrateWireInstructions();

  const fundingInstructionId = optionalString(input.body.fundingInstructionId);
  if (fundingInstructionId) {
    const instruction = await repository.findFundingInstruction(tenantId, fundingInstructionId);
    if (!instruction) return { status: 404, body: { error: "funding_instruction_not_found" } };
    if (instruction.instructionRole !== "internal_treasury_mint") {
      return { status: 400, body: { error: "funding_instruction_mint_role_required" } };
    }
    await repository.updateFundingInstructionStatus(tenantId, fundingInstructionId, "pending_provider");
    await repository.updateFundingInstructionOrders(tenantId, fundingInstructionId, "pending_provider");
  }

  if (circleEnvironment() === "circle-sandbox" && businessWireAccountId) {
    const runtime = await circleTreasury.retrieveSandboxWireInstructions({
      tenantId,
      wireAccountId: businessWireAccountId,
      linkedWireAccount: { trackingRef, beneficiaryBankAccountNumber, wireInstructions }
    });
    if (runtime.status === "complete") {
      trackingRef = optionalString(runtime.responsePayload.trackingRef) ?? trackingRef;
      beneficiaryBankAccountNumber = optionalString(runtime.responsePayload.beneficiaryBankAccountNumber)
        ?? beneficiaryBankAccountNumber;
      wireInstructions = objectValue(runtime.responsePayload.wireInstructions) ?? wireInstructions;
      wireInstructions = hydrateWireInstructions();
      await repository.updateLinkedInstrumentMetadata(tenantId, sourceFiatWireLinkedInstrumentId, {
        businessWireAccountId,
        ...(trackingRef ? { trackingRef, wireTrackingRef: trackingRef } : {}),
        ...(beneficiaryBankAccountNumber ? { beneficiaryBankAccountNumber } : {}),
        ...(wireInstructions ? { wireInstructions } : {})
      });
    }
  }

  const providerMint = await circleTreasury.mintFiatToWallet({
    tenantId,
    accountOfDigitalAssetId: targetAccountOfDigitalAssetId,
    businessClientId: targetBusinessClientId,
    walletId: destinationWalletId,
    walletAddress: destinationWalletAddress,
    amountMinorUnits: amountMinorUnits.toString(),
    assetCode: "USDC",
    currency: "USD",
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    payload: {
      wireAccountId: sourceFiatWireLinkedInstrumentId,
      ...(businessWireAccountId ? { businessWireAccountId } : {}),
      linkedInstrumentId: String(linkedWallet.id),
      sourceAccountOfDigitalAssetId,
      sourceFiatWireLinkedInstrumentId,
      ...(wireInstructions ? { wireInstructions } : {})
    }
  });

  const operationId = randomUUID();
  await repository.insertMintCircleOperation(
    operationId,
    tenantId,
    targetAccountOfDigitalAssetId,
    targetBusinessClientId,
    String(linkedWallet.id),
    input.idempotencyKey ?? "",
    input.correlationId,
    {
      wireAccountId: sourceFiatWireLinkedInstrumentId,
      sourceAccountOfDigitalAssetId,
      sourceFiatWireLinkedInstrumentId,
      accountOfDigitalAssetId: targetAccountOfDigitalAssetId,
      linkedInstrumentId: linkedWallet.id,
      destinationWalletId,
      destinationWalletAddress,
      amountMinorUnits: amountMinorUnits.toString(),
      assetCode: "USDC",
      currency: "USD"
    },
    {
      providerWalletId: providerMint.providerWalletId,
      providerAddressId: providerMint.providerAddressId,
      providerRequestId: providerMint.providerRequestId,
      status: providerMint.status,
      errorCode: providerMint.errorCode,
      provider: providerMint.responsePayload
    },
    providerMint.providerWalletId ?? destinationWalletId,
    providerMint.providerAddressId,
    providerMint.status === "complete" ? "succeeded" : "failed",
    providerMint.errorCode
  );

  if (providerMint.status !== "complete") {
    if (fundingInstructionId) {
      await repository.updateFundingInstructionStatus(tenantId, fundingInstructionId, "failed");
      await repository.updateFundingInstructionOrders(tenantId, fundingInstructionId, "failed");
    }
    await writeAuditAndOutbox("fiat.mint.failed", {
      wireAccountId,
      targetAccountOfDigitalAssetId,
      amountMinorUnits: amountMinorUnits.toString(),
      destinationWalletId,
      circleOperationId: operationId,
      errorCode: providerMint.errorCode
    });
    const status = providerMint.errorCode === "circle_api_key_required"
      || providerMint.errorCode === "circle_wallet_configuration_required"
      || providerMint.errorCode === "circle_auth_failed"
      || providerMint.errorCode === "circle_validation_failed"
      || providerMint.errorCode === "circle_fiat_mint_endpoint_not_configured" ? 400 : 502;
    return {
      status,
      body: {
        error: providerMint.errorCode ?? "circle_provider_unavailable",
        detail: optionalString(providerMint.responsePayload.detail),
        destinationWalletId,
        circleOperation: await getCircleOperation(operationId)
      }
    };
  }

  if (fundingInstructionId) {
    await repository.updateFundingInstructionStatus(tenantId, fundingInstructionId, "pending_confirmation");
  }

  const mint = {
    id: randomUUID(),
    wireAccountId,
    targetAccountOfDigitalAssetId,
    amountMinorUnits: amountMinorUnits.toString(),
    status: "pending_confirmation",
    providerMintId: providerMint.providerRequestId ?? providerMint.providerWalletId,
    providerWalletId: providerMint.providerWalletId ?? destinationWalletId,
    destinationWalletAddress,
    destinationWalletId,
    circleOperationId: operationId,
    createdAt: new Date().toISOString()
  };
  await writeAuditAndOutbox("fiat.mint.requested", mint);
  return { status: 201, body: { mint } };
};

const stringBody = (body: Record<string, unknown>, key: string, fallback = ""): string => {
  const value = body[key];
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "bigint" ? String(value) : fallback;
};

const asBigInt = (value: unknown): bigint => {
  try { return BigInt(String(value ?? 0)); } catch { return 0n; }
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const recordMetadata = (row: Record<string, unknown>): Record<string, unknown> => objectValue(row.metadata) ?? {};

const metadataString = (row: Record<string, unknown>, key: string): string | undefined =>
  optionalString(recordMetadata(row)[key]);
