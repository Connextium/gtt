import { asRecord, asString, maskSensitiveNumber } from "./value-utils.js";

export const maskedApiKeyPrefix = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const prefix = value.slice(0, 4);
  return `${prefix}***`;
};

export const redactWireAccountPayloadForLog = (payload: Record<string, unknown>): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...payload };
  copy.accountNumber = maskSensitiveNumber(asString(payload.accountNumber));
  copy.routingNumber = maskSensitiveNumber(asString(payload.routingNumber));
  return copy;
};

export const redactMintPayloadForLog = (payload: Record<string, unknown>): Record<string, unknown> => {
  const copy: Record<string, unknown> = { ...payload };
  const beneficiaryBank = asRecord(copy.beneficiaryBank);
  if (beneficiaryBank) {
    copy.beneficiaryBank = {
      ...beneficiaryBank,
      accountNumber: maskSensitiveNumber(asString(beneficiaryBank.accountNumber))
    };
  }

  const wireInstructions = asRecord(copy.wireInstructions);
  if (wireInstructions) {
    const instructionsBeneficiaryBank = asRecord(wireInstructions.beneficiaryBank);
    copy.wireInstructions = {
      ...wireInstructions,
      ...(instructionsBeneficiaryBank
        ? {
          beneficiaryBank: {
            ...instructionsBeneficiaryBank,
            accountNumber: maskSensitiveNumber(asString(instructionsBeneficiaryBank.accountNumber))
          }
        }
        : {})
    };
  }

  return copy;
};
