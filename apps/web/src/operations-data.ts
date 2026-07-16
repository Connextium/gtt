export type StatusTone = "ready" | "attention" | "blocked" | "neutral";

export interface RebalanceRecommendation {
  id: string;
  sourceAccount: string;
  destinationAccount: string;
  amountMinorUnits: bigint;
  approvalRequired: boolean;
  routeExplanation: string;
  status: "recommended" | "queued";
}

export interface ApprovalItem {
  id: string;
  instructionId: string;
  maker: string;
  checker?: string;
  amountMinorUnits: bigint;
  status: "pending" | "approved" | "rejected";
}

export interface ReconciliationBreak {
  id: string;
  breakType: string;
  severity: "low" | "medium" | "high";
  account: string;
  platformAmountMinorUnits: bigint;
  circleAmountMinorUnits: bigint;
  deltaMinorUnits: bigint;
  assignedTo?: string;
  note?: string;
  status: "open" | "assigned" | "resolved";
}

export interface UatScenario {
  id: string;
  name: string;
  ownerRole: string;
  status: "pass" | "pending";
}

export interface ReleaseGate {
  id: string;
  label: string;
  passed: boolean;
}

export const formatUsdc = (value: bigint): string => {
  const whole = value / 1000000n;
  const fractional = value % 1000000n;
  return `${whole.toLocaleString("en-US")}.${fractional.toString().padStart(6, "0")} USDC`;
};

export const initialRecommendations: RebalanceRecommendation[] = [
  {
    id: "rec-001",
    sourceAccount: "Treasury Source ADA",
    destinationAccount: "Buyer Settlement ADA",
    amountMinorUnits: 300000000n,
    approvalRequired: true,
    routeExplanation: "Internal ADA rebalance selected from deployable treasury liquidity.",
    status: "recommended"
  },
  {
    id: "rec-002",
    sourceAccount: "Operating ADA",
    destinationAccount: "Supplier Redemption ADA",
    amountMinorUnits: 85000000n,
    approvalRequired: false,
    routeExplanation: "Below approval threshold and eligible for direct internal transfer.",
    status: "recommended"
  }
];

export const initialApprovals: ApprovalItem[] = [
  {
    id: "approval-001",
    instructionId: "rebalance-029",
    maker: "maker_demo",
    amountMinorUnits: 300000000n,
    status: "pending"
  },
  {
    id: "approval-002",
    instructionId: "rebalance-031",
    maker: "treasury_ops_2",
    amountMinorUnits: 175000000n,
    status: "pending"
  }
];

export const initialBreaks: ReconciliationBreak[] = [
  {
    id: "break-001",
    breakType: "Circle balance mismatch",
    severity: "medium",
    account: "Buyer Settlement ADA",
    platformAmountMinorUnits: 400000000n,
    circleAmountMinorUnits: 390000000n,
    deltaMinorUnits: 10000000n,
    status: "open"
  },
  {
    id: "break-002",
    breakType: "Payment transaction missing",
    severity: "high",
    account: "External Settlement ADA",
    platformAmountMinorUnits: 250000000n,
    circleAmountMinorUnits: 0n,
    deltaMinorUnits: 250000000n,
    assignedTo: "ops_recon",
    status: "assigned"
  }
];

export const uatScenarios: UatScenario[] = [
  { id: "uat-01", name: "Business onboarding and approval", ownerRole: "Product owner", status: "pass" },
  { id: "uat-02", name: "Account provisioning", ownerRole: "Product owner", status: "pass" },
  { id: "uat-03", name: "Wire funding", ownerRole: "Treasury operator", status: "pass" },
  { id: "uat-04", name: "Internal supplier settlement", ownerRole: "Treasury operator", status: "pass" },
  { id: "uat-05", name: "External USDC supplier settlement", ownerRole: "Treasury operator", status: "pass" },
  { id: "uat-06", name: "Reconciliation break", ownerRole: "Accounting reviewer", status: "pass" },
  { id: "uat-07", name: "Maker-checker approval", ownerRole: "Compliance reviewer", status: "pass" },
  { id: "uat-08", name: "Daily close", ownerRole: "Technical operations", status: "pass" }
];

export const releaseGates: ReleaseGate[] = [
  { id: "gate-01", label: "Critical path scenarios pass", passed: true },
  { id: "gate-02", label: "No critical or high defects", passed: true },
  { id: "gate-03", label: "Financial invariants pass", passed: true },
  { id: "gate-04", label: "Security review clean", passed: true },
  { id: "gate-05", label: "Backup and restore demonstrated", passed: true },
  { id: "gate-06", label: "Reconciliation has no unexplained break", passed: true },
  { id: "gate-07", label: "UAT signoff obtained", passed: true },
  { id: "gate-08", label: "Runbooks approved", passed: true },
  { id: "gate-09", label: "Known gaps documented", passed: true },
  { id: "gate-10", label: "Circle evidence retained", passed: true }
];
