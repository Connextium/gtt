import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint8Application } from "./application.js";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const context = (): ActorContext => ({
  tenantId: "tenant_a",
  userId: "release_manager",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_s8"
});

const testRejectedWithoutEvidence = (): void => {
  resetIdsForTest();
  const { app } = createSprint8Application();
  const decision = app.hardeningRelease.decidePilotRelease(context(), {
    releaseVersion: "0.1.0-rc-empty",
    decidedBy: "release_manager"
  });
  assert(decision.decision === "rejected", "release should reject without evidence");
  assert(!decision.gateSummary.allCriticalPathScenariosPass, "critical path should be incomplete");
  assert(!decision.gateSummary.uatSignedOff, "UAT should be incomplete");
};

const testApprovedWithCompleteEvidence = (): void => {
  resetIdsForTest();
  const { app } = createSprint8Application();
  const ctx = context();
  app.hardeningRelease.registerCompletePilotEvidence(ctx);
  const gate = app.hardeningRelease.evaluateReleaseGate(ctx);
  assert(Object.values(gate).every(Boolean), "all release gate checks should pass");
  const decision = app.hardeningRelease.decidePilotRelease(ctx, {
    releaseVersion: "0.1.0-pilot",
    decidedBy: "release_manager",
    notes: "Pilot release approved from complete Sprint 8 evidence."
  });
  assert(decision.decision === "approved", "complete evidence should approve pilot release");
  assert(decision.gateSummary.backupRestoreDemonstrated, "backup restore should be demonstrated");
  assert(decision.gateSummary.securityReviewClean, "security review should be clean");
  assert(decision.gateSummary.circleEvidenceRetained, "Circle evidence should be retained");
};

const testHighSeverityFindingBlocksRelease = (): void => {
  resetIdsForTest();
  const { app } = createSprint8Application();
  const ctx = context();
  app.hardeningRelease.registerCompletePilotEvidence(ctx);
  app.hardeningRelease.recordResilienceTest(ctx, {
    testCode: "access_control_penetration",
    testName: "Access-control penetration testing",
    status: "fail",
    severity: "high",
    findingSummary: "Synthetic high-severity access-control finding."
  });
  const decision = app.hardeningRelease.decidePilotRelease(ctx, {
    releaseVersion: "0.1.0-rc-blocked",
    decidedBy: "release_manager"
  });
  assert(decision.decision === "rejected", "high severity finding should block release");
  assert(!decision.gateSummary.noCriticalOrHighDefects, "high defect gate should fail");
  assert(!decision.gateSummary.securityReviewClean, "security gate should fail");
};

testRejectedWithoutEvidence();
testApprovedWithCompleteEvidence();
testHighSeverityFindingBlocksRelease();

console.log("Sprint 8 tests passed");
