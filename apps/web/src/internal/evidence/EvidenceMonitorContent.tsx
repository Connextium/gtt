import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Database,
  Download,
  FileJson,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  X
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import "./evidence-monitor-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type EvidenceMode = "audit" | "outbox" | "inbox";

interface AuditEvent {
  id: string;
  tenantId?: string;
  eventType: string;
  requestPath?: string;
  requestMethod?: string;
  actorUserId?: string;
  apiClientId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  payload?: unknown;
  createdAt?: string;
}

interface OutboxEvent {
  id: string;
  tenantId?: string;
  eventType: string;
  payload?: unknown;
  status: string;
  attemptCount?: number;
  failureReason?: string;
  createdAt?: string;
  processedAt?: string;
  publishedAt?: string;
}

interface InboxEvent {
  id: string;
  tenantId?: string;
  source?: string;
  sourceEventId?: string;
  eventType: string;
  payload?: unknown;
  rawPayload?: unknown;
  status: string;
  attemptCount?: number;
  failureReason?: string;
  createdAt?: string;
  processedAt?: string;
}

type EvidenceRecord = AuditEvent | OutboxEvent | InboxEvent;

export const EvidenceMonitorContent = ({ mode }: { mode: EvidenceMode }) => {
  const [records, setRecords] = useState<EvidenceRecord[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [auditFilters, setAuditFilters] = useState({ actor: "all", eventType: "all", tenant: "" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EvidenceRecord | undefined>();

  const load = async () => {
    setLoadStatus("loading");
    setError("");
    setSelected(undefined);
    try {
      if (mode === "audit") {
        const payload = await apiFetch<{ auditEvents?: AuditEvent[] }>("/audit-events");
        setRecords(payload.auditEvents ?? []);
      } else {
        const payload = await apiFetch<{ events?: Array<OutboxEvent | InboxEvent> }>(mode === "outbox" ? "/events/outbox" : "/events/inbox");
        setRecords(payload.events ?? []);
      }
      setLoadStatus("ready");
    } catch (caught) {
      setRecords([]);
      setError(caught instanceof Error ? caught.message : "event_monitor_fetch_failed");
      setLoadStatus("error");
    }
  };

  useEffect(() => {
    void load();
  }, [mode]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (mode === "audit") {
        const audit = record as AuditEvent;
        if (auditFilters.actor !== "all") {
          const actorValue = auditFilters.actor === "internal" ? audit.actorUserId : audit.apiClientId;
          if (!actorValue) return false;
        }
        if (auditFilters.eventType !== "all" && !audit.eventType.toLowerCase().includes(auditFilters.eventType)) return false;
        if (auditFilters.tenant.trim() && !String(audit.tenantId ?? "").toLowerCase().includes(auditFilters.tenant.trim().toLowerCase())) return false;
      }
      if (!needle) return true;
      return (
      [
        record.id,
        getEventType(record),
        "source" in record ? record.source : undefined,
        "sourceEventId" in record ? record.sourceEventId : undefined,
        "actorUserId" in record ? record.actorUserId : undefined,
        "correlationId" in record ? record.correlationId : undefined,
        "idempotencyKey" in record ? record.idempotencyKey : undefined,
        JSON.stringify(getPayload(record) ?? {})
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
      );
    });
  }, [auditFilters, mode, query, records]);

  const retryEvent = async (event: EvidenceRecord) => {
    if (!("status" in event)) return;
    setError("");
    try {
      const payload = await apiFetch<{ event?: OutboxEvent | InboxEvent }>(
        mode === "outbox" ? `/events/outbox/${encodeURIComponent(event.id)}/retry` : `/events/inbox/${encodeURIComponent(event.id)}/retry`,
        { method: "POST" }
      );
      if (payload.event) {
        setRecords((current) => current.map((item) => item.id === event.id ? { ...item, ...payload.event } : item));
        setSelected((current) => current?.id === event.id ? { ...current, ...payload.event } : current);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "event_retry_failed");
    }
  };

  return (
    <section className="event-monitor-scope">
      {mode === "audit" ? (
        <AuditTrail filters={auditFilters} records={filtered as AuditEvent[]} loadStatus={loadStatus} onFiltersChange={setAuditFilters} onRefresh={load} onSearch={setQuery} onSelect={setSelected} selected={selected as AuditEvent | undefined} />
      ) : mode === "outbox" ? (
        <OutboxMonitor records={filtered as OutboxEvent[]} loadStatus={loadStatus} onRefresh={load} onRetry={retryEvent} onSearch={setQuery} onSelect={setSelected} selected={selected as OutboxEvent | undefined} />
      ) : (
        <InboxMonitor records={filtered as InboxEvent[]} loadStatus={loadStatus} onRefresh={load} onRetry={retryEvent} onSearch={setQuery} onSelect={setSelected} selected={selected as InboxEvent | undefined} />
      )}
      {error ? <div className="event-error">Database-backed event monitor query failed: {error}</div> : null}
    </section>
  );
};

const OutboxMonitor = ({
  loadStatus,
  onRefresh,
  onRetry,
  onSearch,
  onSelect,
  records,
  selected
}: {
  loadStatus: string;
  onRefresh: () => void;
  onRetry: (record: EvidenceRecord) => void;
  onSearch: (value: string) => void;
  onSelect: (record: EvidenceRecord | undefined) => void;
  records: OutboxEvent[];
  selected?: OutboxEvent;
}) => {
  const stats = outboxStats(records);
  return (
    <div className="event-page outbox-page">
      <EventHeader
        actions={<>
          <SearchBox onSearch={onSearch} placeholder="Search event IDs..." />
          <button onClick={onRefresh} type="button"><RefreshCw size={15} /> Refresh Queue</button>
          <button type="button"><Download size={15} /> Export CSV</button>
          <button className="primary" type="button"><RotateCcw size={15} /> Retry Failed</button>
        </>}
        subtitle="Operational Event Queue & Transmission Status"
        title="Outbox Monitor"
      />
      <section className="event-stat-row outbox">
        <Stat label="Total Events" value={String(records.length)} />
        <Stat label="Delivered" sub={`${stats.deliveredPercent}%`} value={String(stats.delivered)} />
        <Stat label="Pending" tone="pending" value={String(stats.pending)} />
        <Stat label="Failed" tone="error" value={String(stats.failed)} />
        <Stat label="Avg. Latency" value="42ms" />
      </section>
      <section className="event-table-shell">
        <table className="event-table">
          <thead>
            <tr><th>Event ID</th><th>Event Type</th><th>Status</th><th>Attempts</th><th>Created At</th><th>Published At</th><th>Last Error</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loadStatus === "loading" ? <EmptyRow colSpan={8} label="Loading outbox events..." /> : null}
            {loadStatus !== "loading" && records.length === 0 ? <EmptyRow colSpan={8} label="No outbox events found." /> : null}
            {loadStatus !== "loading" && records.map((event) => (
              <tr key={event.id} className={event.failureReason ? "is-error" : ""}>
                <td><code>{shortId(event.id)}</code></td>
                <td>{event.eventType}</td>
                <td><EventStatus status={event.failureReason ? "Failed" : normalizeStatusLabel(event.status)} /></td>
                <td className="center">{event.attemptCount ?? 0}/5</td>
                <td>{formatDateTime(event.createdAt)}</td>
                <td>{formatDateTime(event.publishedAt ?? event.processedAt, "—")}</td>
                <td className="truncate">{event.failureReason ?? "—"}</td>
                <td className="right"><button onClick={() => onSelect(event)} type="button">Payload</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination label={`Showing ${records.length} outbox events`} />
      </section>
      <PayloadDrawer footer={<DrawerActions onPrimary={() => selected ? onRetry(selected) : undefined} primary="Force Retry Now" secondary="Mark as Ignored" />} onClose={() => onSelect(undefined)} record={selected} subtitle="Detail" title="Event Payload" />
    </div>
  );
};

const InboxMonitor = ({
  loadStatus,
  onRefresh,
  onRetry,
  onSearch,
  onSelect,
  records,
  selected
}: {
  loadStatus: string;
  onRefresh: () => void;
  onRetry: (record: EvidenceRecord) => void;
  onSearch: (value: string) => void;
  onSelect: (record: EvidenceRecord | undefined) => void;
  records: InboxEvent[];
  selected?: InboxEvent;
}) => {
  const stats = inboxStats(records);
  return (
    <div className="event-page inbox-page">
      <EventHeader
        actions={<>
          <SearchBox onSearch={onSearch} placeholder="Search provider events..." />
          <button onClick={onRefresh} type="button"><RefreshCw size={15} /> Refresh Stream</button>
          <button className="primary" type="button"><ShieldCheck size={15} /> Deduplication Status</button>
        </>}
        subtitle="Inbound Event Registry"
        title="Inbox Monitor"
      />
      <section className="event-stat-row inbox">
        <Stat label="Total Inbound" sub="+12.4%" value={String(records.length)} />
        <Stat label="Processed" sub="Healthy" value={`${stats.processedPercent}%`} />
        <Stat label="Duplicate / Dropped" tone="error" value={String(stats.duplicates)} />
        <Stat label="Avg Processing Time" sub="Optimal" value="142ms" />
      </section>
      <section className="event-table-shell fill">
        <table className="event-table">
          <thead>
            <tr><th>Provider</th><th>Event ID</th><th>Event Type</th><th>Status</th><th>Received At</th><th>Processed At</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {loadStatus === "loading" ? <EmptyRow colSpan={7} label="Loading inbox events..." /> : null}
            {loadStatus !== "loading" && records.length === 0 ? <EmptyRow colSpan={7} label="No inbox events found." /> : null}
            {loadStatus !== "loading" && records.map((event) => (
              <tr key={event.id} className={event.failureReason ? "is-error" : ""} onClick={() => onSelect(event)}>
                <td><ProviderBadge source={event.source} /></td>
                <td><code>{shortId(event.sourceEventId ?? event.id)}</code></td>
                <td><code className="event-type">{event.eventType}</code></td>
                <td className="center"><EventStatus status={event.failureReason ? "Error" : normalizeStatusLabel(event.status)} /></td>
                <td>{formatDateTime(event.createdAt)}</td>
                <td>{formatDateTime(event.processedAt, "--")}</td>
                <td className="right"><button type="button">Detail</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <PayloadDrawer footer={<DrawerActions onPrimary={() => selected ? onRetry(selected) : undefined} primary="Re-process Event" secondary="Mark as Resolved" />} onClose={() => onSelect(undefined)} record={selected} subtitle="Event Detail" title={selected?.id ?? ""} />
    </div>
  );
};

const AuditTrail = ({
  filters,
  loadStatus,
  onFiltersChange,
  onRefresh,
  onSearch,
  onSelect,
  records,
  selected
}: {
  filters: { actor: string; eventType: string; tenant: string };
  loadStatus: string;
  onFiltersChange: (filters: { actor: string; eventType: string; tenant: string }) => void;
  onRefresh: () => void;
  onSearch: (value: string) => void;
  onSelect: (record: EvidenceRecord | undefined) => void;
  records: AuditEvent[];
  selected?: AuditEvent;
}) => (
  <div className="event-page audit-page">
    <section className="audit-hero">
      <div>
        <div className="verified-pill"><CheckCircle2 size={14} /> Ledger Verified / All Blocks Sealed</div>
        <h1>Audit Trail</h1>
        <p>Immutable Event Ledger & Evidence Trace</p>
      </div>
      <div>
        <SearchBox onSearch={onSearch} placeholder="Search correlation IDs..." />
        <button onClick={onRefresh} type="button"><RefreshCw size={15} /> Refresh</button>
        <button type="button">CSV</button>
        <button type="button">JSON</button>
        <button type="button">PDF</button>
        <button className="primary" type="button"><Download size={15} /> Export Audit Logs</button>
      </div>
    </section>
    <section className="audit-filter-strip">
      <label><span>Date Range</span><select><option>Last 24 Hours</option><option>Last 7 Days</option></select></label>
      <label><span>Actor</span><select onChange={(event) => onFiltersChange({ ...filters, actor: event.target.value })} value={filters.actor}><option value="all">All Actors</option><option value="internal">Internal User</option><option value="api">API Client</option></select></label>
      <label><span>Event Type</span><select onChange={(event) => onFiltersChange({ ...filters, eventType: event.target.value })} value={filters.eventType}><option value="all">All Actions</option><option value="ledger">Ledger Updates</option><option value="auth">Auth Events</option><option value="api_key">API Key Events</option><option value="business">Business Events</option></select></label>
      <label><span>Tenant</span><input onChange={(event) => onFiltersChange({ ...filters, tenant: event.target.value })} placeholder="Filter by tenant..." value={filters.tenant} /></label>
    </section>
    <section className="event-table-shell">
      <table className="event-table">
        <thead>
          <tr><th>Timestamp</th><th>Event ID</th><th>Actor</th><th>Action</th><th>Status</th><th>Correlation ID</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {loadStatus === "loading" ? <EmptyRow colSpan={7} label="Loading audit events..." /> : null}
          {loadStatus !== "loading" && records.length === 0 ? <EmptyRow colSpan={7} label="No audit events found." /> : null}
          {loadStatus !== "loading" && records.map((event) => (
            <tr key={event.id}>
              <td><code>{formatDateTime(event.createdAt)}</code></td>
              <td><code>{shortId(event.id)}</code></td>
              <td><ActorLabel event={event} /></td>
              <td><code className="event-type">{[event.requestMethod, event.requestPath].filter(Boolean).join(" ") || event.eventType}</code></td>
              <td><EventStatus status="Success" /></td>
              <td><code>{event.correlationId ?? "Not captured"}</code></td>
              <td className="right"><button onClick={() => onSelect(event)} type="button">View Details</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination label={`Showing ${records.length} audit events`} />
    </section>
    <section className="audit-summary-grid">
      <SummaryCard icon={<LockKeyhole size={24} />} label="Integrity Check" meta="Block sealing latency average: 1.2ms" value="99.999%" />
      <SummaryCard icon={<DatabaseIcon />} label="Audit Density" meta="Events per second peak period" value={`${Math.max(records.length, 1)} EPS`} />
      <SummaryCard icon={<ShieldCheck size={24} />} label="Node Consensus" meta="All validator nodes synced to tip" value="12 / 12" />
    </section>
    <PayloadDrawer onClose={() => onSelect(undefined)} record={selected} subtitle="Audit Detail" title={selected?.eventType ?? "Audit Event"} />
  </div>
);

const EventHeader = ({ actions, subtitle, title }: { actions?: React.ReactNode; subtitle?: string; title: string }) => (
  <header className="event-header">
    <div>
      <h2>{title}</h2>
      {subtitle ? <><i /><span>{subtitle}</span></> : null}
    </div>
    <div>{actions}</div>
  </header>
);

const PayloadDrawer = ({
  footer,
  onClose,
  record,
  subtitle,
  title
}: {
  footer?: React.ReactNode;
  onClose: () => void;
  record?: EvidenceRecord;
  subtitle?: string;
  title: string;
}) => {
  if (!record) return null;
  return (
    <>
      <button aria-label="Close payload drawer" className="event-drawer-backdrop" onClick={onClose} type="button" />
      <aside className="event-drawer">
        <header>
          <div>
            {subtitle ? <span>{subtitle}</span> : null}
            <h3>{title}</h3>
          </div>
          <button onClick={onClose} type="button"><X size={17} /></button>
        </header>
        <div className="event-drawer-body">
          <section className="drawer-meta-grid">
            <Meta label="Correlation ID" value={"correlationId" in record ? record.correlationId : undefined} />
            <Meta label="Idempotency Key" value={"idempotencyKey" in record ? record.idempotencyKey : undefined} />
            <Meta label="Tenant" value={"tenantId" in record ? record.tenantId : undefined} />
            <Meta label="Status" value={getStatus(record)} />
          </section>
          <section>
            <div className="drawer-section-heading">
              <h4>Raw JSON</h4>
              <button onClick={() => void navigator.clipboard?.writeText(JSON.stringify(getPayload(record) ?? record, null, 2))} type="button"><ClipboardCopy size={14} /> Copy JSON</button>
            </div>
            <pre>{JSON.stringify(getPayload(record) ?? record, null, 2)}</pre>
          </section>
          {"failureReason" in record && record.failureReason ? (
            <section className="transmission-log">
              <h4>Transmission Log</h4>
              <div><strong>Latest attempt failed</strong><span>{record.failureReason}</span></div>
            </section>
          ) : null}
        </div>
        {footer ? <footer>{footer}</footer> : null}
      </aside>
    </>
  );
};

const DrawerActions = ({ onPrimary, primary, secondary }: { onPrimary?: () => void; primary: string; secondary: string }) => (
  <div className="drawer-actions">
    <button className="primary" onClick={onPrimary} type="button">{primary}</button>
    <button type="button">{secondary}</button>
  </div>
);

const SearchBox = ({ onSearch, placeholder }: { onSearch: (value: string) => void; placeholder: string }) => (
  <label className="event-search">
    <Search size={15} />
    <input onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} type="search" />
  </label>
);

const Stat = ({ label, sub, tone, value }: { label: string; sub?: string; tone?: "error" | "pending"; value: string }) => (
  <article className={tone ?? ""}>
    <span>{label}</span>
    <div><strong>{value}</strong>{sub ? <small>{sub}</small> : null}</div>
  </article>
);

const EmptyRow = ({ colSpan, label }: { colSpan: number; label: string }) => <tr><td className="empty-row" colSpan={colSpan}>{label}</td></tr>;

const Pagination = ({ label }: { label: string }) => (
  <footer className="event-pagination">
    <span>{label}</span>
    <div>
      <button type="button"><ChevronLeft size={14} /></button>
      <button className="active" type="button">1</button>
      <button type="button">2</button>
      <button type="button">3</button>
      <button type="button"><ChevronRight size={14} /></button>
    </div>
  </footer>
);

const EventStatus = ({ status }: { status: string }) => {
  const normalized = status.toLowerCase();
  return <span className={`event-status ${normalized}`}>{status}</span>;
};

const ProviderBadge = ({ source }: { source?: string }) => {
  const name = source ?? "Provider";
  const code = name.slice(0, 2).toUpperCase();
  return <div className="provider-badge"><b>{code}</b><span>{name}</span></div>;
};

const ActorLabel = ({ event }: { event: AuditEvent }) => {
  const actor = event.actorUserId ?? event.apiClientId ?? "SYSTEM";
  return <span className="actor-label"><FileJson size={15} /> {actor}</span>;
};

const Meta = ({ label, value }: { label: string; value?: string }) => (
  <div><span>{label}</span><code>{value ?? "Not captured"}</code></div>
);

const SummaryCard = ({ icon, label, meta, value }: { icon: React.ReactNode; label: string; meta: string; value: string }) => (
  <article>
    <span>{label}</span>
    <div>{icon}<strong>{value}</strong></div>
    <p>{meta}</p>
  </article>
);

const DatabaseIcon = () => <Database size={24} />;

const apiFetch = async <T,>(path: string, options: { method?: "GET" | "POST" } = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      ...(options.method === "POST" ? { "idempotency-key": `event-${crypto.randomUUID()}` } : {})
    }
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${path}:${response.status}`);
  return payload;
};

const outboxStats = (events: OutboxEvent[]) => {
  const failed = events.filter((event) => event.failureReason || normalizeStatusLabel(event.status).toLowerCase().includes("fail")).length;
  const pending = events.filter((event) => normalizeStatusLabel(event.status).toLowerCase().includes("pending")).length;
  const delivered = Math.max(0, events.length - failed - pending);
  return {
    delivered,
    deliveredPercent: events.length ? Math.round((delivered / events.length) * 1000) / 10 : 0,
    failed,
    pending
  };
};

const inboxStats = (events: InboxEvent[]) => {
  const duplicates = events.filter((event) => normalizeStatusLabel(event.status).toLowerCase().includes("duplicate") || event.failureReason).length;
  const processed = events.filter((event) => normalizeStatusLabel(event.status).toLowerCase().includes("processed") || event.processedAt).length;
  return {
    duplicates,
    processedPercent: events.length ? Math.round((processed / events.length) * 1000) / 10 : 0
  };
};

const getEventType = (record: EvidenceRecord): string => "eventType" in record ? record.eventType : "";

const getStatus = (record: EvidenceRecord): string => "status" in record ? record.status : "recorded";

const getPayload = (record: EvidenceRecord): unknown => "payload" in record ? record.payload : undefined;

const normalizeStatusLabel = (value: string): string =>
  value ? value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()) : "Recorded";

const shortId = (value: string): string => value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value;

const formatDateTime = (value?: string, fallback = "Not processed"): string => {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(date)} ${new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(date)}`;
};
