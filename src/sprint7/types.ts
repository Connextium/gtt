export type RebalanceRouteType = "internal_rebalance" | "circle_transfer" | "fiat_to_usdc" | "usdc_to_fiat";
export type RebalanceStatus = "recommended" | "pending_approval" | "approved" | "executed" | "blocked";
export type ReconciliationBreakType = "circle_balance_mismatch" | "payment_transaction_missing" | "journal_projection_mismatch";
export type ReconciliationResolutionType = "correction" | "suspense_transfer" | "evidence_attached";

export interface LiquidityRebalancingInstruction {
  id: string;
  tenantId: string;
  sourceAccountOfDigitalAssetId: string;
  destinationAccountOfDigitalAssetId: string;
  amountMinorUnits: bigint;
  estimatedFeeMinorUnits: bigint;
  routeType: RebalanceRouteType;
  routeExplanation: string;
  recommendationReason: string;
  sourcePositionSnapshotId: string;
  destinationPositionSnapshotId: string;
  approvalRequired: boolean;
  createdBy: string;
  approvedBy?: string;
  approvedAt?: string;
  executedAt?: string;
  status: RebalanceStatus;
}

export interface CircleBalanceSnapshot {
  id: string;
  tenantId: string;
  accountOfDigitalAssetId: string;
  assetCode: "USDC";
  availableMinorUnits: bigint;
  snapshotSource: "circle_simulator" | "operator_fixture";
  capturedAt: string;
}

export interface CircleTransactionSnapshot {
  id: string;
  tenantId: string;
  accountOfDigitalAssetId?: string;
  providerTransactionId: string;
  transactionType: "internal_transfer" | "crypto_transfer" | "withdrawal" | "deposit";
  amountMinorUnits: bigint;
  status: "pending" | "complete" | "failed";
  capturedAt: string;
}

export interface ReconciliationRun {
  id: string;
  tenantId: string;
  runType: "daily";
  status: "completed";
  startedAt: string;
  completedAt: string;
}

export interface ReconciliationBreak {
  id: string;
  tenantId: string;
  reconciliationRunId: string;
  accountOfDigitalAssetId?: string;
  breakType: ReconciliationBreakType;
  severity: "low" | "medium" | "high";
  platformAmountMinorUnits: bigint;
  circleAmountMinorUnits: bigint;
  deltaMinorUnits: bigint;
  assignedTo?: string;
  resolutionType?: ReconciliationResolutionType;
  resolutionNote?: string;
  evidenceUri?: string;
  status: "open" | "assigned" | "resolved";
  createdAt: string;
  resolvedAt?: string;
}

export interface TrialBalanceReport {
  debitMinorUnits: bigint;
  creditMinorUnits: bigint;
  balanced: boolean;
}

export interface DailyCloseReport {
  id: string;
  tenantId: string;
  closeDate: string;
  status: "ready" | "blocked";
  openBreakCount: number;
  trialBalance: TrialBalanceReport;
  customerLiabilityMinorUnits: bigint;
  circleCustodyMinorUnits: bigint;
  suspenseMinorUnits: bigint;
}

export interface OperationsConsoleSnapshot {
  rebalancingRecommendations: LiquidityRebalancingInstruction[];
  approvalInbox: LiquidityRebalancingInstruction[];
  reconciliationDashboard: {
    openBreakCount: number;
    assignedBreakCount: number;
    resolvedBreakCount: number;
  };
  dailyCloseStatus: DailyCloseReport;
}
