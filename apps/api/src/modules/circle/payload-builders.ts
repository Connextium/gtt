import { randomUUID } from "node:crypto";
import type {
  CircleEnvironment,
  CircleFiatMintToWalletRequest,
  CircleSandboxWireProvisioningRequest
} from "./types.js";
import { asRecord, asString } from "./value-utils.js";

export class CirclePayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CirclePayloadValidationError";
  }
}

export const defaultFiatMintEndpoint = (environment: Exclude<CircleEnvironment, "simulator">): string =>
  environment === "circle-sandbox" ? "/v1/mocks/payments/wire" : "/v1/businessAccount/transfers";

export const buildSandboxWireMockPayload = (request: CircleFiatMintToWalletRequest): Record<string, unknown> => {
  const requestPayload = asRecord(request.payload);
  const {
    trackingRef: _requestTrackingRef,
    wireTrackingRef: _legacyWireTrackingRef,
    providerTrackingRef: _legacyProviderTrackingRef,
    beneficiaryBank: _requestBeneficiaryBank,
    beneficiaryAccountNumber: _requestBeneficiaryAccountNumber,
    beneficiaryBankAccountNumber: _requestBeneficiaryBankAccountNumber,
    ...canonicalRequestPayload
  } = requestPayload ?? {};
  const wireInstructions = asRecord(requestPayload?.wireInstructions);
  const beneficiaryBankFromInstructions = asRecord(wireInstructions?.beneficiaryBank);
  const trackingRef = asString(wireInstructions?.trackingRef)
    ?? asString(wireInstructions?.paymentTrackingRef)
    ?? asString(wireInstructions?.trackingReference);
  const beneficiaryAccountNumber = asString(beneficiaryBankFromInstructions?.accountNumber);

  if (!trackingRef) {
    throw new CirclePayloadValidationError("trackingRef is required for /v1/mocks/payments/wire and must come from the linked wire account");
  }
  if (!beneficiaryAccountNumber) {
    throw new CirclePayloadValidationError("beneficiaryBank.accountNumber is required for /v1/mocks/payments/wire and must come from the linked wire account");
  }
  const currency = request.currency ?? "USD";

  return {
    ...canonicalRequestPayload,
    idempotencyKey: request.idempotencyKey ?? randomUUID(),
    amount: {
      amount: usdAmountFromMinorUnits(request.amountMinorUnits),
      currency
    },
    trackingRef,
    beneficiaryBank: {
      ...(beneficiaryBankFromInstructions ?? {}),
      accountNumber: beneficiaryAccountNumber
    }
  };
};

export const buildSandboxWireAccountPayload = (request: CircleSandboxWireProvisioningRequest): Record<string, unknown> => {
  const requestPayload = asRecord(request.payload);
  const wireAccount = asRecord(requestPayload?.wireAccount) ?? requestPayload;
  const billingDetails = asRecord(wireAccount?.billingDetails);
  const bankAddress = asRecord(wireAccount?.bankAddress);

  const requiredWireField = (value: unknown, fieldPath: string): string => {
    const normalized = typeof value === "string" ? value.trim() : undefined;
    if (!normalized) {
      throw new CirclePayloadValidationError(`${fieldPath} is required for /v1/businessAccount/banks/wires`);
    }
    return normalized;
  };

  const accountNumber = requiredWireField(wireAccount?.accountNumber, "wireAccount.accountNumber");
  const routingNumber = requiredWireField(wireAccount?.routingNumber, "wireAccount.routingNumber");
  const billingName = requiredWireField(billingDetails?.name, "wireAccount.billingDetails.name");
  const billingCity = requiredWireField(billingDetails?.city, "wireAccount.billingDetails.city");
  const billingCountry = requiredWireField(billingDetails?.country, "wireAccount.billingDetails.country");
  const billingLine1 = requiredWireField(billingDetails?.line1, "wireAccount.billingDetails.line1");
  const billingDistrict = requiredWireField(billingDetails?.district, "wireAccount.billingDetails.district");
  const billingPostalCode = requiredWireField(billingDetails?.postalCode, "wireAccount.billingDetails.postalCode");
  const bankName = requiredWireField(bankAddress?.bankName, "wireAccount.bankAddress.bankName");
  const bankCity = requiredWireField(bankAddress?.city, "wireAccount.bankAddress.city");
  const bankCountry = requiredWireField(bankAddress?.country, "wireAccount.bankAddress.country");
  const bankLine1 = requiredWireField(bankAddress?.line1, "wireAccount.bankAddress.line1");
  const bankDistrict = requiredWireField(bankAddress?.district, "wireAccount.bankAddress.district");

  return {
    idempotencyKey: request.idempotencyKey ?? randomUUID(),
    accountNumber,
    routingNumber,
    billingDetails: {
      name: billingName,
      city: billingCity,
      country: billingCountry,
      line1: billingLine1,
      district: billingDistrict,
      postalCode: billingPostalCode
    },
    bankAddress: {
      bankName,
      city: bankCity,
      country: bankCountry,
      line1: bankLine1,
      district: bankDistrict
    }
  };
};

export const buildBusinessAccountTransferPayload = (
  request: CircleFiatMintToWalletRequest,
  environment: Exclude<CircleEnvironment, "simulator">
): Record<string, unknown> => {
  const requestPayload = asRecord(request.payload);
  const configuredDestination = asRecord(requestPayload?.destination);
  const destinationAddressId = asString(requestPayload?.destinationAddressId) ?? asString(requestPayload?.addressId);
  const chain = asString(requestPayload?.chain) ?? defaultBusinessTransferChain(environment);
  const destination = configuredDestination
    ?? (destinationAddressId
      ? { type: "verified_blockchain", addressId: destinationAddressId }
      : request.walletAddress
        ? { type: "blockchain", address: request.walletAddress, chain }
        : { type: "wallet", id: request.walletId });
  const currency = request.currency ?? "USD";

  return {
    ...requestPayload,
    idempotencyKey: request.idempotencyKey ?? randomUUID(),
    source: {
      type: "wallet",
      id: request.walletId
    },
    destination,
    amount: {
      currency,
      amount: usdAmountFromMinorUnits(request.amountMinorUnits)
    },
    accountOfDigitalAssetId: request.accountOfDigitalAssetId,
    businessClientId: request.businessClientId,
    correlationId: request.correlationId,
    destinationWalletAddress: request.walletAddress
  };
};

const defaultBusinessTransferChain = (environment: Exclude<CircleEnvironment, "simulator">): string =>
  environment === "circle-sandbox" ? "ARC-TESTNET" : "ARC";

const usdAmountFromMinorUnits = (amountMinorUnits: string): string => {
  try {
    const sign = amountMinorUnits.startsWith("-") ? "-" : "";
    const absolute = BigInt(sign ? amountMinorUnits.slice(1) : amountMinorUnits);
    const whole = absolute / 1_000_000n;
    const cents = (absolute % 1_000_000n) / 10_000n;
    return `${sign}${whole.toString()}.${cents.toString().padStart(2, "0")}`;
  } catch {
    return "0.00";
  }
};
