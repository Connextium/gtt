import { resetIdsForTest } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import { createSprint8Application } from "./application.js";

const stringifyBigInts = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

resetIdsForTest();
const { app } = createSprint8Application();
const context: ActorContext = {
  tenantId: "tenant_demo",
  userId: "release_manager_demo",
  roles: ["platform_operator", "treasury_operator"],
  correlationId: "corr_sprint8_demo"
};

const rejectedWithoutEvidence = app.hardeningRelease.decidePilotRelease(context, {
  releaseVersion: "0.1.0-rc-empty",
  decidedBy: "release_manager_demo",
  notes: "Expected rejection before Sprint 8 evidence is registered."
});

app.hardeningRelease.registerCompletePilotEvidence(context);
const gateSummary = app.hardeningRelease.evaluateReleaseGate(context);
const approvedPilot = app.hardeningRelease.decidePilotRelease(context, {
  releaseVersion: "0.1.0-pilot",
  decidedBy: "release_manager_demo",
  notes: "Approved for pilot based on complete hardening, UAT, runbook, and evidence register."
});

console.log(JSON.stringify({
  rejectedWithoutEvidence,
  gateSummary,
  approvedPilot
}, stringifyBigInts, 2));
