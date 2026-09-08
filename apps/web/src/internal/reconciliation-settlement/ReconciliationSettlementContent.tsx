import { ArrowLeft, Bell, ChartNoAxesColumnIncreasing, CheckCircle, FileText, Plus, Search, Settings, ShieldAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./reconciliation-settlement-scope.css";

type ScreenView = "breaks" | "detail" | "history" | "manual" | "analytics";
type BreakStatus = "OPEN" | "IN REVIEW" | "ESCALATED" | "RESOLVED";

type BreakItem = {
  actualAmount: number;
  breakId: string;
  createdAt: string;
  entity: string;
  expectedAmount: number;
  internalRef: string;
  linkedRef: string;
  linkedWebhook: string;
  priority?: "Normal" | "High" | "Critical";
  providerTraceId: string;
  reason: string;
  relatedAdvance: string;
  source: string;
  status: BreakStatus;
  suspenseAccount: string;
  suspenseId: string;
  variance: number;
  webhookPayload?: string;
};

type HistoryEvent = {
  actor: string;
  dateTime: string;
  eventType: string;
  id: string;
  referenceId: string;
  status: "Success" | "Pending" | "Warning" | "Critical";
};

type RouteEfficiency = {
  avgLatency: string;
  railType: string;
  routeId: string;
  status: "HEALTHY" | "DEGRADED" | "THROTTLED";
  successRate: string;
  volume24h: string;
};

type JournalEntry = {
  balancingAmount: number;
  date: string;
  governanceNote: string;
  isBalanced: boolean;
  lines: Array<{ accountCode: string; accountName: string; credit: number; debit: number; entityAda: string }>;
  manualAuditReference: string;
  referenceId: string;
  resolutionPathSelected: string;
};

type ReconciliationBreakApi = {
  id: string;
  status?: string;
  reason?: string;
  webhookEventId?: string;
  suspenseCaseId?: string;
  createdAt?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

const toBreakStatus = (value?: string): BreakStatus => {
  const status = (value ?? "").toLowerCase();
  if (status === "resolved") return "RESOLVED";
  if (status === "in_review") return "IN REVIEW";
  if (status === "escalated") return "ESCALATED";
  return "OPEN";
};

const apiFetch = async <T,>(path: string, init: { method?: "GET" | "PUT"; body?: Record<string, unknown> } = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "idempotency-key": `reconciliation-${crypto.randomUUID()}`
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
};

const mapReconciliationBreak = (item: ReconciliationBreakApi): BreakItem => ({
  breakId: item.id,
  status: toBreakStatus(item.status),
  reason: item.reason ?? "Unknown discrepancy",
  linkedRef: item.webhookEventId ?? item.suspenseCaseId ?? item.id,
  suspenseId: item.suspenseCaseId ?? "--",
  createdAt: item.createdAt ?? "--",
  expectedAmount: 0,
  actualAmount: 0,
  variance: 0,
  entity: "Treasury Ledger",
  internalRef: item.id,
  source: "Postgres Reconciliation",
  providerTraceId: item.webhookEventId ?? "--",
  linkedWebhook: item.webhookEventId ?? "--",
  relatedAdvance: item.suspenseCaseId ?? "--",
  suspenseAccount: item.suspenseCaseId ?? "--",
  priority: toBreakStatus(item.status) === "ESCALATED" ? "Critical" : "Normal",
  webhookPayload: JSON.stringify(item, null, 2)
});

const initialHistory: HistoryEvent[] = [
  { id: "1", dateTime: "2024-10-27 14:32:01", eventType: "Reconciliation Audit", status: "Success", actor: "System", referenceId: "WH-992-A1" },
  { id: "2", dateTime: "2024-10-27 12:15:44", eventType: "Status Change", status: "Pending", actor: "System", referenceId: "STL-881-X9" },
  { id: "3", dateTime: "2024-10-26 09:05:12", eventType: "Instruction Refresh", status: "Success", actor: "OP-772", referenceId: "WH-991-C2" },
  { id: "4", dateTime: "2024-10-25 18:45:00", eventType: "Verification", status: "Critical", actor: "System", referenceId: "ERR-404-B1" }
];

const routeEfficiency: RouteEfficiency[] = [
  { routeId: "ARC-SETTLE-01", railType: "On-chain", volume24h: "$1.2B", successRate: "99.99%", avgLatency: "8.2s", status: "HEALTHY" },
  { routeId: "ARC-FIAT-US-03", railType: "Fiat", volume24h: "$850M", successRate: "99.85%", avgLatency: "T+1", status: "HEALTHY" },
  { routeId: "HYB-EU-NET-02", railType: "Hybrid", volume24h: "$420M", successRate: "94.20%", avgLatency: "45.0s", status: "DEGRADED" },
  { routeId: "ARC-SETTLE-04", railType: "On-chain", volume24h: "$980M", successRate: "99.95%", avgLatency: "14.1s", status: "THROTTLED" }
];

const money = (amount: number) => amount.toLocaleString("en-US", { minimumFractionDigits: 2 });

export const ReconciliationSettlementContent = () => {
  const [breaks, setBreaks] = useState<BreakItem[]>([]);
  const [screen, setScreen] = useState<ScreenView>("breaks");
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [selectedLinkedRef, setSelectedLinkedRef] = useState("INST-9928-X");
  const [history, setHistory] = useState(initialHistory);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [reasonFilter, setReasonFilter] = useState("ALL");
  const [payloadModal, setPayloadModal] = useState<{ payload: string; title: string } | undefined>();
  const [journalModal, setJournalModal] = useState<JournalEntry | undefined>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadBreaks = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<{ breaks?: ReconciliationBreakApi[] }>("/reconciliation/breaks");
      const mapped = (response.breaks ?? []).map(mapReconciliationBreak);
      setBreaks(mapped);
      if (!selectedId && mapped[0]) setSelectedId(mapped[0].breakId);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load reconciliation breaks.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBreaks();
  }, []);

  const selectedBreak = breaks.find((item) => item.breakId === selectedId) ?? breaks[0];
  const unresolvedValue = breaks.reduce((sum, item) => sum + (item.status !== "RESOLVED" ? Math.abs(item.expectedAmount) : 0), 0);
  const filteredBreaks = useMemo(() => breaks.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (reasonFilter !== "ALL" && item.reason !== reasonFilter) return false;
    const normalized = search.trim().toLowerCase();
    if (!normalized) return true;
    return [item.breakId, item.entity, item.linkedRef, item.suspenseId, item.source].some((value) => value.toLowerCase().includes(normalized));
  }), [breaks, reasonFilter, search, statusFilter]);

  const openJournalPreview = (item: BreakItem, note = "Resolution authorized by institutional operator.") => {
    setJournalModal({
      referenceId: `${item.breakId}-RES`,
      date: new Date().toISOString().replace("T", " ").substring(0, 19) + " UTC",
      resolutionPathSelected: "Accept Variance (Post to Fee Expense)",
      balancingAmount: item.variance,
      lines: [
        { accountCode: "10020", accountName: item.entity, entityAda: item.linkedRef, debit: 0, credit: Math.abs(item.variance) },
        { accountCode: "50500", accountName: "Bank Fees & Variances", entityAda: "Institutional Treasury", debit: Math.abs(item.variance), credit: 0 }
      ],
      isBalanced: true,
      manualAuditReference: "OP-892",
      governanceNote: note
    });
  };

  const confirmJournal = async (entry: JournalEntry) => {
    const breakId = entry.referenceId.replace(/-RES$/, "");
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/reconciliation/breaks/${encodeURIComponent(breakId)}/resolve`, {
        method: "PUT",
        body: { resolutionNote: entry.governanceNote || "Resolved via reconciliation settlement console" }
      });
      await loadBreaks();
      setHistory((items) => [{
        id: String(Date.now()),
        dateTime: new Date().toISOString().replace("T", " ").substring(0, 19),
        eventType: "Journal Post Executed",
        status: "Success",
        actor: "OP-892",
        referenceId: entry.referenceId
      }, ...items]);
      setJournalModal(undefined);
    } catch (resolveError) {
      setError(resolveError instanceof Error ? resolveError.message : "Failed to resolve reconciliation break.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="reconciliation-settlement-scope">
      <header className="rs-header">
        <div>
          <span className="rs-eyebrow">Treasury Reconciliation</span>
          <h1>{titleFor(screen, selectedBreak, selectedLinkedRef)}</h1>
        </div>
        <div className="rs-header-tools">
          <label>
            <Search size={14} />
            <input onChange={(event) => setSearch(event.target.value)} placeholder="Search breaks, refs, entities" value={search} />
          </label>
          <button onClick={() => setScreen("analytics")} type="button"><ChartNoAxesColumnIncreasing size={14} />Analytics</button>
          <button onClick={() => setScreen("manual")} type="button"><Plus size={14} />Manual Reconciliation</button>
          <button onClick={() => void loadBreaks()} type="button">Refresh</button>
          <button type="button"><Bell size={14} /><span className="rs-count">2</span></button>
          <button type="button"><Settings size={14} /></button>
        </div>
      </header>
      {loading ? <p className="rs-panel">Loading reconciliation breaks...</p> : null}
      {submitting ? <p className="rs-panel">Submitting resolution...</p> : null}
      {error ? <p className="rs-panel">{error}</p> : null}

      <nav className="rs-tabs" aria-label="Reconciliation views">
        <button className={screen === "analytics" ? "active" : ""} onClick={() => setScreen("analytics")} type="button">Settlement Analytics</button>
        <button className={screen === "breaks" || screen === "detail" ? "active" : ""} onClick={() => setScreen("breaks")} type="button">Reconciliation Breaks</button>
        <button className={screen === "history" ? "active" : ""} onClick={() => setScreen("history")} type="button">History</button>
      </nav>

      {screen === "breaks" ? (
        <BreaksRegistry
          breaks={filteredBreaks}
          openCount={breaks.filter((item) => item.status === "OPEN").length}
          reasonFilter={reasonFilter}
          setReasonFilter={setReasonFilter}
          setSelected={(item) => {
            setSelectedId(item.breakId);
            setScreen("detail");
          }}
          setStatusFilter={setStatusFilter}
          showHistory={(linkedRef) => {
            setSelectedLinkedRef(linkedRef);
            setScreen("history");
          }}
          statusFilter={statusFilter}
          totalBreaks={breaks.length}
          unresolvedValue={unresolvedValue}
        />
      ) : null}
      {screen === "detail" && selectedBreak ? <BreakDetail breakItem={selectedBreak} onBack={() => setScreen("breaks")} onOpenJournal={openJournalPreview} onOpenPayload={setPayloadModal} /> : null}
      {screen === "history" ? <HistoryLog events={history} linkedRef={selectedLinkedRef} onBack={() => setScreen("breaks")} /> : null}
      {screen === "manual" && selectedBreak ? <ManualWorkspace breakItem={selectedBreak} onBack={() => setScreen("breaks")} onOpenJournal={openJournalPreview} onOpenPayload={setPayloadModal} /> : null}
      {screen === "analytics" ? <SettlementAnalytics onNavigateBreaks={() => setScreen("breaks")} /> : null}
      {payloadModal ? <PayloadModal modal={payloadModal} onClose={() => setPayloadModal(undefined)} /> : null}
      {journalModal ? <JournalPreviewModal entry={journalModal} onClose={() => setJournalModal(undefined)} onConfirm={confirmJournal} /> : null}
    </section>
  );
};

const titleFor = (screen: ScreenView, selectedBreak?: BreakItem, linkedRef?: string) => {
  if (screen === "analytics") return "Settlement Analytics";
  if (screen === "detail") return `Break Detail: ${selectedBreak?.breakId ?? ""}`;
  if (screen === "history") return `Reconciliation History: ${linkedRef ?? ""}`;
  if (screen === "manual") return "Manual Reconciliation Workspace";
  return "Reconciliation Breaks";
};

const BreaksRegistry = ({
  breaks,
  openCount,
  reasonFilter,
  setReasonFilter,
  setSelected,
  setStatusFilter,
  showHistory,
  statusFilter,
  totalBreaks,
  unresolvedValue
}: {
  breaks: BreakItem[];
  openCount: number;
  reasonFilter: string;
  setReasonFilter: (value: string) => void;
  setSelected: (item: BreakItem) => void;
  setStatusFilter: (value: string) => void;
  showHistory: (linkedRef: string) => void;
  statusFilter: string;
  totalBreaks: number;
  unresolvedValue: number;
}) => (
  <div className="rs-stack">
    <div className="rs-kpis">
      <Metric label="Open Breaks" meta="+3 in 1h" value={String(openCount)} detail="Requires manual or rule-based authorization" alert />
      <Metric label="Avg Resolution Time" meta="Target: < 6.0h" value="4.2h" detail="-12% vs last week" />
      <Metric label="Total Suspense Value" meta="USD Equivalent" value={`$${(unresolvedValue / 1000000).toFixed(1)}M`} detail={`$${money(unresolvedValue)} held in suspense clearing`} />
    </div>
    <div className="rs-toolbar">
      <label><span>Status:</span><select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}><option value="ALL">All Statuses</option><option value="OPEN">Open</option><option value="IN REVIEW">In Review</option><option value="ESCALATED">Escalated</option><option value="RESOLVED">Resolved</option></select></label>
      <label><span>Reason:</span><select onChange={(event) => setReasonFilter(event.target.value)} value={reasonFilter}><option value="ALL">All Discrepancy Reasons</option><option>Amount Mismatch</option><option>Webhook Timeout</option><option>Unknown Account</option></select></label>
      <label><span>Timeframe:</span><select defaultValue="24h"><option value="24h">Last 24 Hours</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option></select></label>
      <small>Showing <b>{breaks.length}</b> of {totalBreaks} breaks</small>
    </div>
    <section className="rs-panel">
      <header><h2>Reconciliation Breaks Registry</h2><span>Live Ledger Feed - Updated 1m ago</span></header>
      <div className="rs-table-wrap">
        <table>
          <thead><tr><th>Break ID</th><th>Status</th><th>Discrepancy Reason</th><th>Linked Entity & Ref</th><th>Suspense Acc</th><th className="right">Expected / Variance</th><th>Created (UTC)</th><th className="right">Actions</th></tr></thead>
          <tbody>
            {breaks.map((item) => <tr key={item.breakId}>
              <td><button className="rs-link" onClick={() => setSelected(item)} type="button">{item.breakId}</button><small>{item.source}</small></td>
              <td><StatusBadge status={item.status} /></td>
              <td><b>{item.reason}</b><small>Priority: {item.priority ?? "Normal"}</small></td>
              <td><b>{item.entity}</b><code>{item.linkedRef}</code></td>
              <td><code>{item.suspenseId}</code></td>
              <td className="right"><b className="mono">${money(item.expectedAmount)}</b><small className={item.variance ? "danger" : ""}>Var: {item.variance < 0 ? "" : "+"}${item.variance.toFixed(2)}</small></td>
              <td><code>{item.createdAt}</code></td>
              <td className="right"><button onClick={() => setSelected(item)} type="button">{item.status === "ESCALATED" ? "Escalation" : "Detail"}</button><button onClick={() => showHistory(item.linkedRef)} type="button">Log</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <footer><span>Page 1 of 1 - Displaying live entries from primary ledger</span><button disabled type="button">1</button></footer>
    </section>
  </div>
);

const BreakDetail = ({ breakItem, onBack, onOpenJournal, onOpenPayload }: { breakItem: BreakItem; onBack: () => void; onOpenJournal: (item: BreakItem, note?: string) => void; onOpenPayload: (modal: { title: string; payload: string }) => void }) => {
  const [note, setNote] = useState("");
  return (
    <div className="rs-stack">
      <button className="rs-back" onClick={onBack} type="button"><ArrowLeft size={13} />Return to Reconciliation Breaks</button>
      <section className="rs-detail-head">
        <div><h2>Break Detail & Resolution: {breakItem.breakId}</h2><p>Created: {breakItem.createdAt} - Entity: <b>{breakItem.entity}</b> - Reason: <b>{breakItem.reason}</b></p></div>
        <StatusBadge status={breakItem.status} />
      </section>
      <div className="rs-detail-grid">
        <section className="rs-panel wide">
          <header><h2>State Comparison: Platform vs Provider</h2><span>Automated Reconciliation Matching</span></header>
          <div className="rs-compare">
            <StateCard title="Platform State (Internal Ledger)" rows={[["Expected Amount", `$${money(breakItem.expectedAmount)}`], ["Entity / Counterparty", breakItem.entity], ["Internal Reference", breakItem.internalRef], ["Linked Ref", breakItem.linkedRef]]} />
            <StateCard danger title={`Provider Evidence (${breakItem.source})`} rows={[["Actual Amount Received", `$${money(breakItem.actualAmount)}`], ["Detected Variance", `${breakItem.variance < 0 ? "" : "+"}$${breakItem.variance.toFixed(2)} USD`], ["Provider Trace ID", breakItem.providerTraceId], ["Suspense ID", breakItem.suspenseId]]} />
          </div>
          <div className="rs-warning"><ShieldAlert size={18} /><div><b>Discrepancy Analysis: Fee Extraction Suspected</b><p>Actual amount received is ${Math.abs(breakItem.variance).toFixed(2)} less than expected. Intermediary wire processing fee detected.</p></div><strong>-{Math.abs(breakItem.variance).toFixed(2)} USD</strong></div>
        </section>
        <aside className="rs-panel">
          <header><h2>Resolution Terminal</h2><span>Governance Controlled</span></header>
          <div className="rs-resolution">
            <label><span>Resolution Path</span><select defaultValue="variance"><option value="variance">Accept Variance (Post to Fee Expense)</option><option value="reverse">Reverse Provider Entry</option><option value="hold">Hold for Governance Review</option></select></label>
            <label><span>Governance Note</span><textarea onChange={(event) => setNote(event.target.value)} placeholder="Enter operator note for immutable audit trail" value={note} /></label>
            <button className="primary" onClick={() => onOpenJournal(breakItem, note || "Resolved via Break Detail terminal")} type="button"><CheckCircle size={14} />Preview Journal Entry</button>
          </div>
        </aside>
        <section className="rs-panel wide">
          <header><h2>Linked Context & Evidence</h2></header>
          <div className="rs-evidence-grid">
            <Evidence label="Linked Webhook" value={breakItem.linkedWebhook} button="View Payload" onClick={() => onOpenPayload({ title: `Linked Webhook Payload: ${breakItem.linkedWebhook}`, payload: breakItem.webhookPayload ?? JSON.stringify({ event_type: "wire.received", id: breakItem.linkedWebhook, amount: breakItem.actualAmount, trace_id: breakItem.providerTraceId }, null, 2) })} />
            <Evidence label="Related Advance" value={breakItem.relatedAdvance} button="View Advance" />
            <Evidence label="Suspense Clearing" value={breakItem.suspenseAccount} button="View Ledger" />
          </div>
        </section>
      </div>
    </div>
  );
};

const ManualWorkspace = ({ breakItem, onBack, onOpenJournal, onOpenPayload }: { breakItem: BreakItem; onBack: () => void; onOpenJournal: (item: BreakItem, note?: string) => void; onOpenPayload: (modal: { title: string; payload: string }) => void }) => (
  <div className="rs-stack">
    <button className="rs-back" onClick={onBack} type="button"><ArrowLeft size={13} />Return to Breaks</button>
    <section className="rs-panel">
      <header><h2>Manual Reconciliation Workspace</h2><span>{breakItem.breakId}</span></header>
      <div className="rs-manual">
        <StateCard title="Internal Ledger Snapshot" rows={[["Account", breakItem.entity], ["Expected", `$${money(breakItem.expectedAmount)}`], ["Internal Ref", breakItem.internalRef], ["Suspense Account", breakItem.suspenseAccount]]} />
        <StateCard danger title="Provider Evidence Snapshot" rows={[["Provider", breakItem.source], ["Actual", `$${money(breakItem.actualAmount)}`], ["Trace", breakItem.providerTraceId], ["Variance", `$${breakItem.variance.toFixed(2)}`]]} />
        <div className="rs-resolution"><button onClick={() => onOpenPayload({ title: "Provider Payload", payload: breakItem.webhookPayload ?? "{}" })} type="button"><FileText size={14} />Inspect Payload</button><button className="primary" onClick={() => onOpenJournal(breakItem, "Manual reconciliation authorized.")} type="button">Generate Journal Preview</button></div>
      </div>
    </section>
  </div>
);

const HistoryLog = ({ events, linkedRef, onBack }: { events: HistoryEvent[]; linkedRef: string; onBack: () => void }) => (
  <div className="rs-stack">
    <button className="rs-back" onClick={onBack} type="button"><ArrowLeft size={13} />Return to Breaks</button>
    <section className="rs-panel">
      <header><h2>Reconciliation History</h2><span>Linked Ref: {linkedRef}</span></header>
      <div className="rs-history">
        {events.map((event) => <article key={event.id}><span className={`rs-dot ${event.status.toLowerCase()}`} /><div><b>{event.eventType}</b><p>{event.dateTime} - {event.actor} - {event.referenceId}</p></div><StatusPill value={event.status} /></article>)}
      </div>
    </section>
  </div>
);

const SettlementAnalytics = ({ onNavigateBreaks }: { onNavigateBreaks: () => void }) => (
  <div className="rs-stack">
    <section className="rs-detail-head">
      <div><h2>Settlement Analytics</h2><p>Global throughput monitoring and routing efficiency metrics</p></div>
      <button className="primary" onClick={onNavigateBreaks} type="button">View Breaks Registry</button>
    </section>
    <div className="rs-kpis four">
      <Metric label="Global Throughput (24h)" value="$4.2B" detail="Cleared across 14 active settlement rails" />
      <Metric label="Settlement Efficiency" value="99.92%" detail="Direct STP clearance without manual breaks" />
      <Metric label="Avg Clearance Time" value="12.4s" detail="On-chain and instant wire execution avg" />
      <Metric label="Active Nodes / Routes" value="14 / 14" detail="1 degraded node under latency observation" />
    </div>
    <div className="rs-analytics-grid">
      <section className="rs-panel">
        <header><h2>Real-time Settlement Velocity</h2><span>Hourly USD millions</span></header>
        <div className="rs-bars">{[210, 340, 280, 450, 520, 390, 610, 580, 720, 680, 810, 940].map((value, index) => <div key={index}><span style={{ height: `${(value / 1000) * 100}%` }} /><small>{index * 2}:00</small></div>)}</div>
      </section>
      <section className="rs-panel">
        <header><h2>Regional Performance</h2></header>
        <div className="rs-regions">{[
          ["United States", "$2.1B", "99.98%", 90],
          ["European Union", "$1.1B", "96.40%", 65],
          ["APAC Region", "$650M", "99.90%", 45],
          ["LATAM Region", "$350M", "98.20%", 30]
        ].map(([region, volume, rate, pct]) => <div key={region}><p><b>{region}</b><span>{volume} ({rate})</span></p><div><span style={{ width: `${pct}%` }} /></div></div>)}</div>
      </section>
    </div>
    <section className="rs-panel">
      <header><h2>Route Efficiency Registry</h2><span>Live Routing Table - 14 Nodes Connected</span></header>
      <div className="rs-table-wrap"><table><thead><tr><th>Route ID</th><th>Rail Type</th><th>24h Volume</th><th>Success Rate</th><th>Avg Latency</th><th>Node Status</th></tr></thead><tbody>{routeEfficiency.map((route) => <tr key={route.routeId}><td><code>{route.routeId}</code></td><td>{route.railType}</td><td><b>{route.volume24h}</b></td><td>{route.successRate}</td><td>{route.avgLatency}</td><td><StatusPill value={route.status} /></td></tr>)}</tbody></table></div>
    </section>
  </div>
);

const Metric = ({ alert, detail, label, meta, value }: { alert?: boolean; detail: string; label: string; meta?: string; value: string }) => (
  <article className="rs-metric"><div><span>{label}</span>{meta ? <em className={alert ? "danger" : ""}>{meta}</em> : null}</div><strong>{value}</strong><p>{detail}</p></article>
);

const StateCard = ({ danger, rows, title }: { danger?: boolean; rows: Array<[string, string]>; title: string }) => (
  <article className={danger ? "rs-state danger" : "rs-state"}><h3>{title}</h3><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>
);

const Evidence = ({ button, label, onClick, value }: { button: string; label: string; onClick?: () => void; value: string }) => (
  <article className="rs-evidence"><span>{label}</span><code>{value}</code><button onClick={onClick} type="button">{button}</button></article>
);

const StatusBadge = ({ status }: { status: BreakStatus }) => <span className={`rs-status ${status.toLowerCase().replace(/\s+/g, "-")}`}>{status}</span>;
const StatusPill = ({ value }: { value: string }) => <span className={`rs-pill ${value.toLowerCase()}`}>{value}</span>;

const PayloadModal = ({ modal, onClose }: { modal: { payload: string; title: string }; onClose: () => void }) => (
  <div className="rs-modal-backdrop"><div className="rs-modal payload"><header><h3>{modal.title}</h3><button onClick={onClose} type="button"><X size={16} /></button></header><pre>{modal.payload}</pre></div></div>
);

const JournalPreviewModal = ({ entry, onClose, onConfirm }: { entry: JournalEntry; onClose: () => void; onConfirm: (entry: JournalEntry) => void }) => (
  <div className="rs-modal-backdrop"><div className="rs-modal"><header><h3>Journal Entry Preview</h3><button onClick={onClose} type="button"><X size={16} /></button></header><div className="rs-journal-meta"><span>{entry.referenceId}</span><span>{entry.date}</span><span>{entry.isBalanced ? "Balanced" : "Unbalanced"}</span></div><table><thead><tr><th>Account</th><th>Entity ADA</th><th className="right">Debit</th><th className="right">Credit</th></tr></thead><tbody>{entry.lines.map((line) => <tr key={`${line.accountCode}-${line.entityAda}`}><td><b>{line.accountCode}</b><small>{line.accountName}</small></td><td><code>{line.entityAda}</code></td><td className="right">${line.debit.toFixed(2)}</td><td className="right">${line.credit.toFixed(2)}</td></tr>)}</tbody></table><p>{entry.governanceNote}</p><footer><button onClick={onClose} type="button">Cancel</button><button className="primary" onClick={() => onConfirm(entry)} type="button">Confirm Journal Post</button></footer></div></div>
);
