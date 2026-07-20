import { useMemo, useState } from "react";
import {
  initialApprovals,
  initialBreaks,
  initialRecommendations,
  releaseGates,
  type ApprovalItem,
  type RebalanceRecommendation,
  type ReconciliationBreak
} from "../../operations-data.js";
import {
  ApprovalInbox,
  BreakDetail,
  DailyClose,
  RebalancingScreen,
  ReconciliationDashboard,
  ReleaseReadiness,
  UatEvidence
} from "./OperationWorkflowRoutes.js";
import { internalRouteForPath } from "../internal-routes.js";

export const treasuryWorksRoutes = new Set([
  "/internal/operations/rebalancing",
  "/internal/operations/rebalancing/approvals",
  "/internal/operations/reconciliation",
  "/internal/operations/daily-close",
  "/internal/operations/uat",
  "/internal/operations/release-readiness"
]);

export const isTreasuryWorksRoute = (path: string): boolean =>
  treasuryWorksRoutes.has(path) || path.startsWith("/internal/operations/reconciliation/breaks/");

export const TreasuryWorksContent = ({
  navigate,
  path
}: {
  navigate: (path: string) => void;
  path: string;
}) => {
  const [recommendations, setRecommendations] = useState<RebalanceRecommendation[]>(initialRecommendations);
  const [approvals, setApprovals] = useState<ApprovalItem[]>(initialApprovals);
  const [breaks, setBreaks] = useState<ReconciliationBreak[]>(initialBreaks);
  const [selectedBreakId, setSelectedBreakId] = useState(initialBreaks[0]?.id ?? "");

  const selectedBreak = breaks.find((item) => item.id === selectedBreakId) ?? breaks[0];
  const openBreaks = breaks.filter((item) => item.status === "open").length;
  const assignedBreaks = breaks.filter((item) => item.status === "assigned").length;
  const resolvedBreaks = breaks.filter((item) => item.status === "resolved").length;
  const pendingApprovals = approvals.filter((item) => item.status === "pending").length;
  const allGatesPassed = releaseGates.every((item) => item.passed);

  const metrics = useMemo(
    () => [
      { label: "Open breaks", value: String(openBreaks), tone: openBreaks > 0 ? "attention" : "ready" },
      { label: "Pending approvals", value: String(pendingApprovals), tone: pendingApprovals > 0 ? "attention" : "ready" },
      { label: "Custody aligned", value: "99.2%", tone: "ready" },
      { label: "Pilot gate", value: allGatesPassed ? "Approved" : "Blocked", tone: allGatesPassed ? "ready" : "blocked" }
    ],
    [allGatesPassed, openBreaks, pendingApprovals]
  );

  const queueRecommendation = (id: string) => {
    setRecommendations((current) => current.map((item) => (item.id === id ? { ...item, status: "queued" } : item)));
  };

  const decideApproval = (id: string, status: "approved" | "rejected") => {
    setApprovals((current) =>
      current.map((item) => (item.id === id ? { ...item, checker: "current_operator", status } : item))
    );
  };

  const assignBreak = (id: string) => {
    setBreaks((current) =>
      current.map((item) =>
        item.id === id ? { ...item, assignedTo: "current_operator", status: "assigned", note: "Assigned for evidence review." } : item
      )
    );
  };

  const resolveBreak = (id: string) => {
    setBreaks((current) =>
      current.map((item) =>
        item.id === id ? { ...item, status: "resolved", note: "Resolved with attached Circle balance evidence." } : item
      )
    );
  };

  return (
    <div className="treasury-works-content">
      <header className="topbar treasury-works-topbar">
        <div>
          <h1>{pageTitle(path)}</h1>
          <p>{pageDescription(path)}</p>
        </div>
        <div className="operator-strip">
          <span className="env-badge">Sandbox</span>
          <span className="release-badge">0.1.0-pilot</span>
          <span className="operator">current_operator</span>
        </div>
      </header>

      <section className="metric-grid" aria-label="Operations status">
        {metrics.map((metric) => (
          <div className={`metric-tile ${metric.tone}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </section>

      {path === "/internal/operations/rebalancing" && (
        <RebalancingScreen recommendations={recommendations} onQueue={queueRecommendation} />
      )}
      {path === "/internal/operations/rebalancing/approvals" && (
        <ApprovalInbox approvals={approvals} onDecide={decideApproval} />
      )}
      {path === "/internal/operations/reconciliation" && (
        <ReconciliationDashboard breaks={breaks} onSelect={(id) => {
          setSelectedBreakId(id);
          navigate(`/internal/operations/reconciliation/breaks/${id}`);
        }} />
      )}
      {path.startsWith("/internal/operations/reconciliation/breaks/") && selectedBreak && (
        <BreakDetail reconciliationBreak={selectedBreak} onAssign={assignBreak} onResolve={resolveBreak} />
      )}
      {path === "/internal/operations/daily-close" && (
        <DailyClose openBreaks={openBreaks} assignedBreaks={assignedBreaks} resolvedBreaks={resolvedBreaks} />
      )}
      {path === "/internal/operations/uat" && <UatEvidence />}
      {path === "/internal/operations/release-readiness" && <ReleaseReadiness />}
    </div>
  );
};

const pageTitle = (path: string): string => {
  return internalRouteForPath(path)?.label ?? "Treasury Works";
};

const pageDescription = (path: string): string => {
  return internalRouteForPath(path)?.description ?? "Internal treasury operations workflow.";
};
