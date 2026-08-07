import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Landmark,
  Pencil,
  XCircle
} from "lucide-react";
import "./internal-funding-instruction-scope.css";

type FlowStep = "create" | "preview" | "success";

type AccountApi = {
  id: string;
  accountName?: string;
  assetCode?: string;
};

type LinkedInstrumentsSummary = {
  fiatLinks?: Array<{
    purpose?: string;
    status?: string;
  }>;
  circleWallets?: Array<{
    status?: string;
    verificationStatus?: string;
  }>;
};

type FundingInstructionApi = {
  id: string;
  status?: string;
  instructionRole?: string;
  sourceAccountOfDigitalAssetId?: string;
  destinationAccountOfDigitalAssetId?: string;
  amountMinorUnits?: string;
  provider?: string;
  createdAt?: string;
  updatedAt?: string;
};

type FundingInstructionOrderApi = {
  id: string;
  orderKind?: string;
  status?: string;
  dependencyOrderId?: string;
  amountMinorUnits?: string;
  currency?: string;
  providerReferenceId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type FormState = {
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinorUnits: string;
  purpose: string;
  routePreference: string;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";
const defaultFormState: FormState = {
  sourceAccountId: "",
  destinationAccountId: "",
  amountMinorUnits: "",
  purpose: "",
  routePreference: "System Optimal"
};

const routeOptions = ["System Optimal", "Wire Priority", "Wallet Priority"];

export const InternalFundingInstructionContent = ({
  fundingInstructionId,
  navigate
}: {
  fundingInstructionId?: string;
  navigate: (path: string) => void;
}) => {
  const [step, setStep] = useState<FlowStep>("create");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<AccountApi[]>([]);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [sourceProfile, setSourceProfile] = useState<LinkedInstrumentsSummary | null>(null);
  const [destinationProfile, setDestinationProfile] = useState<LinkedInstrumentsSummary | null>(null);
  const [createdInstruction, setCreatedInstruction] = useState<FundingInstructionApi | null>(null);
  const [instructionOrders, setInstructionOrders] = useState<FundingInstructionOrderApi[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState("");
  const [pollingMintStatus, setPollingMintStatus] = useState(false);
  const [mintConfirmedToast, setMintConfirmedToast] = useState<string | null>(null);
  const mintConfirmedToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    void loadAccounts();
  }, []);

  useEffect(() => {
    if (!form.sourceAccountId) {
      setSourceProfile(null);
      return;
    }
    void loadLinkedInstruments(form.sourceAccountId, "source");
  }, [form.sourceAccountId]);

  useEffect(() => {
    if (!form.destinationAccountId) {
      setDestinationProfile(null);
      return;
    }
    void loadLinkedInstruments(form.destinationAccountId, "destination");
  }, [form.destinationAccountId]);

  useEffect(() => {
    return () => {
      if (mintConfirmedToastTimerRef.current !== null) {
        window.clearTimeout(mintConfirmedToastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!fundingInstructionId) return;
    void loadFundingInstruction(fundingInstructionId);
  }, [fundingInstructionId]);

  useEffect(() => {
    if (step !== "success") return;
    const instructionId = createdInstruction?.id ?? fundingInstructionId;
    if (!instructionId) return;
    void loadFundingInstructionOrders(instructionId);
  }, [createdInstruction?.id, fundingInstructionId, step]);

  useEffect(() => {
    if (step !== "success") return;
    if (normalizeStatus(createdInstruction?.instructionRole) !== "internal_treasury_mint") return;
    const instructionId = createdInstruction?.id ?? fundingInstructionId;
    if (!instructionId) return;

    const status = normalizeStatus(createdInstruction?.status);
    const shouldPoll = ["pending_provider", "pending_confirmation", "pending_usdc_reserved", "confirmed", "route_resolved", "created"].includes(status);
    if (!shouldPoll) return;

    let cancelled = false;
    const runPoll = async () => {
      if (cancelled) return;
      setPollingMintStatus(true);
      try {
        const latest = await refreshFundingInstruction(instructionId);
        if (!latest) return;
        const latestStatus = normalizeStatus(latest.status);
        if (latestStatus === "posted_available") {
          if (mintConfirmedToastTimerRef.current !== null) {
            window.clearTimeout(mintConfirmedToastTimerRef.current);
          }
          setMintConfirmedToast("Mint confirmed and posted to available balance.");
          mintConfirmedToastTimerRef.current = window.setTimeout(() => {
            setMintConfirmedToast(null);
            mintConfirmedToastTimerRef.current = null;
          }, 3200);
          void loadFundingInstructionOrders(instructionId);
        }
      } catch {
        // Keep silent for background polling; manual refresh continues to surface errors.
      } finally {
        if (!cancelled) setPollingMintStatus(false);
      }
    };

    const interval = window.setInterval(() => {
      void runPoll();
    }, 5000);

    // Poll immediately on entering success state.
    void runPoll();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [step, createdInstruction?.id, createdInstruction?.instructionRole, createdInstruction?.status, fundingInstructionId]);

  const sourceHasMintingWire = useMemo(() => {
    const links = sourceProfile?.fiatLinks ?? [];
    return links.some((link) => {
      const purpose = (link.purpose ?? "").toLowerCase();
      const status = (link.status ?? "").toLowerCase();
      return (purpose === "minting" || purpose === "bidirectional") && (status === "active" || status === "verified");
    });
  }, [sourceProfile]);

  const destinationHasCircleWallet = useMemo(() => {
    const wallets = destinationProfile?.circleWallets ?? [];
    return wallets.some((wallet) => {
      const status = (wallet.status ?? "").toLowerCase();
      const verification = (wallet.verificationStatus ?? "").toLowerCase();
      return (status === "active" || status === "verified") && (verification === "verified" || verification === "");
    });
  }, [destinationProfile]);

  const amountMinorUnits = useMemo(() => {
    const normalized = form.amountMinorUnits.replace(/[^0-9]/g, "");
    return normalized;
  }, [form.amountMinorUnits]);

  const amountDisplay = useMemo(() => {
    if (!amountMinorUnits) return "0.00";
    const asBigInt = BigInt(amountMinorUnits);
    const whole = asBigInt / 1_000_000n;
    const fractional = (asBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
    return `${whole.toLocaleString()}.${fractional}`;
  }, [amountMinorUnits]);

  const canPreview =
    form.sourceAccountId !== ""
    && form.destinationAccountId !== ""
    && amountMinorUnits !== ""
    && BigInt(amountMinorUnits) > 0n
    && form.purpose.trim().length > 0
    && sourceHasMintingWire
    && destinationHasCircleWallet;

  const canAuthorize = canPreview && sourceHasMintingWire && destinationHasCircleWallet;

  const railValidationBlockReason = useMemo(() => {
    if (!sourceHasMintingWire && !destinationHasCircleWallet) {
      return "Validation requires an active minting wire on source ADA and a verified Circle wallet on destination ADA.";
    }
    if (!sourceHasMintingWire) {
      return "Validation requires an active minting wire route on source ADA.";
    }
    if (!destinationHasCircleWallet) {
      return "Validation requires a verified Circle wallet route on destination ADA.";
    }
    return "";
  }, [destinationHasCircleWallet, sourceHasMintingWire]);

  const selectedSource = accounts.find((account) => account.id === form.sourceAccountId);
  const selectedDestination = accounts.find((account) => account.id === form.destinationAccountId);
  const instructionSourceAccountId = createdInstruction?.sourceAccountOfDigitalAssetId ?? form.sourceAccountId;
  const instructionDestinationAccountId = createdInstruction?.destinationAccountOfDigitalAssetId ?? form.destinationAccountId;
  const instructionSourceAccount = accounts.find((account) => account.id === instructionSourceAccountId);
  const instructionDestinationAccount = accounts.find((account) => account.id === instructionDestinationAccountId);
  const successAmountDisplay = createdInstruction?.amountMinorUnits
    ? formatMinorUnitsAsUsdc(createdInstruction.amountMinorUnits)
    : amountDisplay;

  const loadAccounts = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<{ accounts?: AccountApi[] }>("/accounts-of-digital-asset");
      const loaded = response.accounts ?? [];
      setAccounts(loaded);
      if (loaded.length >= 1) {
        setForm((current) => ({
          ...current,
          sourceAccountId: current.sourceAccountId || loaded[0]!.id,
          destinationAccountId: current.destinationAccountId || loaded[0]!.id
        }));
      }
      if (loaded.length >= 2) {
        setForm((current) => ({
          ...current,
          sourceAccountId: current.sourceAccountId || loaded[0]!.id,
          destinationAccountId: current.destinationAccountId || loaded[1]!.id
        }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "accounts_load_failed");
    } finally {
      setLoading(false);
    }
  };

  const loadLinkedInstruments = async (accountId: string, side: "source" | "destination") => {
    try {
      const response = await apiFetch<LinkedInstrumentsSummary>(`/accounts-of-digital-asset/${encodeURIComponent(accountId)}/linked-instruments`);
      if (side === "source") {
        setSourceProfile(response);
      } else {
        setDestinationProfile(response);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "linked_instrument_load_failed");
      if (side === "source") {
        setSourceProfile(null);
      } else {
        setDestinationProfile(null);
      }
    }
  };

  const loadFundingInstruction = async (id: string) => {
    void refreshFundingInstruction(id);
  };

  const refreshFundingInstruction = async (id: string): Promise<FundingInstructionApi | null> => {
    try {
      const response = await apiFetch<{ fundingInstruction?: FundingInstructionApi }>(`/funding-instructions/${encodeURIComponent(id)}`);
      const instruction = response.fundingInstruction ?? null;
      setCreatedInstruction(instruction);
      if (instruction) {
        setStep("success");
      }
      return instruction;
    } catch {
      // Route-level deep link is optional for this UI slice.
      return null;
    }
  };

  const manualRefreshMintStatus = async () => {
    const instructionId = createdInstruction?.id ?? fundingInstructionId;
    if (!instructionId) return;
    setPollingMintStatus(true);
    try {
      const latest = await refreshFundingInstruction(instructionId);
      await loadFundingInstructionOrders(instructionId);
      const latestStatus = normalizeStatus(latest?.status);
      if (latestStatus === "posted_available") {
        if (mintConfirmedToastTimerRef.current !== null) {
          window.clearTimeout(mintConfirmedToastTimerRef.current);
        }
        setMintConfirmedToast("Mint confirmed and posted to available balance.");
        mintConfirmedToastTimerRef.current = window.setTimeout(() => {
          setMintConfirmedToast(null);
          mintConfirmedToastTimerRef.current = null;
        }, 3200);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_instruction_refresh_failed");
    } finally {
      setPollingMintStatus(false);
    }
  };

  const loadFundingInstructionOrders = async (id: string) => {
    setOrdersLoading(true);
    setOrdersError("");
    try {
      const response = await apiFetch<{ orders?: FundingInstructionOrderApi[] }>(`/funding-instructions/${encodeURIComponent(id)}/orders`);
      setInstructionOrders(response.orders ?? []);
    } catch (caught) {
      setInstructionOrders([]);
      setOrdersError(caught instanceof Error ? caught.message : "funding_instruction_orders_load_failed");
    } finally {
      setOrdersLoading(false);
    }
  };

  const submitInstruction = async () => {
    if (!canAuthorize || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await apiFetch<{ fundingInstruction?: FundingInstructionApi }>("/funding-instructions", {
        method: "POST",
        body: {
          accountOfDigitalAssetId: form.destinationAccountId,
          sourceAccountOfDigitalAssetId: form.sourceAccountId,
          destinationAccountOfDigitalAssetId: form.destinationAccountId,
          instructionRole: "internal_treasury_mint",
          transferKind: "ada_to_ada_internal",
          fundingType: "usdc_payin",
          amountMinorUnits,
          provider: "circle",
          assetCode: "USDC",
          currency: "USD",
          routePreference: form.routePreference,
          purpose: form.purpose
        }
      });
      setCreatedInstruction(response.fundingInstruction ?? null);
      setStep("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_instruction_create_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const resetFlow = () => {
    setStep("create");
    setCreatedInstruction(null);
    setInstructionOrders([]);
    setOrdersError("");
    setError("");
    setForm((current) => ({
      ...defaultFormState,
      sourceAccountId: current.sourceAccountId,
      destinationAccountId: current.destinationAccountId,
      routePreference: "System Optimal"
    }));
  };

  const checkIcon = (passed: boolean) =>
    passed
      ? <CheckCircle2 size={16} className="ifc5-check-pass" />
      : <XCircle size={16} className="ifc5-check-fail" />;

  if (step === "success") {
    return (
      <section className="ifc5-page">
        {mintConfirmedToast ? (
          <div aria-live="polite" className="ifoc-success-toast" role="status">
            <CheckCircle2 size={14} />
            <span>{mintConfirmedToast}</span>
          </div>
        ) : null}

        <div className="ifc5-banner">
          <CheckCircle2 size={16} />
          <span>AUTHORIZED</span>
          <strong>{createdInstruction?.id ?? "Pending response"}</strong>
        </div>

        <header className="ifc5-success-header">
          <h1>Instruction Authorized And Initialized</h1>
          <p>
            The internal treasury mint funding instruction has been submitted with role
            internal_treasury_mint and is now tracked by orchestration status.
          </p>
        </header>

        <div className="ifc5-success-grid">
          <article className="ifc5-card">
            <h2>Instruction Details</h2>
            <dl>
              <div>
                <dt>Instruction ID</dt>
                <dd>{createdInstruction?.id ?? "-"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatStatus(createdInstruction?.status ?? "pending_provider")}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{formatStatus(createdInstruction?.instructionRole ?? "internal_treasury_mint")}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{successAmountDisplay} USDC</dd>
              </div>
              <div>
                <dt>Source ADA</dt>
                <dd>{instructionSourceAccount?.accountName ?? instructionSourceAccountId}</dd>
              </div>
              <div>
                <dt>Destination ADA</dt>
                <dd>{instructionDestinationAccount?.accountName ?? instructionDestinationAccountId}</dd>
              </div>
            </dl>
          </article>

          <article className="ifc5-card">
            <h2>Orchestration Plan</h2>
            <div className="ifc5-order-box">
              <span className="ifc5-chip">ORDER 1</span>
              <strong>internal_mint_ada_transfer</strong>
              <p>Single-order mint flow for Internal Treasure Client instruction role.</p>
            </div>
            <div className="ifc5-actions">
              <button className="ifc5-btn-primary" onClick={() => navigate("/internal/operations/funding-instructions/orders")} type="button">
                Order Console
              </button>
              <button
                className="ifc5-btn-secondary"
                disabled={pollingMintStatus}
                onClick={() => void manualRefreshMintStatus()}
                type="button"
              >
                {pollingMintStatus ? "Refreshing Status..." : "Refresh Mint Status"}
              </button>
              <button className="ifc5-btn-secondary" onClick={resetFlow} type="button">
                Create Another
              </button>
            </div>
          </article>
        </div>

        <article className="ifc5-card ifc5-orders-panel">
          <h2>Orders Timeline</h2>
          {ordersLoading ? <p className="ifc5-orders-empty">Loading order timeline...</p> : null}
          {!ordersLoading && ordersError ? <p className="ifc5-error">Unable to load orders: {ordersError}</p> : null}
          {!ordersLoading && !ordersError && instructionOrders.length === 0 ? (
            <p className="ifc5-orders-empty">No orchestration orders are available for this instruction yet.</p>
          ) : null}
          {!ordersLoading && !ordersError && instructionOrders.length > 0 ? (
            <ol className="ifc5-orders-timeline">
              {instructionOrders.map((order) => (
                <li key={order.id}>
                  <div className="ifc5-orders-timeline-head">
                    <strong>{formatStatus(order.orderKind ?? "order")}</strong>
                    <span className="ifc5-chip">{formatStatus(order.status ?? "pending_provider")}</span>
                  </div>
                  <p>
                    {formatTimestamp(order.createdAt ?? order.updatedAt)}
                    {" | "}
                    {formatMinorUnitsAsUsdc(order.amountMinorUnits)} {(order.currency ?? "USD").toUpperCase()}
                  </p>
                  <p>Order ID: {order.id}</p>
                  {order.dependencyOrderId ? <p>Depends on: {order.dependencyOrderId}</p> : null}
                </li>
              ))}
            </ol>
          ) : null}
        </article>

        {error ? <p className="ifc5-error">{error}</p> : null}
      </section>
    );
  }

  if (step === "preview") {
    return (
      <section className="ifc5-page ifc5-page-preview">
        <header className="ifc5-header">
          <div>
            <p>TREASURY FUNDING INSTRUCTION</p>
            <h1>Validation And Preview</h1>
          </div>
          <div className="ifc5-id-box">
            <span>INTERNAL ROLE</span>
            <strong>internal_treasury_mint</strong>
          </div>
        </header>

        <div className="ifc5-grid">
          <div className="ifc5-left-stack">
            <article className="ifc5-card">
              <h2>Instruction Summary</h2>
              <div className="ifc5-summary-grid">
                <div>
                  <span>Source ADA</span>
                  <strong>{selectedSource?.accountName ?? form.sourceAccountId}</strong>
                  <small>{form.sourceAccountId}</small>
                </div>
                <div>
                  <span>Destination ADA</span>
                  <strong>{selectedDestination?.accountName ?? form.destinationAccountId}</strong>
                  <small>{form.destinationAccountId}</small>
                </div>
              </div>
              <div className="ifc5-amount-bar">
                <div>
                  <span>Principal Amount</span>
                  <strong>{amountDisplay} USDC</strong>
                </div>
                <ArrowRight size={20} />
              </div>
              <div className="ifc5-purpose">
                <span>Business Purpose</span>
                <p>{form.purpose}</p>
              </div>
            </article>

            <article className="ifc5-card">
              <h2>Projected Ledger Impacts</h2>
              <table className="ifc5-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>10020 - Circle Business Account USDC</td>
                    <td>Asset</td>
                    <td>{amountDisplay}</td>
                    <td>-</td>
                  </tr>
                  <tr>
                    <td>20430 - Customer ADA Available Liability</td>
                    <td>Liability</td>
                    <td>-</td>
                    <td>{amountDisplay}</td>
                  </tr>
                </tbody>
              </table>
            </article>
          </div>

          <aside className="ifc5-right-stack">
            <article className="ifc5-card ifc5-muted">
              <h2>Orchestration Plan</h2>
              <div className="ifc5-order-box">
                <span className="ifc5-chip">ORDER 1</span>
                <strong>internal_mint_ada_transfer</strong>
                <p>Status will initialize as pending_provider.</p>
              </div>
            </article>

            <article className="ifc5-card">
              <h2>Governance Gate</h2>
              <ul className="ifc5-check-list">
                <li>
                  {checkIcon(sourceHasMintingWire)}
                  <div>
                    <strong>Constraint 01</strong>
                    <span>Source ADA has active minting wire route.</span>
                  </div>
                </li>
                <li>
                  {checkIcon(destinationHasCircleWallet)}
                  <div>
                    <strong>Constraint 02</strong>
                    <span>Destination ADA has verified Circle USDC wallet.</span>
                  </div>
                </li>
                <li>
                  {checkIcon(form.purpose.trim().length > 0)}
                  <div>
                    <strong>Policy Check</strong>
                    <span>Business purpose is documented.</span>
                  </div>
                </li>
              </ul>
            </article>

            <div className="ifc5-actions">
              <button className="ifc5-btn-primary" disabled={!canAuthorize || submitting} onClick={() => void submitInstruction()} type="button">
                {submitting ? "Authorizing..." : "Authorize And Execute"}
              </button>
              <button className="ifc5-btn-secondary" onClick={() => setStep("create")} type="button">
                <Pencil size={14} />
                Back To Edit
              </button>
            </div>
          </aside>
        </div>

        {error ? <p className="ifc5-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="ifc5-page ifc5-page-create">
      <header className="ifc5-header-create">
        <h1>Create Funding Instruction</h1>
        <p>
          Internal Treasure Client mint flow. Create ADA to ADA funding instruction with instruction role
          internal_treasury_mint.
        </p>
      </header>

      <div className="ifc5-grid">
        <div className="ifc5-left-stack">
          <article className="ifc5-card">
            <h2>Account Topography</h2>
            <div className="ifc5-field-stack">
              <label>
                <span>Source ADA Account</span>
                <div className="ifc5-select-wrap">
                  <select
                    disabled={loading}
                    onChange={(event) => setForm((current) => ({ ...current, sourceAccountId: event.target.value }))}
                    value={form.sourceAccountId}
                  >
                    {accounts.length === 0 ? <option value="">No ADA available</option> : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>

              <label>
                <span>Destination ADA Account</span>
                <div className="ifc5-select-wrap">
                  <select
                    disabled={loading}
                    onChange={(event) => setForm((current) => ({ ...current, destinationAccountId: event.target.value }))}
                    value={form.destinationAccountId}
                  >
                    {accounts.length === 0 ? <option value="">No ADA available</option> : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>
            </div>
          </article>

          <article className="ifc5-card">
            <h2>Instruction Parameters</h2>
            <div className="ifc5-form-grid">
              <label>
                <span>Funding Type</span>
                <input readOnly value="usdc_payin" />
              </label>
              <label>
                <span>Instruction Role</span>
                <input readOnly value="internal_treasury_mint" />
              </label>
              <label>
                <span>Amount (minor units)</span>
                <input
                  inputMode="numeric"
                  onChange={(event) => setForm((current) => ({ ...current, amountMinorUnits: event.target.value }))}
                  placeholder="1000000"
                  value={form.amountMinorUnits}
                />
                <small>Minor units x 1,000,000 per USDC</small>
              </label>
              <label>
                <span>Route Preference</span>
                <div className="ifc5-select-wrap">
                  <select
                    onChange={(event) => setForm((current) => ({ ...current, routePreference: event.target.value }))}
                    value={form.routePreference}
                  >
                    {routeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>
            </div>

            <label className="ifc5-textarea-wrap">
              <span>Business Purpose Or Description</span>
              <textarea
                onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
                placeholder="Detail the business justification for this internal mint operation"
                value={form.purpose}
              />
            </label>
          </article>

          <div className="ifc5-footer-actions">
            <button className="ifc5-btn-primary" disabled={!canPreview} onClick={() => setStep("preview")} type="button">
              Validation And Preview
              <ArrowRight size={14} />
            </button>
          </div>
          {!canPreview && railValidationBlockReason ? <p className="ifc5-gate-note">{railValidationBlockReason}</p> : null}
        </div>

        <aside className="ifc5-right-stack">
          <article className="ifc5-card ifc5-muted">
            <h2>
              <Landmark size={16} />
              Governance Rules
            </h2>
            <ul className="ifc5-check-list">
              <li>
                {checkIcon(sourceHasMintingWire)}
                <div>
                  <strong>Constraint 01</strong>
                  <span>Source account has active Minting wire purpose.</span>
                </div>
              </li>
              <li>
                {checkIcon(destinationHasCircleWallet)}
                <div>
                  <strong>Constraint 02</strong>
                  <span>Destination account has verified Circle wallet route.</span>
                </div>
              </li>
              <li>
                {checkIcon(form.purpose.trim().length > 0)}
                <div>
                  <strong>Constraint 03</strong>
                  <span>Purpose text is required for internal mint policy.</span>
                </div>
              </li>
            </ul>
          </article>

          <article className="ifc5-card">
            <h2>
              <ClipboardCheck size={16} />
              Snapshot
            </h2>
            <dl className="ifc5-snapshot">
              <div>
                <dt>Amount Preview</dt>
                <dd>{amountDisplay} USDC</dd>
              </div>
              <div>
                <dt>Route Preference</dt>
                <dd>{form.routePreference}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedSource?.accountName ?? "-"}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>{selectedDestination?.accountName ?? "-"}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </div>

      {error ? <p className="ifc5-error">{error}</p> : null}
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
  const correlationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "x-correlation-id": correlationId,
      "idempotency-key": idempotencyKey
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
};

const accountLabel = (account: AccountApi): string => {
  const name = account.accountName?.trim() || "Unnamed ADA";
  const code = account.assetCode?.trim() || "USDC";
  return `${name} (${code})`;
};

const normalizeStatus = (status: string | undefined): string => (status ?? "").trim().toLowerCase();

const formatStatus = (status: string): string =>
  status.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());

const formatTimestamp = (value: string | undefined): string => {
  if (!value) return "Timestamp unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatMinorUnitsAsUsdc = (value: string | undefined): string => {
  if (!value) return "0.00";
  const normalized = value.replace(/[^0-9-]/g, "");
  if (!normalized || normalized === "-") return "0.00";
  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  if (!digits) return "0.00";
  const units = BigInt(digits);
  const whole = units / 1_000_000n;
  const fractional = (units % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${negative ? "-" : ""}${whole.toLocaleString()}.${fractional}`;
};
