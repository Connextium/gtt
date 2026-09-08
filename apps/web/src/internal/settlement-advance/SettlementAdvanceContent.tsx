import { ArrowLeft, CheckCircle2, Copy, Download, FileText, Filter, Info, Plus, RefreshCw, Search, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./settlement-advance-scope.css";

type TransferStatus = "RESERVED" | "DISBURSED" | "REQUESTED" | "CANCELLED";
type AuditEvent = { completed: boolean; id: string; subtitle: string; timestamp?: string; title: string };
type SettlementTransfer = {
  amount: number | null;
  auditTrail: AuditEvent[];
  currency: "USDC" | "USD";
  displayTitle?: string;
  expiry: string;
  fiatAccountId: string;
  id: string;
  initiatedAt: string;
  providerResponse?: Record<string, unknown>;
  repaymentStatus: string;
  status: TransferStatus;
  wireProofFileName?: string;
  wireProofUploaded?: boolean;
};

type SettlementAdvanceApi = {
  id: string;
  reserveAmountMinorUnits?: string;
  amountMinorUnits?: string;
  currency?: "USDC" | "USD";
  status?: string;
  expiresAt?: string;
  requestedAt?: string;
  disbursedAt?: string;
  repaymentStatus?: string;
  fiatAccountId?: string;
  providerPayload?: Record<string, unknown>;
  wireProofs?: Array<{ fileName?: string }>;
  createdAt?: string;
};

type CreditLineApi = {
  limitMinorUnits?: string;
  reservedMinorUnits?: string;
  availableMinorUnits?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

const formatMoney = (amount: number | null) => amount === null ? "--" : amount.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const formatTimestamp = (value?: string) => {
  if (!value) return "--";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : `${parsed.toLocaleString()} UTC`;
};

const toTransferStatus = (status?: string): TransferStatus => {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "funds_reserved") return "RESERVED";
  if (normalized === "requested") return "REQUESTED";
  if (normalized === "disbursed") return "DISBURSED";
  return "CANCELLED";
};

const mapTransfer = (transfer: SettlementAdvanceApi): SettlementTransfer => {
  const amountValue = Number(transfer.reserveAmountMinorUnits ?? transfer.amountMinorUnits ?? 0);
  const wireProofFileName = transfer.wireProofs?.[0]?.fileName;
  const status = toTransferStatus(transfer.status);
  return {
    id: transfer.id,
    displayTitle: transfer.id,
    status,
    amount: Number.isFinite(amountValue) ? amountValue : null,
    currency: transfer.currency === "USD" ? "USD" : "USDC",
    expiry: formatTimestamp(transfer.expiresAt),
    repaymentStatus: transfer.repaymentStatus ?? (status === "REQUESTED" ? "Pending" : "N/A"),
    fiatAccountId: transfer.fiatAccountId ?? "--",
    initiatedAt: formatTimestamp(transfer.createdAt),
    wireProofUploaded: Boolean(wireProofFileName),
    wireProofFileName,
    providerResponse: transfer.providerPayload,
    auditTrail: [
      {
        id: `${transfer.id}-status`,
        title: `Transfer ${status}`,
        subtitle: `Last updated ${formatTimestamp(transfer.requestedAt ?? transfer.disbursedAt ?? transfer.createdAt)}`,
        completed: true
      }
    ]
  };
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT";
    body?: Record<string, unknown>;
  } = {}
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "idempotency-key": `internal-${crypto.randomUUID()}`
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
};

export const SettlementAdvanceContent = () => {
  const [transfers, setTransfers] = useState<SettlementTransfer[]>([]);
  const [creditLine, setCreditLine] = useState<CreditLineApi>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<TransferStatus | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [reserveModalOpen, setReserveModalOpen] = useState(false);
  const [requestTransfer, setRequestTransfer] = useState<SettlementTransfer | undefined>();
  const [cancelTransfer, setCancelTransfer] = useState<SettlementTransfer | undefined>();

  const loadSettlementData = async () => {
    setLoading(true);
    setError("");
    try {
      const [transferResponse, creditLineResponse] = await Promise.all([
        apiFetch<{ transfers?: SettlementAdvanceApi[] }>("/internal/treasury/settlement-advance"),
        apiFetch<CreditLineApi>("/internal/treasury/credit-line")
      ]);
      setTransfers((transferResponse.transfers ?? []).map(mapTransfer));
      setCreditLine(creditLineResponse);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load settlement advances.");
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedTransfer = async (transferId: string) => {
    try {
      const response = await apiFetch<{ transfer?: SettlementAdvanceApi }>(`/internal/treasury/settlement-advance/${encodeURIComponent(transferId)}`);
      if (!response.transfer) return;
      setTransfers((current) => current.map((item) => item.id === transferId ? mapTransfer(response.transfer!) : item));
    } catch {
      // Non-blocking detail refresh.
    }
  };

  useEffect(() => {
    void loadSettlementData();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    void refreshSelectedTransfer(selectedId);
  }, [selectedId]);

  const selectedTransfer = transfers.find((item) => item.id === selectedId);
  const facilityLimit = Number(creditLine.limitMinorUnits ?? 0);
  const reservedFunds = Number(creditLine.reservedMinorUnits ?? 0);
  const availableCapacity = Number(creditLine.availableMinorUnits ?? Math.max(0, facilityLimit - reservedFunds));
  const filtered = useMemo(() => transfers.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    const normalized = search.trim().toLowerCase();
    if (!normalized) return true;
    return [item.id, item.displayTitle ?? "", item.fiatAccountId].some((value) => value.toLowerCase().includes(normalized));
  }), [search, statusFilter, transfers]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 3000);
  };

  const requestFunds = async (transfer: SettlementTransfer) => {
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/internal/treasury/settlement-advance/${encodeURIComponent(transfer.id)}/request`, {
        method: "PUT",
        body: { providerTransferId: `manual-${transfer.id}-${Date.now()}` }
      });
      await loadSettlementData();
      showToast(`Funds requested for ${transfer.displayTitle ?? transfer.id}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to request settlement advance.");
    } finally {
      setSubmitting(false);
      setRequestTransfer(undefined);
    }
  };

  const cancelReserve = async (transfer: SettlementTransfer) => {
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/internal/treasury/settlement-advance/${encodeURIComponent(transfer.id)}/cancel`, {
        method: "PUT",
        body: { note: "Cancelled by internal operations" }
      });
      if (selectedId === transfer.id) setSelectedId(undefined);
      await loadSettlementData();
      showToast(`Reserve cancelled for ${transfer.displayTitle ?? transfer.id}.`);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "Failed to cancel settlement advance.");
    } finally {
      setSubmitting(false);
      setCancelTransfer(undefined);
    }
  };

  const uploadWireProof = async (id: string, fileName: string) => {
    if (!fileName) {
      showToast("Wire proof removal is not supported via API.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await apiFetch(`/internal/treasury/settlement-advance/${encodeURIComponent(id)}/request`, {
        method: "PUT",
        body: {
          fileName,
          mimeType: "application/pdf",
          note: "Wire proof uploaded from operations console"
        }
      });
      await loadSettlementData();
      await refreshSelectedTransfer(id);
      showToast(`Wire proof uploaded: ${fileName}.`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Failed to upload wire proof.");
    } finally {
      setSubmitting(false);
    }
  };

  const createReserve = async (input: { amount: number; currency: "USDC" | "USD"; expiry: string; fiatAccountId: string }) => {
    setSubmitting(true);
    setError("");
    try {
      await apiFetch("/internal/treasury/settlement-advance/reserve", {
        method: "POST",
        body: {
          amountMinorUnits: String(Math.round(input.amount)),
          currency: input.currency,
          fiatAccountId: input.fiatAccountId,
          expiresAt: input.expiry
        }
      });
      await loadSettlementData();
      setReserveModalOpen(false);
      showToast("Settlement advance reserved.");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to reserve settlement advance.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="settlement-advance-scope">
      {toast ? <div className="sa-toast"><span />{toast}<button onClick={() => setToast("")} type="button"><X size={14} /></button></div> : null}
      {selectedTransfer ? (
        <TransferDetail
          onBack={() => setSelectedId(undefined)}
          onCancelReserve={setCancelTransfer}
          onRequestFunds={setRequestTransfer}
          onUploadWireProof={uploadWireProof}
          transfer={selectedTransfer}
        />
      ) : (
        <Dashboard
          availableCapacity={availableCapacity}
          facilityLimit={facilityLimit}
          filterOpen={filterOpen}
          loading={loading || submitting}
          onCancelReserve={setCancelTransfer}
          onExport={() => showToast("Exported Settlement Advance transfers to CSV.")}
          onOpenReserve={() => setReserveModalOpen(true)}
          onRefresh={() => void loadSettlementData()}
          onRequestFunds={setRequestTransfer}
          onSelect={(transfer) => setSelectedId(transfer.id)}
          reservedFunds={reservedFunds}
          search={search}
          setFilterOpen={setFilterOpen}
          setSearch={setSearch}
          setStatusFilter={setStatusFilter}
          statusFilter={statusFilter}
          transfers={filtered}
        />
      )}
      {reserveModalOpen ? <ReserveCapacityModal availableCapacity={availableCapacity} onClose={() => setReserveModalOpen(false)} onSave={createReserve} /> : null}
      {requestTransfer ? <ConfirmModal action="Request Funds" description="This will move the reserve into provider funding request state." onClose={() => setRequestTransfer(undefined)} onConfirm={() => requestFunds(requestTransfer)} title={requestTransfer.displayTitle ?? requestTransfer.id} /> : null}
      {cancelTransfer ? <ConfirmModal action="Cancel Reserve" danger description="This will remove the reserve capacity record from the active ledger." onClose={() => setCancelTransfer(undefined)} onConfirm={() => cancelReserve(cancelTransfer)} title={cancelTransfer.displayTitle ?? cancelTransfer.id} /> : null}
      {error ? <p className="sa-error">{error}</p> : null}
    </section>
  );
};

const Dashboard = ({
  availableCapacity,
  facilityLimit,
  filterOpen,
  loading,
  onCancelReserve,
  onExport,
  onOpenReserve,
  onRefresh,
  onRequestFunds,
  onSelect,
  reservedFunds,
  search,
  setFilterOpen,
  setSearch,
  setStatusFilter,
  statusFilter,
  transfers
}: {
  availableCapacity: number;
  facilityLimit: number;
  filterOpen: boolean;
  loading: boolean;
  onCancelReserve: (transfer: SettlementTransfer) => void;
  onExport: () => void;
  onOpenReserve: () => void;
  onRefresh: () => void;
  onRequestFunds: (transfer: SettlementTransfer) => void;
  onSelect: (transfer: SettlementTransfer) => void;
  reservedFunds: number;
  search: string;
  setFilterOpen: (open: boolean) => void;
  setSearch: (value: string) => void;
  setStatusFilter: (status: TransferStatus | "ALL") => void;
  statusFilter: TransferStatus | "ALL";
  transfers: SettlementTransfer[];
}) => (
  <div className="sa-page">
    <header className="sa-heading">
      <div><h1>Settlement Advance</h1><p>Manage liquidity provisions and intraday credit facilities.</p></div>
      <div><button onClick={onRefresh} type="button"><RefreshCw size={14} />Refresh</button><button className="primary" onClick={onOpenReserve} type="button"><Plus size={14} />Reserve Capacity</button></div>
    </header>
    <section className="sa-summary">
      <Metric label="Status / Currency" value="Active - USDC" />
      <Metric label="Facility Limit" mono value={formatMoney(facilityLimit)} />
      <Metric label="Reserved Funds" mono value={formatMoney(reservedFunds)} />
      <Metric label="Available Capacity" mono strong value={formatMoney(availableCapacity)} />
    </section>
    <section className="sa-panel">
      <header><h2>Settlement Advance Transfers</h2><div><button onClick={() => setFilterOpen(!filterOpen)} type="button"><Filter size={14} />Filter</button><button onClick={onExport} type="button"><Download size={14} />Export</button></div></header>
      {filterOpen ? <div className="sa-filters"><label><Search size={14} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search Transfer ID, Title, or Account ID..." value={search} /></label><div>{(["ALL", "RESERVED", "DISBURSED", "REQUESTED", "CANCELLED"] as const).map((status) => <button className={statusFilter === status ? "active" : ""} key={status} onClick={() => setStatusFilter(status)} type="button">{status}</button>)}</div></div> : null}
      {loading ? <p className="sa-confirm-copy">Loading settlement advance transfers...</p> : null}
      <div className="sa-table-wrap"><table><thead><tr><th>Transfer ID</th><th>Status</th><th className="right">Reserve Amount (USDC)</th><th className="right">Expiry</th><th>Repayment Status</th><th className="right">Actions</th></tr></thead><tbody>{transfers.map((transfer) => <tr key={transfer.id} onClick={() => onSelect(transfer)}><td><b>{transfer.id}</b>{transfer.displayTitle ? <small>({transfer.displayTitle})</small> : null}</td><td><StatusBadge status={transfer.status} /></td><td className="right mono">{formatMoney(transfer.amount)}</td><td className="right">{transfer.expiry}</td><td>{transfer.repaymentStatus}</td><td className="right" onClick={(event) => event.stopPropagation()}>{transfer.status === "RESERVED" ? <><button onClick={() => onRequestFunds(transfer)} type="button">Request</button><button onClick={() => onCancelReserve(transfer)} type="button">Cancel</button></> : null}{transfer.status === "REQUESTED" ? <button onClick={() => onCancelReserve(transfer)} type="button">Cancel</button> : null}<button onClick={() => onSelect(transfer)} type="button">Details</button></td></tr>)}</tbody></table></div>
    </section>
  </div>
);

const TransferDetail = ({ onBack, onCancelReserve, onRequestFunds, onUploadWireProof, transfer }: { onBack: () => void; onCancelReserve: (transfer: SettlementTransfer) => void; onRequestFunds: (transfer: SettlementTransfer) => void; onUploadWireProof: (id: string, fileName: string) => void; transfer: SettlementTransfer }) => {
  const [copied, setCopied] = useState(false);
  const providerJson = JSON.stringify(transfer.providerResponse ?? { data: { amount: transfer.amount?.toFixed(2) ?? "0.00", currency: transfer.currency, id: `res_${transfer.id.toLowerCase()}`, status: transfer.status.toLowerCase() } }, null, 2);
  const copyJson = () => {
    void navigator.clipboard.writeText(providerJson).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="sa-page">
      <button className="sa-back" onClick={onBack} type="button"><ArrowLeft size={14} />Back to Settlement Advances</button>
      <header className="sa-heading detail"><div><span>Settlement Advance</span><StatusBadge status={transfer.status} /><h1>{transfer.displayTitle ?? transfer.id}</h1><p>Initiated {transfer.initiatedAt} - Ref: {transfer.id}</p></div><div>{transfer.status === "RESERVED" ? <><button onClick={() => onCancelReserve(transfer)} type="button">Cancel Reserve</button><button className="primary" onClick={() => onRequestFunds(transfer)} type="button">Request Funds</button></> : null}{transfer.status === "REQUESTED" ? <button className="danger" onClick={() => onCancelReserve(transfer)} type="button">Cancel Request</button> : null}{transfer.status === "DISBURSED" ? <span className="sa-settled"><CheckCircle2 size={14} />Funds Disbursed & Settled</span> : null}</div></header>
      <div className="sa-detail-grid">
        <main>
          <section className="sa-panel plain"><header><h2>Reserve Details</h2></header><div className="sa-detail-fields"><Field label="Amount" value={`$${formatMoney(transfer.amount)} ${transfer.currency}`} big /><Field label="Expiry" value={transfer.expiry} mono /><Field label="Fiat Account ID" value={transfer.fiatAccountId} mono wide /></div></section>
          <section className="sa-panel plain"><header><h2>Wire Proof Evidence</h2><span>{transfer.wireProofUploaded ? "Verified Attachment" : "Pending Upload"}</span></header>{transfer.wireProofUploaded ? <div className="sa-proof"><FileText size={20} /><div><b>{transfer.wireProofFileName ?? "MT103_Bank_Confirmation.pdf"}</b><small>Uploaded - Verified by Institutional Compliance</small></div><button type="button"><Download size={14} /></button><button onClick={() => onUploadWireProof(transfer.id, "")} type="button"><Trash2 size={14} /></button></div> : <label className="sa-upload"><input accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUploadWireProof(transfer.id, file.name); }} type="file" /><Upload size={30} /><b>Upload MT103 or Bank Confirmation</b><small>PDF, JPG, or PNG (Max 10MB)</small></label>}</section>
        </main>
        <aside>
          <section className="sa-provider"><header><span>Circle API Response</span><b>200 OK</b><button onClick={copyJson} type="button"><Copy size={13} /></button></header>{copied ? <small>Payload copied to clipboard.</small> : null}<pre>{providerJson}</pre></section>
          <div className="sa-info"><Info size={14} /><p>Funds are reserved on the provider side pending final wire confirmation.</p></div>
          <section className="sa-panel plain"><header><h2>Audit Trail</h2></header><div className="sa-audit">{transfer.auditTrail.map((event) => <article key={event.id}><span className={event.completed ? "done" : ""} /><div><b>{event.title}</b><p>{event.subtitle}</p></div></article>)}</div></section>
        </aside>
      </div>
    </div>
  );
};

const Metric = ({ label, mono, strong, value }: { label: string; mono?: boolean; strong?: boolean; value: string }) => <article><span>{label}</span><strong className={`${mono ? "mono" : ""} ${strong ? "strong" : ""}`}>{value}</strong></article>;
const Field = ({ big, label, mono, value, wide }: { big?: boolean; label: string; mono?: boolean; value: string; wide?: boolean }) => <div className={wide ? "wide" : ""}><span>{label}</span><b className={`${mono ? "mono" : ""} ${big ? "big" : ""}`}>{value}</b></div>;
const StatusBadge = ({ status }: { status: TransferStatus }) => <span className={`sa-status ${status.toLowerCase()}`}>{status === "REQUESTED" ? <RefreshCw size={10} /> : null}{status}</span>;

const ReserveCapacityModal = ({ availableCapacity, onClose, onSave }: { availableCapacity: number; onClose: () => void; onSave: (input: { amount: number; currency: "USDC" | "USD"; expiry: string; fiatAccountId: string }) => void }) => {
  const [amount, setAmount] = useState("2000000.00");
  const [currency, setCurrency] = useState<"USDC" | "USD">("USDC");
  const [expiry, setExpiry] = useState(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  const [fiatAccountId, setFiatAccountId] = useState("ACC-US-9982-FX-44A");
  const [error, setError] = useState("");
  const submit = () => {
    const parsed = Number.parseFloat(amount.replace(/,/g, ""));
    if (!Number.isFinite(parsed) || parsed <= 0) return setError("Please enter a valid positive numeric reserve amount.");
    if (parsed > availableCapacity) return setError(`Requested amount exceeds available credit facility capacity ($${formatMoney(availableCapacity)}).`);
    onSave({ amount: parsed, currency, expiry, fiatAccountId });
  };
  return <div className="sa-modal-backdrop"><div className="sa-modal"><header><div><h3>Reserve Capacity</h3><p>Initiate a new intraday settlement advance reservation.</p></div><button onClick={onClose} type="button"><X size={18} /></button></header>{error ? <div className="sa-error">{error}</div> : null}<div className="sa-modal-grid"><label><span>Reserve Amount</span><input onChange={(event) => setAmount(event.target.value)} value={amount} /></label><label><span>Currency</span><select onChange={(event) => setCurrency(event.target.value as "USDC" | "USD")} value={currency}><option>USDC</option><option>USD</option></select></label><label><span>Expiry Timestamp (UTC)</span><input onChange={(event) => setExpiry(event.target.value)} value={expiry} /></label><label><span>Fiat Account ID</span><select onChange={(event) => setFiatAccountId(event.target.value)} value={fiatAccountId}><option value="ACC-US-9982-FX-44A">ACC-US-9982-FX-44A (Circle Main Treasury)</option><option value="ACC-US-9982-FX-12B">ACC-US-9982-FX-12B (JPMorgan Operating Account)</option><option value="ACC-US-7731-FX-89C">ACC-US-7731-FX-89C (BNY Mellon Liquidity Pool)</option></select></label><div className="sa-capacity"><span>Available Capacity:</span><b>${formatMoney(availableCapacity)}</b></div></div><footer><button onClick={onClose} type="button">Cancel</button><button className="primary" onClick={submit} type="button"><Plus size={14} />Confirm Reserve</button></footer></div></div>;
};

const ConfirmModal = ({ action, danger, description, onClose, onConfirm, title }: { action: string; danger?: boolean; description: string; onClose: () => void; onConfirm: () => void; title: string }) => (
  <div className="sa-modal-backdrop"><div className="sa-modal small"><header><div><h3>{action}</h3><p>{title}</p></div><button onClick={onClose} type="button"><X size={18} /></button></header><p className="sa-confirm-copy">{description}</p><footer><button onClick={onClose} type="button">Cancel</button><button className={danger ? "danger" : "primary"} onClick={onConfirm} type="button">{action}</button></footer></div></div>
);
