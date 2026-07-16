export interface LiquidityPolicy {
  id: string;
  tenantId: string;
  scopeType: "account" | "actor";
  scopeId: string;
  minimumBalanceMinorUnits: bigint;
  targetBalanceMinorUnits: bigint;
  maximumBalanceMinorUnits: bigint;
  approvalThresholdMinorUnits: bigint;
  staleAfterSeconds: number;
  permittedSourceAccountIds: string[];
  permittedDestinationAccountIds: string[];
}

export interface TreasuryPositionSnapshot {
  id: string;
  tenantId: string;
  scopeType: "account" | "actor";
  scopeId: string;
  accountOfDigitalAssetId?: string;
  businessClientId?: string;
  currentMinorUnits: bigint;
  deployableMinorUnits: bigint;
  projectedMinorUnits: bigint;
  pendingInboundMinorUnits: bigint;
  pendingOutboundMinorUnits: bigint;
  expectedPayableMinorUnits: bigint;
  expectedReceivableMinorUnits: bigint;
  minimumBufferMinorUnits: bigint;
  sourceBalanceVersion: number;
  positionVersion: number;
  freshnessStatus: "fresh" | "stale";
  calculatedAt: string;
  staleAfter: string;
}

export interface LiquidityAlert {
  id: string;
  tenantId: string;
  treasuryPositionSnapshotId: string;
  alertType: "shortfall" | "surplus" | "stale_position";
  amountMinorUnits: bigint;
  severity: "info" | "warning" | "critical";
  status: "open" | "closed";
}

export interface MaturityLadderItem {
  dueDate: string;
  expectedPayableMinorUnits: bigint;
}
