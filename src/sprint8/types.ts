export type EvidenceStatus = "pass" | "fail" | "blocked";
export type FindingSeverity = "none" | "low" | "medium" | "high" | "critical";
export type ReleaseDecision = "approved" | "rejected";

export interface HardeningScenarioResult {
  id: string;
  tenantId: string;
  scenarioCode: string;
  scenarioName: string;
  scenarioGroup: "functional" | "technical";
  status: EvidenceStatus;
  evidenceUri?: string;
  executedBy: string;
  executedAt: string;
}

export interface ResilienceTestResult {
  id: string;
  tenantId: string;
  testCode: string;
  testName: string;
  status: EvidenceStatus;
  severity: FindingSeverity;
  findingSummary?: string;
  evidenceUri?: string;
  executedAt: string;
}

export interface PerformanceBenchmarkResult {
  id: string;
  tenantId: string;
  capability: string;
  targetDescription: string;
  measuredValueMs: number;
  targetValueMs: number;
  status: EvidenceStatus;
  measuredAt: string;
}

export interface UatScenarioResult {
  id: string;
  tenantId: string;
  scenarioNumber: number;
  scenarioName: string;
  status: EvidenceStatus;
  ownerRole: string;
  evidenceUri?: string;
  executedAt: string;
}

export interface UatSignoff {
  id: string;
  tenantId: string;
  signerRole: string;
  signerName: string;
  status: "signed" | "withheld";
  signedAt?: string;
  notes?: string;
}

export interface PilotReleaseArtifact {
  id: string;
  tenantId: string;
  artifactType: string;
  artifactName: string;
  artifactUri: string;
  approvalStatus: "approved" | "pending";
  approvedBy?: string;
  approvedAt?: string;
}

export interface KnownLimitation {
  id: string;
  tenantId: string;
  limitationCode: string;
  description: string;
  severity: Exclude<FindingSeverity, "none">;
  mitigation: string;
  targetResolution?: string;
  status: "accepted" | "open";
}

export interface ReleaseGateSummary {
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

export interface PilotReleaseDecision {
  id: string;
  tenantId: string;
  releaseVersion: string;
  decision: ReleaseDecision;
  decidedBy: string;
  decidedAt: string;
  gateSummary: ReleaseGateSummary;
  notes?: string;
}
