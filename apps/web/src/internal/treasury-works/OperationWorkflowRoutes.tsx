import { BadgeCheck, Check, FileCheck2, Gauge, UserCheck, X } from "lucide-react";
import { PanelHeader, StatusBadge, SummaryLine } from "../panel.js";
import {
  formatUsdc,
  releaseGates,
  uatScenarios,
  type ApprovalItem,
  type RebalanceRecommendation,
  type ReconciliationBreak
} from "../../operations-data.js";

export const RebalancingScreen = ({
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

export const ApprovalInbox = ({
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

export const ReconciliationDashboard = ({
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

export const BreakDetail = ({
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

export const DailyClose = ({ openBreaks, assignedBreaks, resolvedBreaks }: { openBreaks: number; assignedBreaks: number; resolvedBreaks: number }) => {
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

export const UatEvidence = () => (
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

export const ReleaseReadiness = () => (
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
