import {
  AlertTriangle,
  BadgeCheck,
  BanknoteArrowUp,
  Check,
  ClipboardCheck,
  FileCheck2,
  Gauge,
  LayoutDashboard,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { operationsNavigation, type WebNavigationItem } from "./index.js";
import {
  formatUsdc,
  initialApprovals,
  initialBreaks,
  initialRecommendations,
  releaseGates,
  uatScenarios,
  type ApprovalItem,
  type RebalanceRecommendation,
  type ReconciliationBreak
} from "./operations-data.js";
import { SelfRegistrationRouter, selfRegistrationRoutes } from "./self-registration.js";
import "./styles.css";

type RouteKey = WebNavigationItem["route"];

const routeIcons: Record<RouteKey, ComponentType<{ size?: number }>> = {
  "/operations/rebalancing": BanknoteArrowUp,
  "/operations/rebalancing/approvals": UserCheck,
  "/operations/reconciliation": RefreshCw,
  "/operations/reconciliation/breaks/:id": AlertTriangle,
  "/operations/daily-close": ClipboardCheck,
  "/operations/uat": ListChecks,
  "/operations/release-readiness": ShieldCheck
};

export const App = () => {
  const [path, setPath] = useState(window.location.pathname);
  const [activeRoute, setActiveRoute] = useState<RouteKey>("/operations/rebalancing");
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

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  if (selfRegistrationRoutes.has(path) || path.startsWith("/onboarding/")) {
    return <SelfRegistrationRouter path={path} navigate={navigate} />;
  }

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
    <div className="app-shell">
      <aside className="sidebar" aria-label="Operations navigation">
        <div className="brand-block">
          <div className="brand-mark">GT</div>
          <div>
            <div className="brand-title">Global Trade Treasury</div>
            <div className="brand-subtitle">Operations Console</div>
          </div>
        </div>

        <nav className="nav-list">
          {operationsNavigation.map((item) => {
            const Icon = routeIcons[item.route];
            const active = item.route === activeRoute;
            return (
              <button
                className={`nav-item ${active ? "active" : ""}`}
                key={item.route}
                onClick={() => setActiveRoute(item.route)}
                title={item.label}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{pageTitle(activeRoute)}</h1>
            <p>{pageDescription(activeRoute)}</p>
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

        {activeRoute === "/operations/rebalancing" && (
          <RebalancingScreen recommendations={recommendations} onQueue={queueRecommendation} />
        )}
        {activeRoute === "/operations/rebalancing/approvals" && (
          <ApprovalInbox approvals={approvals} onDecide={decideApproval} />
        )}
        {activeRoute === "/operations/reconciliation" && (
          <ReconciliationDashboard breaks={breaks} onSelect={(id) => {
            setSelectedBreakId(id);
            setActiveRoute("/operations/reconciliation/breaks/:id");
          }} />
        )}
        {activeRoute === "/operations/reconciliation/breaks/:id" && selectedBreak && (
          <BreakDetail reconciliationBreak={selectedBreak} onAssign={assignBreak} onResolve={resolveBreak} />
        )}
        {activeRoute === "/operations/daily-close" && (
          <DailyClose openBreaks={openBreaks} assignedBreaks={assignedBreaks} resolvedBreaks={resolvedBreaks} />
        )}
        {activeRoute === "/operations/uat" && <UatEvidence />}
        {activeRoute === "/operations/release-readiness" && <ReleaseReadiness />}
      </main>
    </div>
  );
};

const RebalancingScreen = ({
  recommendations,
  onQueue
}: {
  recommendations: RebalanceRecommendation[];
  onQueue: (id: string) => void;
}) => (
  <section className="panel">
    <PanelHeader title="Rebalancing recommendations" meta={`${recommendations.length} active recommendations`} />
    <div className="table">
      <div className="table-row table-head">
        <span>Source</span>
        <span>Destination</span>
        <span>Amount</span>
        <span>Approval</span>
        <span>Action</span>
      </div>
      {recommendations.map((item) => (
        <div className="table-row" key={item.id}>
          <span>{item.sourceAccount}</span>
          <span>{item.destinationAccount}</span>
          <strong>{formatUsdc(item.amountMinorUnits)}</strong>
          <StatusBadge tone={item.approvalRequired ? "attention" : "ready"} label={item.approvalRequired ? "Required" : "Not required"} />
          <button className="action-button" disabled={item.status === "queued"} onClick={() => onQueue(item.id)} type="button">
            <Check size={16} />
            {item.status === "queued" ? "Queued" : "Queue"}
          </button>
          <p className="row-note">{item.routeExplanation}</p>
        </div>
      ))}
    </div>
  </section>
);

const ApprovalInbox = ({
  approvals,
  onDecide
}: {
  approvals: ApprovalItem[];
  onDecide: (id: string, status: "approved" | "rejected") => void;
}) => (
  <section className="panel">
    <PanelHeader title="Approval inbox" meta={`${approvals.filter((item) => item.status === "pending").length} pending`} />
    <div className="approval-list">
      {approvals.map((item) => (
        <article className="queue-item" key={item.id}>
          <div>
            <strong>{item.instructionId}</strong>
            <span>Maker: {item.maker}</span>
          </div>
          <div>
            <strong>{formatUsdc(item.amountMinorUnits)}</strong>
            <StatusBadge label={item.status} tone={item.status === "pending" ? "attention" : item.status === "approved" ? "ready" : "blocked"} />
          </div>
          <div className="button-pair">
            <button className="icon-button positive" disabled={item.status !== "pending"} onClick={() => onDecide(item.id, "approved")} title="Approve instruction" type="button">
              <Check size={17} />
            </button>
            <button className="icon-button negative" disabled={item.status !== "pending"} onClick={() => onDecide(item.id, "rejected")} title="Reject instruction" type="button">
              <X size={17} />
            </button>
          </div>
        </article>
      ))}
    </div>
  </section>
);

const ReconciliationDashboard = ({
  breaks,
  onSelect
}: {
  breaks: ReconciliationBreak[];
  onSelect: (id: string) => void;
}) => (
  <section className="dashboard-grid">
    <div className="panel">
      <PanelHeader title="Break queue" meta={`${breaks.length} total`} />
      <div className="break-list">
        {breaks.map((item) => (
          <button className="break-row" key={item.id} onClick={() => onSelect(item.id)} type="button">
            <span>
              <strong>{item.breakType}</strong>
              <small>{item.account}</small>
            </span>
            <StatusBadge label={item.severity} tone={item.severity === "high" ? "blocked" : "attention"} />
            <strong>{formatUsdc(item.deltaMinorUnits)}</strong>
          </button>
        ))}
      </div>
    </div>
    <div className="panel compact-panel">
      <PanelHeader title="Custody summary" meta="Latest run" />
      <div className="summary-stack">
        <SummaryLine label="Platform balance" value="1,300.000000 USDC" />
        <SummaryLine label="Circle custody" value="1,290.000000 USDC" />
        <SummaryLine label="Known delta" value="10.000000 USDC" />
        <SummaryLine label="Run state" value="Needs review" />
      </div>
    </div>
  </section>
);

const BreakDetail = ({
  reconciliationBreak,
  onAssign,
  onResolve
}: {
  reconciliationBreak: ReconciliationBreak;
  onAssign: (id: string) => void;
  onResolve: (id: string) => void;
}) => (
  <section className="panel">
    <PanelHeader title="Break detail" meta={reconciliationBreak.id} />
    <div className="detail-grid">
      <SummaryLine label="Type" value={reconciliationBreak.breakType} />
      <SummaryLine label="Severity" value={reconciliationBreak.severity} />
      <SummaryLine label="Account" value={reconciliationBreak.account} />
      <SummaryLine label="Status" value={reconciliationBreak.status} />
      <SummaryLine label="Platform amount" value={formatUsdc(reconciliationBreak.platformAmountMinorUnits)} />
      <SummaryLine label="Circle amount" value={formatUsdc(reconciliationBreak.circleAmountMinorUnits)} />
      <SummaryLine label="Delta" value={formatUsdc(reconciliationBreak.deltaMinorUnits)} />
      <SummaryLine label="Assigned to" value={reconciliationBreak.assignedTo ?? "Unassigned"} />
    </div>
    <div className="evidence-box">
      <strong>Operator note</strong>
      <p>{reconciliationBreak.note ?? "No note has been attached yet."}</p>
    </div>
    <div className="panel-actions">
      <button className="action-button" disabled={reconciliationBreak.status === "resolved"} onClick={() => onAssign(reconciliationBreak.id)} type="button">
        <UserCheck size={16} />
        Assign
      </button>
      <button className="action-button primary" disabled={reconciliationBreak.status === "resolved"} onClick={() => onResolve(reconciliationBreak.id)} type="button">
        <FileCheck2 size={16} />
        Resolve with evidence
      </button>
    </div>
  </section>
);

const DailyClose = ({ openBreaks, assignedBreaks, resolvedBreaks }: { openBreaks: number; assignedBreaks: number; resolvedBreaks: number }) => {
  const ready = openBreaks === 0 && assignedBreaks === 0;
  return (
    <section className="panel">
      <PanelHeader title="Daily close status" meta={ready ? "Ready" : "Blocked"} />
      <div className="close-grid">
        <SummaryLine label="Trial balance" value="Balanced" />
        <SummaryLine label="Open breaks" value={String(openBreaks)} />
        <SummaryLine label="Assigned breaks" value={String(assignedBreaks)} />
        <SummaryLine label="Resolved breaks" value={String(resolvedBreaks)} />
        <SummaryLine label="Customer liability" value="1,300.000000 USDC" />
        <SummaryLine label="Circle custody" value="1,300.000000 USDC after evidence" />
      </div>
      <div className={`close-banner ${ready ? "ready" : "blocked"}`}>
        <Gauge size={18} />
        {ready ? "Daily close can proceed." : "Resolve or clear all reconciliation breaks before close."}
      </div>
    </section>
  );
};

const UatEvidence = () => (
  <section className="panel">
    <PanelHeader title="UAT evidence" meta={`${uatScenarios.length} sampled scenarios`} />
    <div className="table">
      <div className="table-row table-head three-col">
        <span>Scenario</span>
        <span>Owner</span>
        <span>Status</span>
      </div>
      {uatScenarios.map((item) => (
        <div className="table-row three-col" key={item.id}>
          <span>{item.name}</span>
          <span>{item.ownerRole}</span>
          <StatusBadge label={item.status} tone={item.status === "pass" ? "ready" : "attention"} />
        </div>
      ))}
    </div>
  </section>
);

const ReleaseReadiness = () => (
  <section className="panel">
    <PanelHeader title="Release readiness" meta="0.1.0-pilot" />
    <div className="gate-grid">
      {releaseGates.map((item) => (
        <div className="gate-item" key={item.id}>
          <BadgeCheck size={18} />
          <span>{item.label}</span>
          <StatusBadge label={item.passed ? "Pass" : "Blocked"} tone={item.passed ? "ready" : "blocked"} />
        </div>
      ))}
    </div>
    <div className="release-decision">
      <strong>Pilot release approved</strong>
      <p>All Sprint 8 gate checks passed. Known limitation: pilot is approved for sandbox or simulator-backed operation only.</p>
    </div>
  </section>
);

const PanelHeader = ({ title, meta }: { title: string; meta: string }) => (
  <div className="panel-header">
    <h2>{title}</h2>
    <span>{meta}</span>
  </div>
);

const SummaryLine = ({ label, value }: { label: string; value: string }) => (
  <div className="summary-line">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const StatusBadge = ({ label, tone }: { label: string; tone: "ready" | "attention" | "blocked" | "neutral" }) => (
  <span className={`status-badge ${tone}`}>{label}</span>
);

const pageTitle = (route: RouteKey): string => {
  return operationsNavigation.find((item) => item.route === route)?.label ?? "Operations";
};

const pageDescription = (route: RouteKey): string => {
  const descriptions: Record<RouteKey, string> = {
    "/operations/rebalancing": "Review policy-driven liquidity recommendations before instruction creation.",
    "/operations/rebalancing/approvals": "Approve or reject maker-checker liquidity instructions.",
    "/operations/reconciliation": "Monitor reconciliation breaks and custody deltas.",
    "/operations/reconciliation/breaks/:id": "Assign, evidence, and resolve controlled reconciliation breaks.",
    "/operations/daily-close": "Confirm close blockers, trial balance, custody, and suspense status.",
    "/operations/uat": "Review pilot scenario outcomes and stakeholder evidence.",
    "/operations/release-readiness": "Inspect final MVP gate status and pilot release decision."
  };
  return descriptions[route];
};
