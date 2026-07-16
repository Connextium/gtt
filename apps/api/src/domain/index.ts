export type UsdcMinorUnitAmount = bigint;

export type DomainModuleName =
  | "client-onboarding"
  | "digital-accounts"
  | "ledger"
  | "balance"
  | "settlement-obligation"
  | "funding-reservation"
  | "payment-execution"
  | "api-auth"
  | "circle-integration"
  | "events"
  | "liquidity-rebalancing"
  | "reconciliation"
  | "reporting"
  | "hardening-release";

export interface AccountOfDigitalAssetRef {
  id: string;
  businessClientId: string;
  assetCode: "USDC";
  status: "active" | "restricted" | "closed";
}

export interface ClassifiedBalanceView {
  accountOfDigitalAssetId: string;
  availableMinorUnits: UsdcMinorUnitAmount;
  pendingMinorUnits: UsdcMinorUnitAmount;
  reservedMinorUnits: UsdcMinorUnitAmount;
  lockedMinorUnits: UsdcMinorUnitAmount;
  suspenseMinorUnits: UsdcMinorUnitAmount;
}

export interface RebalanceRecommendationInput {
  sourceAccountOfDigitalAssetId: string;
  destinationAccountOfDigitalAssetId: string;
  sourceDeployableMinorUnits: UsdcMinorUnitAmount;
  destinationAvailableMinorUnits: UsdcMinorUnitAmount;
  destinationTargetMinorUnits: UsdcMinorUnitAmount;
  approvalThresholdMinorUnits: UsdcMinorUnitAmount;
}

export interface RebalanceRecommendationView {
  sourceAccountOfDigitalAssetId: string;
  destinationAccountOfDigitalAssetId: string;
  amountMinorUnits: UsdcMinorUnitAmount;
  approvalRequired: boolean;
  routeExplanation: string;
}

export interface PilotReadinessInput {
  allCriticalPathScenariosPass: boolean;
  noCriticalOrHighDefects: boolean;
  financialInvariantsPass: boolean;
  securityReviewClean: boolean;
  backupRestoreDemonstrated: boolean;
  reconciliationClean: boolean;
  uatSignedOff: boolean;
  runbooksApproved: boolean;
  knownGapsDocumented: boolean;
  circleEvidenceRetained: boolean;
}

export interface PilotReadinessDecision {
  decision: "approved" | "rejected";
  failedGateKeys: Array<keyof PilotReadinessInput>;
}

export const domainModules: DomainModuleName[] = [
  "client-onboarding",
  "digital-accounts",
  "ledger",
  "balance",
  "settlement-obligation",
  "funding-reservation",
  "payment-execution",
  "api-auth",
  "circle-integration",
  "events",
  "liquidity-rebalancing",
  "reconciliation",
  "reporting",
  "hardening-release"
];

export const totalClassifiedBalance = (balance: ClassifiedBalanceView): UsdcMinorUnitAmount => {
  return (
    balance.availableMinorUnits +
    balance.pendingMinorUnits +
    balance.reservedMinorUnits +
    balance.lockedMinorUnits +
    balance.suspenseMinorUnits
  );
};

export const canReserve = (balance: ClassifiedBalanceView, amountMinorUnits: UsdcMinorUnitAmount): boolean => {
  return amountMinorUnits > 0n && balance.availableMinorUnits >= amountMinorUnits;
};

export const recommendInternalRebalance = (input: RebalanceRecommendationInput): RebalanceRecommendationView | undefined => {
  const shortfall = input.destinationTargetMinorUnits - input.destinationAvailableMinorUnits;
  if (shortfall <= 0n || input.sourceDeployableMinorUnits < shortfall) {
    return undefined;
  }
  return {
    sourceAccountOfDigitalAssetId: input.sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId: input.destinationAccountOfDigitalAssetId,
    amountMinorUnits: shortfall,
    approvalRequired: shortfall > input.approvalThresholdMinorUnits,
    routeExplanation: "Internal ADA rebalance selected from deployable USDC source liquidity."
  };
};

export const evaluatePilotReadiness = (input: PilotReadinessInput): PilotReadinessDecision => {
  const failedGateKeys = (Object.keys(input) as Array<keyof PilotReadinessInput>).filter((key) => !input[key]);
  return {
    decision: failedGateKeys.length === 0 ? "approved" : "rejected",
    failedGateKeys
  };
};
