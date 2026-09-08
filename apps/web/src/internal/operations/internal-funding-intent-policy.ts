export type ExternalizationIntent = "none" | "wallet" | "fiat";

export type IntentPolicyEvaluation = {
  externalizationChecksPass: boolean;
  railValidationBlockReason: string;
};

export type CreateInstructionRequestInput = {
  sourceAccountOfDigitalAssetId: string;
  destinationAccountOfDigitalAssetId: string;
  externalizationIntent: ExternalizationIntent;
  amountMinorUnits: string;
  routePreference: string;
  purpose: string;
};

export const evaluateExternalizationIntentPolicy = (
  intent: ExternalizationIntent,
  destinationHasCircleWallet: boolean,
  destinationHasFiatRoute: boolean
): IntentPolicyEvaluation => {
  if (intent === "wallet") {
    return {
      externalizationChecksPass: destinationHasCircleWallet,
      railValidationBlockReason: destinationHasCircleWallet
        ? ""
        : "Wallet externalization requires a verified Circle wallet route on destination ADA."
    };
  }

  if (intent === "fiat") {
    return {
      externalizationChecksPass: destinationHasFiatRoute,
      railValidationBlockReason: destinationHasFiatRoute
        ? ""
        : "Fiat externalization requires an active or verified fiat route on destination ADA."
    };
  }

  return {
    externalizationChecksPass: true,
    railValidationBlockReason: ""
  };
};

export const buildInternalTreasuryInstructionCreateRequest = (
  input: CreateInstructionRequestInput
): Record<string, string> => ({
  sourceAccountOfDigitalAssetId: input.sourceAccountOfDigitalAssetId,
  destinationAccountOfDigitalAssetId: input.destinationAccountOfDigitalAssetId,
  instructionType: "internal_ada_settlement",
  externalizationIntent: input.externalizationIntent,
  amountMinorUnits: input.amountMinorUnits,
  currency: "USD",
  routePreference: input.routePreference,
  purpose: input.purpose
});