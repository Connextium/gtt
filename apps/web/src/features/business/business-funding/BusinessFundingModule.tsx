import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Banknote,
  Bell,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  FileCheck2,
  GitBranch,
  Info,
  Plus,
  Settings,
  ShieldAlert,
  Webhook
} from "lucide-react";
import "./business-funding-scope.css";

type View = "dashboard" | "create" | "review" | "audit";

type FundingInstruction = {
  id: string;
  sourceAccountId: string;
  sourceAdaCode: string;
  destinationAccountId: string;
  destinationAdaCode: string;
  type: string;
  amount: string;
  status: string;
  provider: string;
  updatedAt: string;
};

type FundingInstructionApi = {
  id: string;
  accountOfDigitalAssetId?: string;
  sourceAccountOfDigitalAssetId?: string;
  sourceAdaCode?: string;
  sourceAccountCode?: string;
  destinationAccountOfDigitalAssetId?: string;
  destinationAdaCode?: string;
  destinationAccountCode?: string;
  fundingType?: string;
  amountMinorUnits?: string;
  pendingUsdcMinorUnits?: string;
  availableUsdcMinorUnits?: string;
  status?: string;
  supportReference?: string;
  postingJournalEntryId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type FundingOrderApi = {
  id: string;
  orderKind?: string;
  stage?: string;
  dependencyOrderId?: string;
  amountMinorUnits?: string;
  currency?: string;
  status?: string;
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

type AccountApi = {
  id: string;
  accountCode?: string;
  accountName?: string;
  usePurpose?: string;
  assetCode?: string;
  balances?: {
    availableMinorUnits?: string;
  };
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const profileImage =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=150&auto=format&fit=crop";

export const BusinessFundingModule = ({
  authorizedAccounts,
  embedded = false,
  initialInstructionId = "",
  navigate,
  token
}: {
  authorizedAccounts: AccountApi[];
  embedded?: boolean;
  initialInstructionId?: string;
  navigate?: (path: string) => void;
  token: string;
}) => {
  const [view, setView] = useState<View>("dashboard");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<AccountApi[]>(authorizedAccounts);
  const [instructions, setInstructions] = useState<FundingInstruction[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [sourceAccountId, setSourceAccountId] = useState("");
  const [destinationAccountId, setDestinationAccountId] = useState("");
  const [fundingType, setFundingType] = useState("usdc_payin");
  const [routePreference, setRoutePreference] = useState("system-default");
  const [amount, setAmount] = useState("");
  const [selectedId, setSelectedId] = useState(initialInstructionId);
  const [selectedDetail, setSelectedDetail] = useState<FundingInstructionApi | null>(null);
  const [selectedOrders, setSelectedOrders] = useState<FundingOrderApi[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");

  const minorUnits = useMemo(() => {
    const parsed = Number.parseFloat(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) return "0";
    return Math.floor(parsed * 1_000_000).toLocaleString();
  }, [amount]);

  const filteredInstructions = useMemo(() => {
    return instructions.filter((item) => {
      if (statusFilter !== "all" && !item.status.toLowerCase().includes(statusFilter)) return false;
      if (sourceFilter !== "all" && item.sourceAccountId !== sourceFilter) return false;
      if (destinationFilter !== "all" && item.destinationAccountId !== destinationFilter) return false;
      if (dateFilter && !item.updatedAt.startsWith(dateFilter)) return false;
      return true;
    });
  }, [dateFilter, destinationFilter, instructions, sourceFilter, statusFilter]);

  const accountCodeByAccountId = useMemo(
    () => new Map(accounts.map((account) => [account.id, accountDisplayCode(account)])),
    [accounts]
  );
  const destinationAccount = accounts.find((account) => account.id === destinationAccountId);

  useEffect(() => {
    if (token) void loadInitialData();
  }, [token]);

  useEffect(() => {
    setAccounts(authorizedAccounts);
    if (authorizedAccounts[0]?.id) {
      setSourceAccountId((current) => current || authorizedAccounts[0]!.id);
      setDestinationAccountId((current) => current || authorizedAccounts[0]!.id);
    }
  }, [authorizedAccounts]);

  useEffect(() => {
    setSelectedId(initialInstructionId);
  }, [initialInstructionId]);

  useEffect(() => {
    if (!selectedId || view !== "dashboard") {
      setSelectedDetail(null);
      return;
    }
    void loadFundingDetail(selectedId);
  }, [selectedId, view]);

  const loadInitialData = async () => {
    setLoading(true);
    setError("");
    try {
      const fundingResponse = await apiFetch<{ fundingInstructions?: FundingInstructionApi[] }>(
        "/business/me/funding-instructions",
        token
      );
      const loadedAccounts = authorizedAccounts;
      const loadedInstructions = (fundingResponse.fundingInstructions ?? []).map(mapInstruction);
      setInstructions(loadedInstructions);
      if (loadedAccounts[0]?.id) {
        setSourceAccountId((current) => current || loadedAccounts[0]!.id);
        setDestinationAccountId((current) => current || loadedAccounts[0]!.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_data_load_failed");
    } finally {
      setLoading(false);
    }
  };

  const loadFundingDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await apiFetch<{ fundingInstruction?: FundingInstructionApi; orders?: FundingOrderApi[] }>(
        `/business/me/funding-instructions/${encodeURIComponent(id)}`,
        token
      );
      setSelectedDetail(response.fundingInstruction ?? null);
      setSelectedOrders(response.orders ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_detail_load_failed");
      setSelectedDetail(null);
      setSelectedOrders([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const submitFundingInstruction = async () => {
    const minor = amountToMinorUnits(amount);
    if (!destinationAccountId || minor <= 0n) {
      setError("destination_account_and_positive_amount_required");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await apiFetch<{ fundingInstruction?: FundingInstructionApi }>("/business/me/funding-instructions", token, {
        method: "POST",
        body: {
          accountOfDigitalAssetId: destinationAccountId,
          sourceAccountOfDigitalAssetId: sourceAccountId || undefined,
          destinationAccountOfDigitalAssetId: destinationAccountId,
          fundingType,
          amountMinorUnits: minor.toString(),
          provider: "circle",
          assetCode: "USDC",
          currency: "USD"
        }
      });
      if (response.fundingInstruction) {
        const created = mapInstruction(response.fundingInstruction);
        setInstructions((current) => [created, ...current]);
        setSelectedId(created.id);
      }
      setView("dashboard");
      setAmount("");
      setSuccessMessage("Payment instruction initialized successfully.");
      await loadInitialData();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_instruction_create_failed");
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!successMessage) return;
    const timer = window.setTimeout(() => {
      setSuccessMessage("");
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [successMessage]);

  if (view === "review") {
    const ReviewRoot = embedded ? "div" : "main";
    const previewMinorUnits = amountToMinorUnits(amount);
    const canAuthorize = destinationAccountId !== "" && previewMinorUnits > 0n;

    return (
      <ReviewRoot className={`bcf-page${embedded ? " bcf-page-embedded" : ""}`}>
        <div className="bcf-shell bcf-shell-create">
          <section className="bcf-create-main">
            <header className="bcf-create-header">
              <p className="bcf-eyebrow">Global Trade Treasury</p>
              <h1>Review &amp; Initialize Funding Instruction</h1>
              <p>
                Initialize a precise liquidity movement into the target digital asset account. Ensure all routing details
                and amounts are verified before proceeding.
              </p>
            </header>

            <div className="bcf-form-scroll bcf-review-scroll">
              <section className="bcf-form-section">
                <h2>Instruction Summary</h2>
                <dl className="bcf-review-grid">
                  <div>
                    <dt>Source ADA</dt>
                    <dd className="mono">{accountCodeByAccountId.get(sourceAccountId) ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Target ADA</dt>
                    <dd className="mono">{accountCodeByAccountId.get(destinationAccountId) ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>Funding Type</dt>
                    <dd>{formatStatus(fundingType)}</dd>
                  </div>
                  <div>
                    <dt>Amount</dt>
                    <dd>
                      <strong>{formatAmountFromMinorUnits(previewMinorUnits.toString())}</strong> USDC
                    </dd>
                  </div>
                  <div>
                    <dt>Route</dt>
                    <dd>{formatStatus(routePreference)}</dd>
                  </div>
                  <div>
                    <dt>Amount (Minor Units)</dt>
                    <dd className="mono">{previewMinorUnits.toLocaleString()}</dd>
                  </div>
                </dl>
              </section>

              <section className="bcf-form-section">
                <h2>Compliance &amp; Validation</h2>
                <ul className="bcf-review-checks">
                  <li>Sufficient Available Balance</li>
                  <li>Destination ADA Active</li>
                  <li>Risk Limits Verified</li>
                  <li>Anti-Money Laundering (AML) Scoped</li>
                </ul>
              </section>

              {error ? <p className="bcf-inline-error">{error}</p> : null}
            </div>

            <footer className="bcf-create-footer">
              <button className="bcf-btn-secondary" onClick={() => setView("create")} type="button">
                Back
              </button>
              <button
                className="bcf-btn-primary"
                disabled={creating || !canAuthorize}
                onClick={() => void submitFundingInstruction()}
                type="button"
              >
                {creating ? "Authorizing..." : "AUTHORIZE & INITIALIZE"}
              </button>
            </footer>
          </section>

          <aside className="bcf-create-aside">
            <div className="bcf-aside-card">
              <h3>Active Target Details</h3>
              <p className="bcf-account-number">{destinationAccountId || "-"}</p>
              <dl>
                <div>
                  <dt>Status</dt>
                  <dd className="bcf-tag">VERIFIED</dd>
                </div>
                <div>
                  <dt>Purpose</dt>
                  <dd>USDC Omnibus</dd>
                </div>
                <div className="bcf-balance-row">
                  <dt>Available ADA Balance</dt>
                  <dd>{formatAdaBalance(destinationAccount)}</dd>
                </div>
              </dl>
              <div className="bcf-guidance">
                <h4>
                  <Info size={16} /> Technical Guidance
                </h4>
                <p>&gt; Instruction initialization generates a unique hash signature.</p>
                <p>&gt; Payload is verified against ADA limits prior to broadcast.</p>
                <p>&gt; Allow T+0 for on-chain settlement delays up to 12 minutes.</p>
              </div>
            </div>
          </aside>
        </div>
      </ReviewRoot>
    );
  }

  if (view === "create") {
    const CreateRoot = embedded ? "div" : "main";
    return (
      <CreateRoot className={`bcf-page bcf-page-create${embedded ? " bcf-page-embedded" : ""}`}>
        <div className="bcf-shell bcf-shell-create">
          <section className="bcf-create-main">
            <header className="bcf-create-header">
              <p className="bcf-eyebrow">Global Trade Treasury</p>
              <h1>Create Funding Instruction</h1>
              <p>
                Initialize a precise liquidity movement into the target digital asset account. Ensure all routing details
                and amounts are verified before proceeding.
              </p>
            </header>

            <div className="bcf-form-scroll">
              <section className="bcf-form-section bcf-create-tight-section">
                <h2 className="bcf-create-tight-title">Source And Destination ADA</h2>
                <div className="bcf-form-grid">
                  <label>
                    <span>Source ADA</span>
                    <div className="bcf-select-wrap">
                      <select onChange={(event) => setSourceAccountId(event.target.value)} value={sourceAccountId}>
                        {accounts.length === 0 ? <option value="">No accounts</option> : null}
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {formatAdaLabelWithBalance(account)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                    <small>Source route is derived from linked instruments.</small>
                  </label>

                  <label>
                    <span>Destination ADA</span>
                    <div className="bcf-select-wrap">
                      <select onChange={(event) => setDestinationAccountId(event.target.value)} value={destinationAccountId}>
                        {accounts.length === 0 ? <option value="">No accounts</option> : null}
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {formatAdaLabelWithBalance(account)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>
                </div>
              </section>

              <section className="bcf-form-section bcf-create-tight-section">
                <h2 className="bcf-create-tight-title">Instruction Details</h2>
                <div className="bcf-form-grid">
                  <label className="bcf-span-2">
                    <span>Funding Type</span>
                    <div className="bcf-select-wrap">
                      <select onChange={(event) => setFundingType(event.target.value)} value={fundingType}>
                        <option value="usdc_payin">USDC Payin</option>
                        <option value="fiat_ramp">Fiat-to-Crypto Ramp</option>
                        <option value="internal_transfer">Internal Ledger Transfer</option>
                      </select>
                      <ChevronDown size={16} />
                    </div>
                  </label>

                  <label>
                    <span>Amount</span>
                    <div className="bcf-money-input">
                      <input
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        type="number"
                        value={amount}
                      />
                      <strong>USDC</strong>
                    </div>
                    <small>
                      <code>{amount || "0"}</code> USDC · Equivalent minor units (x 1,000,000): <code>{minorUnits}</code>
                    </small>
                  </label>

                  <label>
                    <span>Asset / Currency</span>
                    <div className="bcf-readonly">USDC</div>
                  </label>
                </div>
              </section>

              <section className="bcf-form-section bcf-route-section bcf-create-tight-section">
                <h2 className="bcf-create-tight-title">
                  Route Preference <em>(Optional)</em>
                </h2>
                <label className="bcf-routes-field">
                  <span>Verified Funding Routes</span>
                  <div className="bcf-select-wrap">
                    <select onChange={(event) => setRoutePreference(event.target.value)} value={routePreference}>
                      <option value="system-default">System Optimized (Default)</option>
                      <option value="wire-priority">Wire Priority (Payin Underlying)</option>
                      <option value="wallet-priority">Wallet Priority (Immediate)</option>
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </label>
              </section>
            </div>

            <footer className="bcf-create-footer">
              <button className="bcf-btn-secondary" onClick={() => setView("dashboard")} type="button">
                Cancel
              </button>
              <button
                className="bcf-btn-primary"
                disabled={creating}
                onClick={() => {
                  const minor = amountToMinorUnits(amount);
                  if (!destinationAccountId || minor <= 0n) {
                    setError("destination_account_and_positive_amount_required");
                    return;
                  }
                  setError("");
                  setView("review");
                }}
                type="button"
              >
                Review Payment Instruction
              </button>
            </footer>
          </section>

          <aside className="bcf-create-aside">
            <div className="bcf-aside-card">
              <h3>Active Target Details</h3>
              <p className="bcf-account-number">{destinationAccountId || "-"}</p>

              <dl>
                <div>
                  <dt>Status</dt>
                  <dd className="bcf-tag">VERIFIED</dd>
                </div>
                <div>
                  <dt>Purpose</dt>
                  <dd>USDC Omnibus</dd>
                </div>
                <div className="bcf-balance-row">
                  <dt>Available ADA Balance</dt>
                  <dd>{formatAdaBalance(destinationAccount)}</dd>
                </div>
              </dl>

              {error ? <p className="bcf-inline-error">{error}</p> : null}

              <div className="bcf-guidance">
                <h4>
                  <Info size={16} /> Technical Guidance
                </h4>
                <p>&gt; Instruction initialization generates a unique hash signature.</p>
                <p>&gt; Payload is verified against ADA limits prior to broadcast.</p>
                <p>&gt; Allow T+0 for on-chain settlement delays up to 12 minutes.</p>
              </div>
            </div>
          </aside>
        </div>
      </CreateRoot>
    );
  }

  if (view === "audit") {
    const AuditRoot = embedded ? "div" : "main";
    const instruction = selectedDetail;
    return (
      <AuditRoot className={`bcf-page${embedded ? " bcf-page-embedded" : ""}`}>
        <div className="bcf-shell bcf-shell-audit">
          <section className="bcf-main bcf-audit-main">
            <div className="bcf-main-content">
              <div className="bcf-page-head">
                <div>
                  <h2>Post-Execution Audit</h2>
                  <p>LINEAGE TRACE | ID: {instruction?.id ?? "-"}</p>
                </div>
                <button className="bcf-btn-secondary" onClick={() => setView("dashboard")} type="button">
                  Back To Dashboard
                </button>
              </div>

              <section className="bcf-detail-card">
                <h3>Execution Metadata</h3>
                {instruction ? (
                  <dl>
                    <div>
                      <dt>LINEAGE TRACE ID</dt>
                      <dd className="mono">{instruction.id}</dd>
                    </div>
                    <div>
                      <dt>STATUS</dt>
                      <dd>{formatStatus(instruction.status ?? "pending_provider")}</dd>
                    </div>
                      <div>
                        <dt>SOURCE ADA</dt>
                      <dd className="mono">{apiSourceAdaCode(instruction)}</dd>
                    </div>
                    <div>
                      <dt>TARGET ADA</dt>
                      <dd className="mono">{apiDestinationAdaCode(instruction)}</dd>
                    </div>
                    <div>
                      <dt>AMOUNT</dt>
                      <dd>{formatAmountFromMinorUnits(instruction.amountMinorUnits ?? "0")} USDC</dd>
                    </div>
                    <div>
                      <dt>POSTED AT</dt>
                      <dd className="mono">{formatDateTime(instruction.updatedAt)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="bcf-inline-error">No selected instruction detail is available for audit.</p>
                )}
              </section>

              <section className="bcf-detail-card">
                <h3>AUDIT TIMELINE</h3>
                <ul className="bcf-review-checks">
                  <li>Created</li>
                  <li>Validated</li>
                  <li>Authorized</li>
                  <li>Committed</li>
                  <li>Settled</li>
                </ul>
              </section>

              {error ? <p className="bcf-inline-error">{error}</p> : null}
              {successMessage ? <p className="bcf-inline-success">{successMessage}</p> : null}
            </div>
          </section>
        </div>
      </AuditRoot>
    );
  }

  const DashboardRoot = embedded ? "div" : "main";

  return (
    <DashboardRoot className={`bcf-page${embedded ? " bcf-page-embedded" : ""}`}>
      <div className="bcf-shell">
        <nav className="bcf-sidebar" aria-label="Business funding navigation">
          <div className="bcf-sidebar-head">
            <h1>TREASURY GLOBAL</h1>
            <div className="bcf-profile-row">
              <img alt="User profile" src={profileImage} />
              <div>
                <strong>Institutional Ops</strong>
                <small>Persona: Treasury Operator</small>
              </div>
            </div>
          </div>

          <div className="bcf-nav-list">
            <a className="active" href="#" onClick={(event) => event.preventDefault()}>
              <Banknote size={16} />
              <span>Funding Instructions</span>
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              <Building2 size={16} />
              <span>Treasury Operations</span>
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              <GitBranch size={16} />
              <span>Route Management</span>
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              <Webhook size={16} />
              <span>Webhooks</span>
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              <FileCheck2 size={16} />
              <span>Evidence Hub</span>
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              <ShieldAlert size={16} />
              <span>Administration</span>
            </a>
          </div>

          <div className="bcf-sidebar-cta">
            <button className="bcf-btn-primary" onClick={() => setView("create")} type="button">
              <Plus size={14} />
              New Instruction
            </button>
          </div>

          <div className="bcf-nav-foot">
            <a href="#" onClick={(event) => event.preventDefault()}>
              <Activity size={16} />
              <span>System Status</span>
            </a>
            <a href="#" onClick={(event) => event.preventDefault()}>
              <BookOpen size={16} />
              <span>Documentation</span>
            </a>
          </div>
        </nav>

        <section className="bcf-main">
          <header className="bcf-topbar">
            <div className="bcf-topbar-left">TREASURY GLOBAL</div>
            <div className="bcf-topbar-right">
              <button type="button" aria-label="Notifications">
                <Bell size={16} />
              </button>
              <button type="button" aria-label="Settings">
                <Settings size={16} />
              </button>
              <img alt="Profile" src={profileImage} />
            </div>
          </header>

          <div className="bcf-main-content">
            <div className="bcf-page-head">
              <div>
                <h2>Business Funding</h2>
                <p>Manage and monitor inbound funding instructions across all digital asset accounts.</p>
              </div>
              <button className="bcf-btn-primary" onClick={() => setView("create")} type="button">
                <Plus size={14} />
                Create Funding Instruction
              </button>
            </div>

            <section className="bcf-filters">
              <label>
                <span>Status</span>
                <div className="bcf-select-wrap">
                  <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="completed">Completed</option>
                    <option value="failed">Failed</option>
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>

              <label>
                <span>Source ADA</span>
                <div className="bcf-select-wrap">
                  <select onChange={(event) => setSourceFilter(event.target.value)} value={sourceFilter}>
                    <option value="all">All Source ADA</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountDisplayCode(account)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>

              <label>
                <span>Destination ADA</span>
                <div className="bcf-select-wrap">
                  <select onChange={(event) => setDestinationFilter(event.target.value)} value={destinationFilter}>
                    <option value="all">All Destination ADA</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountDisplayCode(account)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>

              <label>
                <span>Date Range</span>
                <input onChange={(event) => setDateFilter(event.target.value)} type="date" value={dateFilter} />
              </label>

              <button className="bcf-btn-secondary bcf-filter-btn" type="button">
                <Filter size={15} />
                Filter
              </button>
            </section>

            <div className="bcf-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Source ADA</th>
                    <th>Destination ADA</th>
                    <th>Type</th>
                    <th className="right">Amount (USDC)</th>
                    <th>Status</th>
                    <th>Funds</th>
                    <th aria-label="actions" />
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={8}>Loading funding instructions...</td>
                    </tr>
                  ) : null}
                  {!loading && filteredInstructions.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No funding instructions found.</td>
                    </tr>
                  ) : null}
                  {filteredInstructions.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.updatedAt}</td>
                      <td className="mono" title={row.sourceAccountId}>{row.sourceAdaCode}</td>
                      <td className="mono" title={row.destinationAccountId}>{row.destinationAdaCode}</td>
                      <td>{row.type}</td>
                      <td className="right mono strong">{row.amount}</td>
                      <td>
                        <span className={`bcf-status ${statusTone(row.status)}`}>{formatStatus(row.status)}</span>
                      </td>
                      <td>{fundsAvailabilityLabel(row.status)}</td>
                      <td className="right">
                        <button
                          className="bcf-row-action"
                          onClick={() => {
                            setSelectedId(row.id);
                            navigate?.(`/business/treasury/funding/${encodeURIComponent(row.id)}`);
                          }}
                          type="button"
                          aria-label={`Open ${row.id}`}
                        >
                          <ArrowRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedId ? (
              <section className="bcf-detail-card">
                <h3>Funding Instruction Detail</h3>
                {detailLoading ? (
                  <div aria-live="polite" className="bcf-detail-loading" role="status">
                    <span aria-hidden="true" className="bcf-spinner" />
                    <span>Loading funding instruction detail...</span>
                  </div>
                ) : null}
                {!detailLoading && selectedDetail ? (
                  <>
                    <dl>
                      <div>
                        <dt>ID</dt>
                        <dd className="mono">{selectedDetail.id}</dd>
                      </div>
                      <div>
                        <dt>Source ADA</dt>
                        <dd className="mono">{apiSourceAdaCode(selectedDetail)}</dd>
                      </div>
                      <div>
                        <dt>Destination ADA</dt>
                        <dd className="mono">{apiDestinationAdaCode(selectedDetail)}</dd>
                      </div>
                      <div>
                        <dt>Funding Type</dt>
                        <dd>{selectedDetail.fundingType ?? "-"}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{formatStatus(selectedDetail.status ?? "pending")}</dd>
                      </div>
                      <div>
                        <dt>Amount</dt>
                        <dd>{formatAmountFromMinorUnits(selectedDetail.amountMinorUnits ?? "0")}</dd>
                      </div>
                      <div>
                        <dt>Pending / Reserved</dt>
                        <dd>{formatAmountFromMinorUnits(selectedDetail.pendingUsdcMinorUnits ?? "0")} USDC</dd>
                      </div>
                      <div>
                        <dt>Available</dt>
                        <dd>{formatAmountFromMinorUnits(selectedDetail.availableUsdcMinorUnits ?? "0")} USDC</dd>
                      </div>
                      {selectedDetail.supportReference ? (
                        <div>
                          <dt>Support Reference</dt>
                          <dd className="mono">{selectedDetail.supportReference}</dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="bcf-stage-list" aria-label="Funding progress">
                      {selectedOrders.map((order, index) => (
                        <article className={`bcf-stage ${statusTone(order.status ?? "created")}`} key={order.id}>
                          <span>{index + 1}</span>
                          <div>
                            <strong>{order.orderKind === "ada_wire_transfer" ? "Fiat received" : "USDC delivered"}</strong>
                            <p>{stageDescription(order)}</p>
                          </div>
                          <em>{formatStatus(order.status ?? "created")}</em>
                        </article>
                      ))}
                    </div>
                  </>
                ) : null}
              </section>
            ) : null}

            {error ? <p className="bcf-inline-error">{error}</p> : null}
            {successMessage ? <p className="bcf-inline-success">{successMessage}</p> : null}

            <footer className="bcf-pagination">
              <span>Showing 1 to {filteredInstructions.length} of {filteredInstructions.length} entries</span>
              <div>
                <button disabled type="button" aria-label="Previous page">
                  <ChevronLeft size={14} />
                </button>
                <button className="active" type="button">1</button>
                <button type="button">2</button>
                <button type="button">3</button>
                <button type="button" aria-label="Next page">
                  <ChevronRight size={14} />
                </button>
              </div>
            </footer>
          </div>
        </section>
      </div>
    </DashboardRoot>
  );
};

const apiFetch = async <T,>(
  path: string,
  token: string,
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
      authorization: `Bearer ${token}`,
      "x-correlation-id": correlationId,
      "idempotency-key": idempotencyKey
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

const amountToMinorUnits = (value: string): bigint => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0n;
  return BigInt(Math.floor(parsed * 1_000_000));
};

const formatAdaLabel = (account: AccountApi): string => {
  const name = account.accountName?.trim() || "Unnamed ADA";
  const code = account.assetCode?.trim() || "USDC";
  return `${name} (${code})`;
};

const accountDisplayCode = (account: AccountApi): string => {
  if (account.accountCode?.trim()) return account.accountCode;
  const nameSeed = (account.accountName ?? "ADA").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const purposeSeed = (account.usePurpose ?? "general").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "GEN";
  const assetSeed = (account.assetCode ?? "USDC").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
  return `DAA-${assetSeed}-${purposeSeed}-${nameSeed}`;
};

const formatAdaBalance = (account: AccountApi | undefined): string => {
  if (!account) return "-";
  return `${formatAmountFromMinorUnits(account.balances?.availableMinorUnits ?? "0")} ${account.assetCode?.trim() || "USDC"}`;
};

const formatAdaLabelWithBalance = (account: AccountApi): string =>
  `${formatAdaLabel(account)} - ${formatAdaBalance(account)} available`;

const mapInstruction = (input: FundingInstructionApi): FundingInstruction => {
  const sourceAccountId = input.sourceAccountOfDigitalAssetId ?? "-";
  const destinationAccountId = input.destinationAccountOfDigitalAssetId ?? input.accountOfDigitalAssetId ?? "-";
  return {
    id: input.id,
    sourceAccountId,
    sourceAdaCode: input.sourceAdaCode ?? input.sourceAccountCode ?? "-",
    destinationAccountId,
    destinationAdaCode: input.destinationAdaCode ?? input.destinationAccountCode ?? "-",
    type: formatStatus(input.fundingType ?? "usdc_payin"),
    amount: formatAmountFromMinorUnits(input.amountMinorUnits ?? "0"),
    status: input.status ?? "created",
    provider: "Funding network",
    updatedAt: formatDateTime(input.updatedAt)
  };
};

const apiDestinationAdaCode = (detail: FundingInstructionApi): string =>
  detail.destinationAdaCode?.trim() || detail.destinationAccountCode?.trim() || "-";

const apiSourceAdaCode = (detail: FundingInstructionApi): string =>
  detail.sourceAdaCode?.trim() || detail.sourceAccountCode?.trim() || "-";

const formatStatus = (status: string): string =>
  status.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());

const statusTone = (status: string): "completed" | "pending" | "failed" => {
  const normalized = status.toLowerCase();
  if (normalized.includes("fail") || normalized.includes("cancel") || normalized.includes("exception")) return "failed";
  if (normalized.includes("posted") || normalized.includes("confirm") || normalized.includes("complete")) return "completed";
  return "pending";
};

const fundsAvailabilityLabel = (status: string): string =>
  status === "posted_available" ? "Available" : status === "pending_usdc_reserved" ? "Pending / reserved" : "Not yet available";

const stageDescription = (order: FundingOrderApi): string => {
  if (order.orderKind === "ada_wire_transfer") {
    return order.status === "completed" ? "Your fiat receipt has been confirmed." : "Waiting for the fiat receipt confirmation.";
  }
  if (order.status === "completed") return "USDC is available in your destination account.";
  if (order.status === "blocked_dependency") return "Starts after the fiat receipt is confirmed.";
  if (order.status === "failed") return "Delivery needs support review; your confirmed funds remain reserved.";
  return "USDC delivery is in progress and is not yet spendable.";
};

const formatAmountFromMinorUnits = (minorUnits: string): string => {
  const minor = parseBigInt(minorUnits);
  const whole = minor / 1_000_000n;
  const fraction = (minor % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${whole.toLocaleString()}.${fraction}`;
};

const parseBigInt = (value: string): bigint => {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const formatDateTime = (input?: string): string => {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}Z`;
};
