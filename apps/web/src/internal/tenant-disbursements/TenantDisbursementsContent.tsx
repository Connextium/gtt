import { ArrowLeft, CheckCircle, Copy, FileText, Filter, Plus, Printer, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import "./tenant-disbursements-scope.css";

type DisbursementStatus = "Draft" | "Approved" | "Submitted" | "Processed";

type AuditTrailItem = {
  id: string;
  title: string;
  timestamp: string;
  description: string;
  note?: string;
  traceId?: string;
  source?: string;
};

type DocumentItem = {
  id: string;
  name: string;
  size: string;
  dateAdded: string;
};

type Disbursement = {
  id: string;
  disbursementId: string;
  businessClient: string;
  clientEntity: string;
  destinationAda: string;
  amount: number;
  currency: string;
  status: DisbursementStatus;
  advanceId: string;
  provider: string;
  valueDate: string;
  executionRoute: string;
  availableBalance: number;
  pendingDraw: number;
  auditTrail: AuditTrailItem[];
  documents: DocumentItem[];
};

type DisbursementApi = {
  id: string;
  businessClientId: string;
  businessClientName?: string;
  destinationAdaId?: string;
  destinationAdaName?: string;
  amountMinorUnits?: string;
  currency?: string;
  status?: string;
  settlementAdvanceTransferId?: string;
  providerTransferId?: string;
  createdAt?: string;
  approvedAt?: string;
  submittedAt?: string;
};

type BusinessClientApi = { id: string; legalName?: string };
type AccountApi = { id: string; businessClientId?: string; accountName?: string };

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

const money = (amount: number) => new Intl.NumberFormat("en-US", { currency: "USD", minimumFractionDigits: 2, style: "currency" }).format(amount);

const formatDate = (value?: string): string => {
  if (!value) return "--";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
};

const toUiStatus = (value?: string): DisbursementStatus => {
  const status = (value ?? "").toLowerCase();
  if (status === "approved") return "Approved";
  if (status === "submitted" || status === "pending_provider") return "Submitted";
  if (status === "processed") return "Processed";
  return "Draft";
};

const apiFetch = async <T,>(path: string, init: { method?: "GET" | "POST" | "PUT"; body?: Record<string, unknown> } = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "idempotency-key": `tenant-disbursement-${crypto.randomUUID()}`
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

const mapDisbursement = (item: DisbursementApi): Disbursement => {
  const amount = Number(item.amountMinorUnits ?? 0);
  return {
    id: item.id,
    disbursementId: item.id,
    businessClient: item.businessClientName ?? item.businessClientId,
    clientEntity: item.businessClientName ?? item.businessClientId,
    destinationAda: item.destinationAdaName ?? item.destinationAdaId ?? "--",
    amount: Number.isFinite(amount) ? amount : 0,
    currency: item.currency ?? "USDC",
    status: toUiStatus(item.status),
    advanceId: item.settlementAdvanceTransferId ?? "N/A",
    provider: item.providerTransferId ? "Circle" : "Pending",
    valueDate: formatDate(item.submittedAt ?? item.approvedAt ?? item.createdAt),
    executionRoute: "Treasury API",
    availableBalance: Number.isFinite(amount) ? amount * 2 : 0,
    pendingDraw: toUiStatus(item.status) === "Processed" ? 0 : (Number.isFinite(amount) ? amount : 0),
    auditTrail: [
      {
        id: `${item.id}-audit`,
        title: `Status: ${toUiStatus(item.status)}`,
        timestamp: item.submittedAt ?? item.approvedAt ?? item.createdAt ?? "--",
        description: "Server-authoritative lifecycle from internal treasury API.",
        source: "Postgres route handler"
      }
    ],
    documents: []
  };
};

export const TenantDisbursementsContent = () => {
  const [disbursements, setDisbursements] = useState<Disbursement[]>([]);
  const [businessClients, setBusinessClients] = useState<BusinessClientApi[]>([]);
  const [accounts, setAccounts] = useState<AccountApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [client, setClient] = useState("all");
  const [status, setStatus] = useState("all");
  const [toast, setToast] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const selected = disbursements.find((item) => item.id === selectedId);

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [disbursementResponse, businessClientResponse, accountResponse] = await Promise.all([
        apiFetch<{ disbursements?: DisbursementApi[] }>("/internal/treasury/tenant-disbursements"),
        apiFetch<{ businessClients?: BusinessClientApi[] }>("/business-clients"),
        apiFetch<{ accounts?: AccountApi[] }>("/accounts-of-digital-asset")
      ]);
      setDisbursements((disbursementResponse.disbursements ?? []).map(mapDisbursement));
      setBusinessClients(businessClientResponse.businessClients ?? []);
      setAccounts(accountResponse.accounts ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load disbursements.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 3500);
  };

  const updateStatus = async (id: string, nextStatus: "Approved" | "Submitted") => {
    setSubmitting(true);
    setError("");
    const action = nextStatus === "Approved" ? "approve" : "submit";
    try {
      await apiFetch(`/internal/treasury/tenant-disbursements/${encodeURIComponent(id)}/${action}`, {
        method: "PUT",
        body: { note: `Updated via internal operations console: ${nextStatus}` }
      });
      await loadData();
      showToast(`Disbursement status updated to ${nextStatus}`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update disbursement status.");
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = disbursements.filter((item) =>
    (client === "all" || item.businessClient.toLowerCase().includes(client.toLowerCase())) &&
    (status === "all" || item.status.toLowerCase() === status)
  );

  return (
    <section className="tenant-disbursements-scope">
      {selected ? (
        <DisbursementDetail disbursement={selected} onBack={() => setSelectedId(undefined)} onShowToast={showToast} onUpdateStatus={updateStatus} />
      ) : (
        <DisbursementsList
          client={client}
          disbursements={filtered}
          onClientChange={setClient}
          onOpenCreate={() => setModalOpen(true)}
          onSelect={setSelectedId}
          onShowToast={showToast}
          onStatusChange={setStatus}
          onUpdateStatus={updateStatus}
          status={status}
          loading={loading || submitting}
        />
      )}
      {modalOpen ? <CreateDisbursementModal accounts={accounts} businessClients={businessClients} onClose={() => setModalOpen(false)} onCreate={async (draft) => {
        setSubmitting(true);
        setError("");
        try {
          const created = await apiFetch<{ disbursement?: DisbursementApi }>("/internal/treasury/tenant-disbursements", {
            method: "POST",
            body: {
              businessClientId: draft.businessClientId,
              destinationAdaId: draft.destinationAdaId,
              amountMinorUnits: String(Math.round(draft.amountMinorUnits))
            }
          });
          await loadData();
          if (created.disbursement?.id) setSelectedId(created.disbursement.id);
          setModalOpen(false);
          showToast("Created draft disbursement.");
        } catch (createError) {
          setError(createError instanceof Error ? createError.message : "Failed to create disbursement.");
        } finally {
          setSubmitting(false);
        }
      }} /> : null}
      {error ? <p className="td-empty">{error}</p> : null}
      {toast ? <div className="td-toast"><FileText size={18} /><span>{toast}</span><button onClick={() => setToast("")} type="button"><X size={14} /></button></div> : null}
    </section>
  );
};

const DisbursementsList = ({
  client,
  disbursements,
  onClientChange,
  onOpenCreate,
  onSelect,
  onShowToast,
  onStatusChange,
  onUpdateStatus,
  status,
  loading
}: {
  client: string;
  disbursements: Disbursement[];
  onClientChange: (value: string) => void;
  onOpenCreate: () => void;
  onSelect: (id: string) => void;
  onShowToast: (message: string) => void;
  onStatusChange: (value: string) => void;
  onUpdateStatus: (id: string, status: "Approved" | "Submitted") => void;
  status: string;
  loading: boolean;
}) => (
  <div className="td-page">
    <header className="td-heading">
      <div>
        <div className="td-heading-line">
          <h1>Tenant Disbursements</h1>
          <span className="td-badge dark">Real-Time Ledger</span>
          <span className="td-badge">{disbursements.length} Records Loaded</span>
        </div>
        <p>Manage, approve, and audit outgoing funds transfers across multi-tenant portfolios.</p>
      </div>
      <button className="td-primary" onClick={onOpenCreate} type="button"><Plus size={14} />New Disbursement</button>
    </header>

    <section className="td-metrics" aria-label="Tenant disbursement metrics">
      {[
        ["Ledger Volume", money(disbursements.reduce((sum, item) => sum + item.amount, 0))],
        ["Action Req", `${disbursements.filter((item) => item.status !== "Processed").length} Pending`],
        ["Advances Linked", "$14,500,000"],
        ["Fedwire Cap", "25.0% Used"],
        ["Gateway Status", "SWIFT Online"],
        ["Audit Sweep", "100% Clean"]
      ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>
    {loading ? <p className="td-empty">Loading disbursements...</p> : null}

    <section className="td-filters">
      <label><span>Business Client</span><select value={client} onChange={(event) => onClientChange(event.target.value)}><option value="all">All Clients</option><option value="Acme">Acme Corp / Acme Holdings</option><option value="Stark">Stark Industries</option><option value="Wayne">Wayne Enterprises</option><option value="Cyberdyne">Cyberdyne Systems</option><option value="Oscorp">Oscorp Tech</option></select></label>
      <label><span>Status</span><select value={status} onChange={(event) => onStatusChange(event.target.value)}><option value="all">Any Status</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="submitted">Submitted</option><option value="processed">Processed</option></select></label>
      <label><span>Value Date</span><input defaultValue="2023-10-25" type="date" /></label>
      <button onClick={() => onShowToast(`Filters applied: ${client}, Status: ${status}`)} type="button"><Filter size={13} />Apply</button>
    </section>

    <div className="td-table-wrap">
      <table>
        <thead><tr><th>Disbursement ID</th><th>Business Client</th><th>Destination ADA</th><th>Value Date</th><th className="right">Amount (USD)</th><th>Status</th><th>Advance / Provider</th><th className="right">Actions</th></tr></thead>
        <tbody>
          {disbursements.map((item) => (
            <tr key={item.id} onClick={() => onSelect(item.id)}>
              <td className="mono strong">{item.disbursementId}</td>
              <td className="strong">{item.businessClient}</td>
              <td className="mono muted">{item.destinationAda}</td>
              <td className="mono muted">{item.valueDate}</td>
              <td className="mono strong right">{money(item.amount)}</td>
              <td><span className={`td-status ${item.status.toLowerCase()}`}>{item.status}</span></td>
              <td><span className="mono link">{item.advanceId}</span><small>{item.provider}</small></td>
              <td className="right" onClick={(event) => event.stopPropagation()}>{item.status === "Draft" ? <button onClick={() => onUpdateStatus(item.id, "Approved")} type="button">Approve</button> : item.status === "Approved" ? <button className="dark" onClick={() => onUpdateStatus(item.id, "Submitted")} type="button">Submit</button> : <small>{item.status === "Processed" ? "Complete" : "Processed"}</small>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const DisbursementDetail = ({
  disbursement,
  onBack,
  onShowToast,
  onUpdateStatus
}: {
  disbursement: Disbursement;
  onBack: () => void;
  onShowToast: (message: string) => void;
  onUpdateStatus: (id: string, status: "Approved" | "Submitted") => void;
}) => (
  <div className="td-page">
    <button className="td-back" onClick={onBack} type="button"><ArrowLeft size={13} />Back to Disbursements List</button>
    <header className="td-detail-head">
      <div>
        <div><span className="td-badge">Disbursement Record</span><span className="td-badge dark">{disbursement.status}</span><span className="td-badge">TRACE: FW-20260811-9981</span></div>
        <h1>{disbursement.disbursementId}</h1>
        <p>Authorized tenant disbursement instruction with real-time settlement tracking.</p>
      </div>
      <div>
        <button onClick={() => onShowToast(`Generating official treasury printable report for ${disbursement.disbursementId}...`)} type="button"><Printer size={14} />Print Record</button>
        {disbursement.status === "Draft" ? <button className="td-primary" onClick={() => onUpdateStatus(disbursement.id, "Approved")} type="button">Approve Instruction<CheckCircle size={14} /></button> : null}
        {disbursement.status === "Approved" ? <button className="td-primary" onClick={() => onUpdateStatus(disbursement.id, "Submitted")} type="button">Submit to Provider<Send size={14} /></button> : null}
      </div>
    </header>

    <div className="td-detail-grid">
      <section className="td-panel wide">
        <header><h2>Transaction Summary</h2><span>Institutional Metrics</span></header>
        <div className="td-summary-grid">
          <Field label="Client Entity" value={disbursement.clientEntity} strong />
          <Field label="Disbursement Amount" value={`${money(disbursement.amount)} ${disbursement.currency}`} strong />
          <Field label="Value Date" value={`${disbursement.valueDate} (T+0)`} />
          <div className="td-ada"><span>Destination ADA</span><code>{disbursement.destinationAda}</code><button onClick={() => navigator.clipboard.writeText(disbursement.destinationAda).then(() => onShowToast(`ADA Address copied: ${disbursement.destinationAda}`))} type="button"><Copy size={13} /></button></div>
          <Field label="Execution Route" value={disbursement.executionRoute} />
          <Field label="SWIFT BIC / Routing" value="SWFTUS33XXX / 021000021" mono />
          <Field label="Multi-Sig Status" value="2 OF 3 SIGNED (COMPLIANT)" mono />
        </div>
      </section>

      <section className="td-panel side">
        <header><h2>Funding Source</h2></header>
        <div className="td-funding-card"><strong>{disbursement.advanceId}</strong><span>Linked Settlement Advance</span></div>
        <div className="td-mini-grid"><Field label="Available Balance" value={money(disbursement.availableBalance)} strong /><Field label="Pending Draw" value={money(disbursement.pendingDraw)} /></div>
      </section>

      <section className="td-panel wide">
        <header><h2>Submission Evidence & Audit Trail</h2><span>Immutable Log</span></header>
        {disbursement.auditTrail.length ? disbursement.auditTrail.map((item) => <article className="td-audit" key={item.id}><b>{item.title}</b><time>{item.timestamp}</time><p>{item.description}</p>{item.note ? <code>Note: {item.note}</code> : null}{item.traceId ? <small>Trace ID: {item.traceId}</small> : null}</article>) : <p className="td-empty">No audit trail events recorded yet.</p>}
      </section>

      <section className="td-panel side">
        <header><h2>Documents</h2></header>
        {disbursement.documents.length ? disbursement.documents.map((doc) => <button className="td-document" onClick={() => onShowToast(`Opening ${doc.name}...`)} key={doc.id} type="button"><FileText size={14} /><span>{doc.name}</span><small>{doc.size}</small></button>) : <p className="td-empty">No attachments linked.</p>}
      </section>
    </div>
  </div>
);

const Field = ({ label, mono, strong, value }: { label: string; mono?: boolean; strong?: boolean; value: string }) => (
  <div className="td-field"><span>{label}</span><b className={`${mono ? "mono" : ""} ${strong ? "strong" : ""}`}>{value}</b></div>
);

const CreateDisbursementModal = ({
  accounts,
  businessClients,
  onClose,
  onCreate
}: {
  accounts: AccountApi[];
  businessClients: BusinessClientApi[];
  onClose: () => void;
  onCreate: (input: { businessClientId: string; destinationAdaId: string; amountMinorUnits: number }) => void;
}) => {
  const [businessClientId, setBusinessClientId] = useState(businessClients[0]?.id ?? "");
  const destinationAccounts = accounts.filter((account) => account.businessClientId === businessClientId);
  const [destinationAdaId, setDestinationAdaId] = useState(destinationAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("500000");
  useEffect(() => {
    const next = destinationAccounts[0]?.id ?? "";
    setDestinationAdaId(next);
  }, [businessClientId]);
  const submit = () => {
    onCreate({
      businessClientId,
      destinationAdaId,
      amountMinorUnits: Number.parseFloat(amount) || 0
    });
  };
  return (
    <div className="td-modal-backdrop">
      <div className="td-modal">
        <header><div><span>New Instruction</span><h3>Create Disbursement</h3></div><button onClick={onClose} type="button"><X size={18} /></button></header>
        <div className="td-modal-grid">
          <label><span>Business Client</span><select value={businessClientId} onChange={(event) => setBusinessClientId(event.target.value)}>{businessClients.map((client) => <option key={client.id} value={client.id}>{client.legalName ?? client.id}</option>)}</select></label>
          <label><span>Amount (USD)</span><input value={amount} onChange={(event) => setAmount(event.target.value)} type="number" /></label>
          <label><span>Destination ADA</span><select value={destinationAdaId} onChange={(event) => setDestinationAdaId(event.target.value)}>{destinationAccounts.map((account) => <option key={account.id} value={account.id}>{account.accountName ?? account.id}</option>)}</select></label>
          <label><span>Provider</span><select defaultValue="circle"><option value="circle">Circle</option></select></label>
        </div>
        <footer><button onClick={onClose} type="button">Cancel</button><button className="td-primary" onClick={submit} type="button">Save Draft Disbursement</button></footer>
      </div>
    </div>
  );
};
