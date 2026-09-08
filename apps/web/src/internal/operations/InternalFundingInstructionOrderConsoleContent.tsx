import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Clock3,
  Download,
  Filter,
  Hourglass,
  Plus,
  RefreshCw,
  TrendingUp
} from "lucide-react";
import "./internal-funding-instruction-order-console-scope.css";

type FundingInstructionApi = {
  id: string;
  instructionRole?: string;
  sourceAccountOfDigitalAssetId?: string;
  destinationAccountOfDigitalAssetId?: string;
  businessClientId?: string;
  fundingType?: string;
  amountMinorUnits?: string;
  assetCode?: string;
  currency?: string;
  status?: string;
  provider?: string;
  providerReferenceId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  pendingUsdcMinorUnits?: string;
  availableUsdcMinorUnits?: string;
  createdAt?: string;
  updatedAt?: string;
};

type FundingInstructionOrderApi = {
  id: string;
  orderKind?: string;
  dependencyOrderId?: string;
  amountMinorUnits?: string;
  currency?: string;
  status?: string;
  providerReferenceId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type AccountApi = {
  id: string;
  accountName?: string;
  assetCode?: string;
};

type LinkedInstrumentsSummary = {
  fiatLinks?: Array<{
    id?: string;
    bankName?: string;
    purpose?: string;
    status?: string;
  }>;
};

type MintResultApi = {
  id?: string;
  status?: string;
  wireAccountId?: string;
  targetAccountOfDigitalAssetId?: string;
  amountMinorUnits?: string;
  createdAt?: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

const lifecycleLabels = [
  "Created",
  "Route Resolved",
  "Pending Provider",
  "Pending Confirmation",
  "Pending USDC Reserved",
  "Confirmed",
  "Posted Available",
  "Failed Or Exception"
];

const internalMintLifecycleLabels = [
  "Created",
  "Route Resolved",
  "Pending Provider",
  "Confirmed",
  "Posted Available",
  "Failed Or Exception"
];

export const InternalFundingInstructionOrderConsoleContent = ({
  fundingInstructionId,
  navigate
}: {
  fundingInstructionId?: string;
  navigate: (path: string) => void;
}) => {
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [instructions, setInstructions] = useState<FundingInstructionApi[]>([]);
  const [accounts, setAccounts] = useState<AccountApi[]>([]);
  const [selectedInstruction, setSelectedInstruction] = useState<FundingInstructionApi | null>(null);
  const [orders, setOrders] = useState<FundingInstructionOrderApi[]>([]);
  const [sourceMintWireId, setSourceMintWireId] = useState<string | null>(null);
  const [requestingMint, setRequestingMint] = useState(false);
  const [mintProgressPhase, setMintProgressPhase] = useState<"submitting" | "refreshing">("submitting");
  const [requestedMint, setRequestedMint] = useState<MintResultApi | null>(null);
  const [mintSuccessToast, setMintSuccessToast] = useState<string | null>(null);
  const mintSuccessToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (mintSuccessToastTimerRef.current !== null) {
        window.clearTimeout(mintSuccessToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    void loadRegistry();
  }, []);

  useEffect(() => {
    if (!fundingInstructionId) {
      setSelectedInstruction(null);
      setOrders([]);
      setSourceMintWireId(null);
      setRequestedMint(null);
      return;
    }
    void loadDetail(fundingInstructionId);
    void loadOrders(fundingInstructionId);
  }, [fundingInstructionId]);

  useEffect(() => {
    const sourceAccountId = selectedInstruction?.sourceAccountOfDigitalAssetId;
    if (!sourceAccountId) {
      setSourceMintWireId(null);
      return;
    }
    void loadSourceMintWire(sourceAccountId);
  }, [selectedInstruction?.sourceAccountOfDigitalAssetId]);

  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, `${account.accountName?.trim() || "ADA"} (${account.assetCode?.trim() || "USDC"})`])),
    [accounts]
  );

  const stats = useMemo(() => {
    const activeInstructions = instructions.filter((item) => !isTerminalStatus(item.status)).length;
    const settledInstructions = instructions.filter((item) => {
      const status = normalizeStatus(item.status);
      return status === "completed" || status === "posted_available" || status === "available";
    }).length;
    const pendingProvider = instructions.filter((item) => normalizeStatus(item.status) === "pending_provider").length;
    const pendingLedger = instructions.filter((item) => {
      const status = normalizeStatus(item.status);
      return status === "pending_confirmation" || status === "pending_usdc_reserved" || status === "confirmed";
    }).length;
    const throughputMinor = instructions.reduce((sum, item) => sum + parseMinorUnits(item.amountMinorUnits), 0n);
    return {
      activeInstructions,
      settledInstructions,
      pendingProvider,
      pendingLedger,
      throughputMinor
    };
  }, [instructions]);

  const filteredInstructions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return instructions.filter((instruction) => {
      const status = normalizeStatus(instruction.status);
      const statusMatches = statusFilter === "ALL" || status === statusFilter;
      if (!statusMatches) return false;

      if (normalizedQuery.length === 0) return true;

      const sourceLabel = accountNameById.get(instruction.sourceAccountOfDigitalAssetId ?? "") ?? instruction.sourceAccountOfDigitalAssetId ?? "";
      const destinationLabel = accountNameById.get(instruction.destinationAccountOfDigitalAssetId ?? "") ?? instruction.destinationAccountOfDigitalAssetId ?? "";
      const fields = [
        instruction.id,
        sourceLabel,
        destinationLabel,
        instruction.providerReferenceId,
        instruction.idempotencyKey,
        instruction.correlationId,
        instruction.instructionRole,
        formatStatusLabel(instruction.status ?? "pending_provider")
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.toLowerCase());

      return fields.some((value) => value.includes(normalizedQuery));
    });
  }, [accountNameById, instructions, searchQuery, statusFilter]);

  const providerEventId = useMemo(
    () => selectedInstruction?.providerReferenceId ?? orders[0]?.providerReferenceId,
    [orders, selectedInstruction?.providerReferenceId]
  );

  const detailEventType = useMemo(() => {
    if (normalizeStatus(selectedInstruction?.instructionRole) === "internal_treasury_mint") {
      return "internal_mint_funding";
    }
    return "client_exchange_funding";
  }, [selectedInstruction?.instructionRole]);

  const canRequestMint = useMemo(() => {
    if (!selectedInstruction) return false;
    const isInternalMint = normalizeStatus(selectedInstruction.instructionRole) === "internal_treasury_mint";
    if (!isInternalMint) return false;
    if (!sourceMintWireId) return false;
    return mintRequestAllowedStatus(normalizeStatus(selectedInstruction.status));
  }, [selectedInstruction, sourceMintWireId]);

  const detailStages = useMemo(
    () => buildExecutionStages(selectedInstruction),
    [selectedInstruction]
  );

  const detailTraceEvents = useMemo(
    () => buildTraceEvents(selectedInstruction, orders),
    [orders, selectedInstruction]
  );

  const loadRegistry = async () => {
    setLoading(true);
    setError("");
    try {
      const [fundingResponse, accountsResponse] = await Promise.all([
        apiFetch<{ fundingInstructions?: FundingInstructionApi[] }>("/funding-instructions"),
        apiFetch<{ accounts?: AccountApi[] }>("/accounts-of-digital-asset")
      ]);
      const sorted = [...(fundingResponse.fundingInstructions ?? [])].sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
        const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;
        return rightTime - leftTime;
      });
      setInstructions(sorted);
      setAccounts(accountsResponse.accounts ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_order_console_load_failed");
      setInstructions([]);
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (id: string) => {
    setDetailLoading(true);
    setError("");
    try {
      const response = await apiFetch<{ fundingInstruction?: FundingInstructionApi }>(`/funding-instructions/${encodeURIComponent(id)}`);
      setSelectedInstruction(response.fundingInstruction ?? null);
    } catch (caught) {
      setSelectedInstruction(null);
      setError(caught instanceof Error ? caught.message : "funding_instruction_detail_load_failed");
    } finally {
      setDetailLoading(false);
    }
  };

  const loadOrders = async (id: string) => {
    setOrdersLoading(true);
    setError("");
    try {
      const response = await apiFetch<{ orders?: FundingInstructionOrderApi[] }>(`/funding-instructions/${encodeURIComponent(id)}/orders`);
      setOrders(response.orders ?? []);
    } catch (caught) {
      setOrders([]);
      setError(caught instanceof Error ? caught.message : "funding_instruction_orders_load_failed");
    } finally {
      setOrdersLoading(false);
    }
  };

  const loadSourceMintWire = async (sourceAccountId: string) => {
    try {
      const response = await apiFetch<LinkedInstrumentsSummary>(`/accounts-of-digital-asset/${encodeURIComponent(sourceAccountId)}/linked-instruments`);
      const wire = (response.fiatLinks ?? []).find((link) => {
        const purpose = normalizeStatus(link.purpose);
        const status = normalizeStatus(link.status);
        return Boolean(link.id)
          && (purpose === "minting" || purpose === "bidirectional")
          && (status === "active" || status === "verified");
      });
      setSourceMintWireId(wire?.id ?? null);
    } catch {
      setSourceMintWireId(null);
    }
  };

  const requestMint = async () => {
    if (!selectedInstruction || !canRequestMint || requestingMint) return;
    if (!sourceMintWireId) {
      setError("source_minting_wire_not_found");
      return;
    }
    if (!selectedInstruction.destinationAccountOfDigitalAssetId) {
      setError("destination_account_required");
      return;
    }
    if (!selectedInstruction.amountMinorUnits) {
      setError("amount_minor_units_required");
      return;
    }

    setRequestingMint(true);
    setMintProgressPhase("submitting");
    setError("");
    setMintSuccessToast(null);
    setRequestedMint(null);
    let mintRequestSucceeded = false;
    try {
      const payload = await apiFetch<{ mint?: MintResultApi }>(`/fiat/wire-accounts/${encodeURIComponent(sourceMintWireId)}/mint`, {
        method: "POST",
        body: {
          fundingInstructionId: selectedInstruction.id,
          targetAccountOfDigitalAssetId: selectedInstruction.destinationAccountOfDigitalAssetId,
          amountMinorUnits: selectedInstruction.amountMinorUnits
        }
      });
      setRequestedMint(payload.mint ?? null);
      if (fundingInstructionId) {
        setMintProgressPhase("refreshing");
        await Promise.all([loadDetail(fundingInstructionId), loadOrders(fundingInstructionId)]);
      }
      mintRequestSucceeded = true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "mint_request_failed");
    } finally {
      setRequestingMint(false);
      setMintProgressPhase("submitting");
      if (mintRequestSucceeded) {
        if (mintSuccessToastTimerRef.current !== null) {
          window.clearTimeout(mintSuccessToastTimerRef.current);
        }
        setMintSuccessToast("Mint request submitted successfully.");
        mintSuccessToastTimerRef.current = window.setTimeout(() => {
          setMintSuccessToast(null);
          mintSuccessToastTimerRef.current = null;
        }, 2600);
      }
    }
  };

  if (fundingInstructionId) {
    return (
      <section className="ifoc-page ifoc-detail-page">
        {requestingMint ? (
          <div aria-live="polite" className="ifoc-progress-overlay" role="status">
            <div className="ifoc-progress-panel">
              <div className="ifoc-progress-head">
                <RefreshCw className="ifoc-progress-spin" size={16} />
                <strong>{mintProgressPhase === "submitting" ? "Request Mint In Progress" : "Syncing Instruction State"}</strong>
              </div>
              <p>
                {mintProgressPhase === "submitting"
                  ? "Submitting mint request to provider and creating execution evidence."
                  : "Refreshing lifecycle and order orchestration after provider request."}
              </p>
              <div aria-hidden="true" className="ifoc-progress-track">
                <span className="ifoc-progress-indicator" />
              </div>
            </div>
          </div>
        ) : null}

        {mintSuccessToast ? (
          <div aria-live="polite" className="ifoc-success-toast" role="status">
            <CheckCircle2 size={14} />
            <span>{mintSuccessToast}</span>
          </div>
        ) : null}

        <header className="ifoc-detail-header">
          <div className="ifoc-detail-title-row">
            <div>
              <p className="ifoc-title-inline">
                <span className="ifoc-eyebrow">Internal Treasury Mint Instruction</span>
                <span className="ifoc-inline-sep">/</span>
                <span className="ifoc-instruction-id">{selectedInstruction?.id ?? fundingInstructionId}</span>
              </p>
              <span className={`ifoc-status-chip ${statusToneClass(selectedInstruction?.status)}`}>
                {formatStatus(selectedInstruction?.status ?? "pending_provider")}
              </span>
            </div>
            <div className="ifoc-key-grid">
              <div>
                <span>Correlation ID</span>
                <strong>{selectedInstruction?.correlationId ?? "Unavailable"}</strong>
              </div>
              <div>
                <span>Idempotency Key</span>
                <strong>{selectedInstruction?.idempotencyKey ?? "Unavailable"}</strong>
              </div>
            </div>
          </div>
        </header>

        {detailLoading ? <p className="ifoc-empty">Loading funding instruction detail...</p> : null}

        {!detailLoading && selectedInstruction ? (
          <div className="ifoc-detail-grid">
            <div className="ifoc-left-col">
              <article className="ifoc-card ifoc-transfer-strip">
                <div className="ifoc-transfer-node">
                  <span>Origin ADA Vault</span>
                  <strong>{accountNameById.get(selectedInstruction.sourceAccountOfDigitalAssetId ?? "") ?? (selectedInstruction.sourceAccountOfDigitalAssetId ?? "-")}</strong>
                </div>
                <div className="ifoc-transfer-center">
                  <span>{formatMinorUnits(selectedInstruction.amountMinorUnits)} USDC</span>
                  <small>PAR CLEARING</small>
                </div>
                <div className="ifoc-transfer-node">
                  <span>Destination Clearing Node</span>
                  <strong>{accountNameById.get(selectedInstruction.destinationAccountOfDigitalAssetId ?? "") ?? (selectedInstruction.destinationAccountOfDigitalAssetId ?? "-")}</strong>
                </div>
              </article>

              <article className="ifoc-card ifoc-pipeline-card">
                <h2>Execution Pipeline Sequence & Invariants</h2>
                <div className="ifoc-stage-list">
                  {detailStages.map((stage, index) => (
                    <div key={stage.label} className={`ifoc-stage-item ${stage.tone}`}>
                      <div className="ifoc-stage-marker">{index + 1}</div>
                      <div className="ifoc-stage-copy">
                        <strong>{stage.label}</strong>
                        <p>{stage.detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="ifoc-card ifoc-trace-console">
                <div className="ifoc-trace-head">
                  <span className="ifoc-trace-live" aria-hidden="true" />
                  <strong>Real-Time Memory Bus Telemetry Stream</strong>
                  <small>BUFFER: {detailTraceEvents.length} EVENTS</small>
                </div>
                <div className="ifoc-trace-body">
                  {detailTraceEvents.map((event, index) => (
                    <div key={`${event.timestamp}-${event.category}-${index}`} className={event.highlight ? "ifoc-trace-line highlight" : "ifoc-trace-line"}>
                      <span>[{event.timestamp}]</span>
                      <span>{event.thread}</span>
                      <strong>[{event.category}]</strong>
                      <span>{event.message}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="ifoc-card ifoc-muted">
                <h2>Order Orchestration Timeline</h2>
                {ordersLoading ? <p className="ifoc-empty">Loading orders...</p> : null}
                {!ordersLoading && orders.length === 0 ? <p className="ifoc-empty">No orders recorded for this instruction.</p> : null}
                {!ordersLoading && orders.length > 0 ? (
                  <div className="ifoc-order-list">
                    {orders.map((order, index) => (
                      <div key={order.id} className="ifoc-order-item">
                        <div className="ifoc-order-head">
                          <span className="ifoc-order-index">Sub-Order {index + 1}</span>
                          <span className={`ifoc-status-chip ${statusToneClass(order.status)}`}>
                            {formatStatus(order.status ?? "pending_provider")}
                          </span>
                        </div>
                        <div className="ifoc-order-kv">
                          <p><span>Sub-Order Reference</span><strong>{formatStatus(order.orderKind ?? "order")}</strong></p>
                          <p><span>Provider Ref</span><strong>{order.providerReferenceId ?? "Pending"}</strong></p>
                          <p><span>Status</span><strong>{formatStatus(order.status ?? "pending_provider")}</strong></p>
                          <p><span>Settlement Timestamp</span><strong>{formatTimestamp(order.updatedAt ?? order.createdAt)}</strong></p>
                        </div>
                        <p className="ifoc-order-amount">Amount: {formatMinorUnits(order.amountMinorUnits)} {(order.currency ?? "USD").toUpperCase()}</p>
                        {order.dependencyOrderId ? <p>Dependency: {order.dependencyOrderId}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            </div>

            <div className="ifoc-right-col">
              <article className="ifoc-card ifoc-hsm-card">
                <h2>Cryptographic Proof & HSM Quorum</h2>
                <div className="ifoc-hsm-grid">
                  <div>
                    <span>Threshold</span>
                    <strong>3 of 5 ECDSA Shares</strong>
                  </div>
                  <div>
                    <span>Provider Event</span>
                    <strong>{providerEventId ?? "Pending"}</strong>
                  </div>
                </div>
                <ul className="ifoc-hsm-nodes">
                  <li className="done"><span>Node Alpha</span><strong>Signed</strong></li>
                  <li className="done"><span>Node Beta</span><strong>Signed</strong></li>
                  <li className={isTerminalStatus(selectedInstruction.status) ? "done" : "current"}><span>Node Gamma</span><strong>{isTerminalStatus(selectedInstruction.status) ? "Signed" : "Signing"}</strong></li>
                </ul>
              </article>

              <article className="ifoc-card">
                <div className="ifoc-card-header-row">
                  <h2>Funding Accounting Evidence</h2>
                  <span className="ifoc-verified"><CheckCircle2 size={14} /> Verified Balanced</span>
                </div>
                <div className="ifoc-evidence-grid ifoc-evidence-grid-primary">
                  <div>
                    <span>Webhook Event ID</span>
                    <strong>Pending Capture</strong>
                  </div>
                  <div>
                    <span>Provider Event ID</span>
                    <strong>{providerEventId ?? "Pending"}</strong>
                  </div>
                  <div>
                    <span>Journal Entry ID</span>
                    <strong>{normalizeStatus(selectedInstruction.status) === "posted_available" ? "Posted Via Treasury Journal" : "Pending Posting"}</strong>
                  </div>
                  <div>
                    <span>Event Type</span>
                    <strong>{detailEventType}</strong>
                  </div>
                </div>
                <div className="ifoc-evidence-grid ifoc-evidence-grid-secondary">
                  <div>
                    <span>Source ADA</span>
                    <strong>{accountNameById.get(selectedInstruction.sourceAccountOfDigitalAssetId ?? "") ?? (selectedInstruction.sourceAccountOfDigitalAssetId ?? "-")}</strong>
                  </div>
                  <div>
                    <span>Destination ADA</span>
                    <strong>{accountNameById.get(selectedInstruction.destinationAccountOfDigitalAssetId ?? "") ?? (selectedInstruction.destinationAccountOfDigitalAssetId ?? "-")}</strong>
                  </div>
                </div>
                <div className="ifoc-ledger-table-wrap">
                  <table className="ifoc-ledger-table">
                    <thead>
                      <tr>
                        <th>Dir</th>
                        <th>Account Context</th>
                        <th className="right">Amount (USDC)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>DR</td>
                        <td>
                          <strong>10020</strong>
                          <p>USDC Operating</p>
                        </td>
                        <td className="right">{formatMinorUnits(selectedInstruction.amountMinorUnits)}</td>
                      </tr>
                      <tr>
                        <td>CR</td>
                        <td>
                          <strong>20430</strong>
                          <p>Internal Mint Liab</p>
                        </td>
                        <td className="right">{formatMinorUnits(selectedInstruction.amountMinorUnits)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="ifoc-ledger-posted-at">Posted At: {formatTimestamp(selectedInstruction.updatedAt)}</p>
              </article>

              <article className="ifoc-card">
                <h2>Destination Asset Impact</h2>
                <div className="ifoc-impact-shell">
                  <div className="ifoc-impact-wallet">
                    <span>Operating USDC Wallet</span>
                    <strong>{accountNameById.get(selectedInstruction.destinationAccountOfDigitalAssetId ?? "") ?? "ADA DAA"}</strong>
                  </div>
                  <div className="ifoc-impact-flow">
                    <div className="ifoc-impact-pending">
                      <span>Pending Arrival</span>
                      <strong>{formatImpactAmount(selectedInstruction.pendingUsdcMinorUnits)}</strong>
                    </div>
                    <ArrowRight size={16} />
                    <div className="ifoc-impact-available">
                      <span>Available Now</span>
                      <strong>{formatImpactAmount(selectedInstruction.availableUsdcMinorUnits)}</strong>
                    </div>
                  </div>
                </div>
                <div className="ifoc-detail-actions">
                  <button className="ifoc-btn-secondary" onClick={() => navigate("/internal/operations/funding-instructions/orders")} type="button">
                    Return To Queue
                  </button>
                  {canRequestMint ? (
                    <button className="ifoc-btn-secondary" disabled={requestingMint} onClick={() => void requestMint()} type="button">
                      {requestingMint ? "Requesting Mint..." : normalizeStatus(selectedInstruction.status) === "failed" || normalizeStatus(selectedInstruction.status) === "exception" ? "Retry Mint" : "Request Mint"}
                    </button>
                  ) : null}
                  <button className="ifoc-btn-primary" onClick={() => navigate(`/internal/operations/funding-instructions/${encodeURIComponent(selectedInstruction.id)}`)} type="button">
                    Open Funding Instruction Detail
                  </button>
                </div>
                {normalizeStatus(selectedInstruction.instructionRole) === "internal_treasury_mint" && !canRequestMint ? (
                  <p className="ifoc-empty">Request Mint is available when internal mint status requires provider execution and source minting wire is active.</p>
                ) : null}
                {requestedMint ? (
                  <p className="ifoc-empty">Mint requested: {requestedMint.id ?? "pending_id"} ({formatStatus(requestedMint.status ?? "completed")})</p>
                ) : null}
              </article>
            </div>
          </div>
        ) : null}

        {error ? <p className="ifoc-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="ifoc-page ifoc-console-page">
      <header className="ifoc-header ifoc-console-header">
        <div>
          <p className="ifoc-eyebrow">TREASURY / OPERATIONS / PAYMENT INSTRUCTION ROUTER (SPRINT 7 CORE)</p>
          <h1>Payment Instructions & Internal ADA Settlement</h1>
          <p>High-density console for routing, settlement progression, and mint posting traceability.</p>
        </div>
        <div className="ifoc-console-actions">
          <button className="ifoc-btn-secondary" onClick={() => void loadRegistry()} type="button">
            <RefreshCw size={14} /> Sync Ledger & Router
          </button>
          <button className="ifoc-btn-primary" onClick={() => navigate("/internal/operations/funding-instructions")} type="button">
            <Plus size={16} /> New Funding Instruction
          </button>
        </div>
      </header>

      <div className="ifoc-stats-grid ifoc-stats-grid-console">
        <article className="ifoc-stat-card">
          <span>Instruction Registry</span>
          <strong>{instructions.length}</strong>
          <p><RefreshCw size={13} /> Loaded from orchestration API</p>
        </article>
        <article className="ifoc-stat-card ifoc-stat-highlight">
          <span>Settled Terminal State</span>
          <strong>{stats.settledInstructions}</strong>
          <p><CheckCircle2 size={13} /> Posted and available</p>
        </article>
        <article className="ifoc-stat-card">
          <span>In-Flight Transit</span>
          <strong>{stats.activeInstructions}</strong>
          <p><Clock3 size={13} /> Actively moving through rails</p>
        </article>
        <article className="ifoc-stat-card">
          <span>Pending Provider / Ledger</span>
          <strong>{stats.pendingProvider}</strong>
          <p><AlertTriangle size={13} /> {stats.pendingLedger} awaiting posting</p>
        </article>
      </div>

      <article className="ifoc-card ifoc-filter-card">
        <div className="ifoc-filter-tabs" role="tablist" aria-label="Instruction status filter">
          {[
            { id: "ALL", label: "ALL", count: instructions.length },
            { id: "route_resolved", label: "ROUTED", count: instructions.filter((item) => normalizeStatus(item.status) === "route_resolved").length },
            { id: "pending_provider", label: "PENDING_PROVIDER", count: instructions.filter((item) => normalizeStatus(item.status) === "pending_provider").length },
            { id: "posted_available", label: "SETTLED", count: instructions.filter((item) => normalizeStatus(item.status) === "posted_available" || normalizeStatus(item.status) === "completed").length },
            { id: "failed", label: "FAILED", count: instructions.filter((item) => normalizeStatus(item.status) === "failed" || normalizeStatus(item.status) === "exception").length }
          ].map((option) => (
            <button
              key={option.id}
              aria-selected={statusFilter === option.id}
              className={`ifoc-filter-tab${statusFilter === option.id ? " active" : ""}`}
              onClick={() => setStatusFilter(option.id)}
              role="tab"
              type="button"
            >
              {option.label} ({option.count})
            </button>
          ))}
        </div>
        <div className="ifoc-filter-right">
          <div className="ifoc-search-shell">
            <Filter size={13} />
            <input
              aria-label="Search funding instructions"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by instruction, ADA, role, or IDs"
              type="search"
              value={searchQuery}
            />
          </div>
          <button className="ifoc-btn-secondary" type="button"><Download size={13} /> Export</button>
        </div>
      </article>

      <article className="ifoc-card">
        <div className="ifoc-table-head">
          <h2>Global Funding Registry</h2>
          <p className="ifoc-eyebrow">TOTAL THROUGHPUT {formatMinorUnits(stats.throughputMinor.toString())} USDC</p>
        </div>
        {loading ? <p className="ifoc-empty">Loading funding registry...</p> : null}
        {!loading && instructions.length === 0 ? <p className="ifoc-empty">No funding instructions available.</p> : null}
        {!loading && instructions.length > 0 ? (
          <div className="ifoc-table-wrap">
            <table className="ifoc-table">
              <thead>
                <tr>
                  <th>Instruction Ref</th>
                  <th>Source ADA</th>
                  <th>Destination Node</th>
                  <th className="right">Amount (USDC)</th>
                  <th>Instruction Role</th>
                  <th>State</th>
                  <th>Last Update</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredInstructions.map((instruction) => (
                  <tr key={instruction.id}>
                    <td>
                      <div className="ifoc-id-main">{instruction.id}</div>
                      <div className="ifoc-id-sub">{instruction.idempotencyKey ?? "no_idempotency_key"}</div>
                    </td>
                    <td>
                      <div className="ifoc-ada-cell-main">{accountNameById.get(instruction.sourceAccountOfDigitalAssetId ?? "") ?? "Unknown ADA"}</div>
                      <div className="ifoc-ada-cell-sub">{instruction.sourceAccountOfDigitalAssetId ?? "-"}</div>
                    </td>
                    <td>
                      <div className="ifoc-ada-cell-main">{accountNameById.get(instruction.destinationAccountOfDigitalAssetId ?? "") ?? "Unknown ADA"}</div>
                      <div className="ifoc-ada-cell-sub">{instruction.destinationAccountOfDigitalAssetId ?? "-"}</div>
                    </td>
                    <td className="right">{formatMinorUnits(instruction.amountMinorUnits)} {(instruction.assetCode ?? "USDC").toUpperCase()}</td>
                    <td>
                      <span className="ifoc-role-pill">{formatStatus(instruction.instructionRole ?? "client_exchange")}</span>
                      <div className="ifoc-ada-cell-sub">{instruction.providerReferenceId ?? "provider_pending"}</div>
                    </td>
                    <td>{renderStateBadge(instruction.status)}</td>
                    <td>{formatTimestamp(instruction.updatedAt ?? instruction.createdAt)}</td>
                    <td className="right">
                      <button
                        className="ifoc-link"
                        onClick={() => navigate(`/internal/operations/funding-instructions/${encodeURIComponent(instruction.id)}/orders`)}
                        type="button"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {!loading && instructions.length > 0 && filteredInstructions.length === 0 ? (
          <p className="ifoc-empty">No instructions match the active search and status filter.</p>
        ) : null}
      </article>

      {error ? <p className="ifoc-error">{error}</p> : null}
    </section>
  );
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
  } = {}
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "x-correlation-id": crypto.randomUUID(),
      "idempotency-key": crypto.randomUUID(),
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorCode = typeof payload?.error === "string"
      ? payload.error
      : `${response.status} ${response.statusText}`;
    const detail = typeof payload?.detail === "string" ? payload.detail.trim() : "";
    const providerRequestId = extractProviderRequestId(payload);
    const message = [
      errorCode,
      detail.length > 0 ? detail : undefined,
      providerRequestId ? `providerRequestId=${providerRequestId}` : undefined
    ].filter(Boolean).join("; ");
    throw new Error(message);
  }
  return payload as T;
};

const extractProviderRequestId = (payload: unknown): string | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const direct = typeof record.providerRequestId === "string" ? record.providerRequestId : undefined;
  if (direct) return direct;

  const circleOperation = record.circleOperation && typeof record.circleOperation === "object"
    ? record.circleOperation as Record<string, unknown>
    : undefined;
  if (!circleOperation) return undefined;

  if (typeof circleOperation.providerRequestId === "string") return circleOperation.providerRequestId;
  const responsePayload = circleOperation.responsePayload && typeof circleOperation.responsePayload === "object"
    ? circleOperation.responsePayload as Record<string, unknown>
    : undefined;
  if (!responsePayload) return undefined;
  if (typeof responsePayload.providerRequestId === "string") return responsePayload.providerRequestId;

  const provider = responsePayload.provider && typeof responsePayload.provider === "object"
    ? responsePayload.provider as Record<string, unknown>
    : undefined;
  return provider && typeof provider.providerRequestId === "string"
    ? provider.providerRequestId
    : undefined;
};

const normalizeStatus = (status: string | undefined): string => (status ?? "pending_provider").trim().toLowerCase();

const isTerminalStatus = (status: string | undefined): boolean => {
  const normalized = normalizeStatus(status);
  return normalized === "completed" || normalized === "posted_available" || normalized === "cancelled" || normalized === "failed" || normalized === "exception";
};

const statusToneClass = (status: string | undefined): string => {
  const normalized = normalizeStatus(status);
  if (normalized === "failed" || normalized === "cancelled" || normalized === "exception") return "tone-error";
  if (normalized === "completed" || normalized === "posted_available" || normalized === "confirmed" || normalized === "available") return "tone-ok";
  return "tone-pending";
};

const statusToLifecycleIndex = (status: string, isInternalMint: boolean): number => {
  if (isInternalMint) {
    if (status === "created") return 0;
    if (status === "route_resolved") return 1;
    if (status === "pending_provider" || status === "pending_confirmation" || status === "pending_usdc_reserved") return 2;
    if (status === "confirmed") return 3;
    if (status === "posted_available" || status === "available" || status === "completed") return 4;
    return 2;
  }
  if (status === "created") return 0;
  if (status === "route_resolved") return 1;
  if (status === "pending_provider") return 2;
  if (status === "pending_confirmation") return 3;
  if (status === "pending_usdc_reserved") return 4;
  if (status === "confirmed") return 5;
  if (status === "posted_available" || status === "available" || status === "completed") return 6;
  return 2;
};

const mintRequestAllowedStatus = (status: string): boolean => {
  return status === "created"
    || status === "route_resolved"
    || status === "pending_provider"
    || status === "failed"
    || status === "exception";
};

const parseMinorUnits = (value: string | undefined): bigint => {
  const normalized = (value ?? "0").replace(/[^0-9-]/g, "");
  if (!normalized || normalized === "-") return 0n;
  return BigInt(normalized);
};

const formatMinorUnits = (value: string | undefined): string => {
  const amount = parseMinorUnits(value);
  const negative = amount < 0n;
  const abs = negative ? amount * -1n : amount;
  const whole = abs / 1_000_000n;
  const fractional = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${negative ? "-" : ""}${whole.toLocaleString()}.${fractional}`;
};

const formatStatus = (status: string): string =>
  formatStatusLabel(status);

const formatStatusLabel = (status: string): string => {
  const normalized = normalizeStatus(status);
  if (normalized === "posted_available") return "Posted & Available";
  if (normalized === "pending_provider") return "Pending Provider";
  if (normalized === "pending_confirmation") return "Pending Confirmation";
  if (normalized === "pending_usdc_reserved") return "Pending USDC Reserved";
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());
};

const formatTimestamp = (value: string | undefined): string => {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatImpactAmount = (value: string | undefined): string => {
  const amount = parseMinorUnits(value);
  if (amount === 0n) return "0.00";
  const display = formatMinorUnits(value);
  return amount > 0n ? `+ ${display}` : display;
};

const renderStatusTrack = (status: string | undefined) => {
  const normalized = normalizeStatus(status);
  if (normalized === "failed" || normalized === "exception") {
    return (
      <span className="ifoc-track ifoc-track-error">
        <CheckCircle2 size={12} /> Wire Init <ArrowRight size={12} /> <AlertCircle size={12} /> Exception
      </span>
    );
  }
  if (normalized === "completed" || normalized === "posted_available" || normalized === "available") {
    return (
      <span className="ifoc-track ifoc-track-ok">
        <CheckCircle2 size={12} /> Confirmed <ArrowRight size={12} /> <CheckCircle2 size={12} /> Available
      </span>
    );
  }
  return (
    <span className="ifoc-track ifoc-track-pending">
      <CheckCircle2 size={12} /> Wire Init <ArrowRight size={12} /> <Clock3 size={12} /> Pending <ArrowRight size={12} /> <Circle size={12} /> Available
    </span>
  );
};

const renderStateBadge = (status: string | undefined) => {
  const normalized = normalizeStatus(status);
  if (normalized === "route_resolved") {
    return <span className="ifoc-state-chip routed">ROUTED</span>;
  }
  if (normalized === "pending_provider" || normalized === "pending_confirmation" || normalized === "pending_usdc_reserved") {
    return (
      <span className="ifoc-state-chip executing">
        <span className="ifoc-state-dot" aria-hidden="true" />
        EXECUTING
      </span>
    );
  }
  if (normalized === "posted_available" || normalized === "completed" || normalized === "available") {
    return <span className="ifoc-state-chip settled">SETTLED</span>;
  }
  if (normalized === "failed" || normalized === "exception" || normalized === "cancelled") {
    return <span className="ifoc-state-chip failed">FAILED</span>;
  }
  return <span className="ifoc-state-chip draft">DRAFT</span>;
};

type ExecutionStageView = {
  label: string;
  detail: string;
  tone: "done" | "current" | "pending" | "failed";
};

type TraceEventView = {
  timestamp: string;
  thread: string;
  category: string;
  message: string;
  highlight?: boolean;
};

const buildExecutionStages = (instruction: FundingInstructionApi | null): ExecutionStageView[] => {
  const stageLabels = [
    "Pre-Flight Verification",
    "Deterministic Route Resolution",
    "Provider Mint Request",
    "Provider Confirmation",
    "Double-Entry Posting",
    "Settlement Finality"
  ];

  if (!instruction) {
    return stageLabels.map((label) => ({
      label,
      detail: "Awaiting instruction payload.",
      tone: "pending"
    }));
  }

  const status = normalizeStatus(instruction.status);
  const isFailed = status === "failed" || status === "cancelled" || status === "exception";
  const currentIndex = resolveExecutionStageIndex(status);
  const details: string[] = [
    `Idempotency lock ${instruction.idempotencyKey ?? "pending"}`,
    `Route status ${formatStatusLabel(instruction.status ?? "pending_provider")}`,
    `Provider ref ${instruction.providerReferenceId ?? "pending"}`,
    `Confirmation status ${formatStatusLabel(instruction.status ?? "pending_provider")}`,
    status === "posted_available" || status === "completed" || status === "available"
      ? "Journal balanced and posted to available ledger."
      : "Awaiting posted and available transition.",
    `Last update ${formatTimestamp(instruction.updatedAt ?? instruction.createdAt)}`
  ];

  return stageLabels.map((label, index) => {
    const tone: ExecutionStageView["tone"] = isFailed
      ? index === currentIndex
        ? "failed"
        : index < currentIndex
          ? "done"
          : "pending"
      : index < currentIndex
        ? "done"
        : index === currentIndex
          ? "current"
          : "pending";

    return {
      label,
      detail: details[index] ?? "Awaiting next stage.",
      tone
    };
  });
};

const buildTraceEvents = (
  instruction: FundingInstructionApi | null,
  orders: FundingInstructionOrderApi[]
): TraceEventView[] => {
  if (!instruction) return [];

  const baseEvents: TraceEventView[] = [
    {
      timestamp: formatTelemetryTimestamp(instruction.createdAt ?? instruction.updatedAt),
      thread: "[CORE-04a]",
      category: "INIT",
      message: `Instruction ${instruction.id} accepted for ${formatMinorUnits(instruction.amountMinorUnits)} ${(instruction.assetCode ?? "USDC").toUpperCase()}.`
    },
    {
      timestamp: formatTelemetryTimestamp(instruction.updatedAt ?? instruction.createdAt),
      thread: "[ROUTER-01]",
      category: "EVAL_PATH",
      message: `Routing state ${formatStatusLabel(instruction.status ?? "pending_provider")} for role ${formatStatusLabel(instruction.instructionRole ?? "client_exchange")}.`
    },
    {
      timestamp: formatTelemetryTimestamp(instruction.updatedAt ?? instruction.createdAt),
      thread: "[CRYPTO-HSM]",
      category: "SIG_COMMIT",
      message: `HSM quorum processing provider reference ${instruction.providerReferenceId ?? "pending"}.`
    }
  ];

  const orderEvents = orders.slice(0, 8).map((order, index) => ({
    timestamp: formatTelemetryTimestamp(order.updatedAt ?? order.createdAt),
    thread: `[ORDER-${String(index + 1).padStart(2, "0")}]`,
    category: "COMMIT_PATH",
    message: `${formatStatusLabel(order.orderKind ?? "order")} is ${formatStatusLabel(order.status ?? "pending_provider")}; amount ${formatMinorUnits(order.amountMinorUnits)} ${(order.currency ?? "USD").toUpperCase()}.`,
    highlight: normalizeStatus(order.status) === "posted_available" || normalizeStatus(order.status) === "completed"
  }));

  const status = normalizeStatus(instruction.status);
  const finalityEvent: TraceEventView = status === "posted_available" || status === "completed" || status === "available"
    ? {
      timestamp: formatTelemetryTimestamp(instruction.updatedAt ?? instruction.createdAt),
      thread: "[LEDGER-02]",
      category: "ACK_BARRIER",
      message: "Settlement finality attested and available balance posted.",
      highlight: true
    }
    : {
      timestamp: formatTelemetryTimestamp(instruction.updatedAt ?? instruction.createdAt),
      thread: "[LEDGER-02]",
      category: "PARITY_ASSERT",
      message: "Trial balance parity maintained while awaiting terminal settlement state."
    };

  return [
    ...baseEvents,
    ...orderEvents,
    finalityEvent
  ];
};

const resolveExecutionStageIndex = (status: string): number => {
  if (status === "created") return 0;
  if (status === "route_resolved") return 1;
  if (status === "pending_provider") return 2;
  if (status === "pending_confirmation" || status === "pending_usdc_reserved") return 3;
  if (status === "confirmed") return 4;
  if (status === "posted_available" || status === "completed" || status === "available") return 5;
  if (status === "failed" || status === "cancelled" || status === "exception") return 5;
  return 2;
};

const formatTelemetryTimestamp = (value: string | undefined): string => {
  if (!value) return "--:--:--.---Z";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toISOString().slice(11, 23)}Z`;
};
