import {
  ArrowRight,
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  CloudCog,
  Download,
  Filter,
  GitMerge,
  Handshake,
  Info,
  Link as LinkIcon,
  Lock,
  RefreshCw,
  Search,
  TrendingUp,
  Wallet,
  X
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import "./ledger-operations-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type LedgerOperationMode = "dashboard" | "registerLedger" | "registerLedgerSuccess" | "openingJournal" | "openingJournalSuccess";

interface AdaAccount {
  id: string;
  businessClientId: string;
  businessClientName?: string;
  accountName: string;
  usePurpose: string;
  status: string;
  assetCode?: string;
  assetRail?: string;
  createdAt?: string;
}

interface OpeningJournalSummary {
  account: AdaAccount;
  amountMinorUnits: string;
  correlationId: string;
  idempotencyKey: string;
  journal: {
    id: string;
    description?: string;
    createdAt?: string;
  };
  ledgerName: string;
}

export const LedgerOperationsContent = ({
  mode,
  navigate
}: {
  mode: LedgerOperationMode;
  navigate: (path: string) => void;
}) => {
  const [accounts, setAccounts] = useState<AdaAccount[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<OpeningJournalSummary | undefined>();

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    apiFetch<{ accounts?: AdaAccount[] }>("/accounts-of-digital-asset")
      .then((payload) => {
        if (!active) return;
        setAccounts(payload.accounts ?? []);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setAccounts([]);
        setError(caught instanceof Error ? caught.message : "ledger_accounts_fetch_failed");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  const registerLedger = async (input: {
    accountOfDigitalAssetId: string;
    amountMinorUnits: string;
    correlationId: string;
    description: string;
    idempotencyKey: string;
    ledgerName: string;
  }) => {
    const account = accounts.find((item) => item.id === input.accountOfDigitalAssetId);
    if (!account) throw new Error("account_not_found");
    const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
    const correlationId = input.correlationId || crypto.randomUUID();
    const payload = await apiFetch<{ journal: OpeningJournalSummary["journal"] }>("/ledger/events/opening-journal", {
      body: {
        accountOfDigitalAssetId: input.accountOfDigitalAssetId,
        amountMinorUnits: input.amountMinorUnits,
        description: input.description
      },
      headers: {
        "idempotency-key": idempotencyKey,
        "x-correlation-id": correlationId
      },
      method: "POST"
    });
    const nextSummary = {
      account,
      amountMinorUnits: input.amountMinorUnits,
      correlationId,
      idempotencyKey,
      journal: payload.journal,
      ledgerName: input.ledgerName
    };
    setSummary(nextSummary);
    navigate("/internal/operations/ledger/opening-journal/success");
  };

  return (
    <section className="ledger-ops-scope">
      {status === "error" ? <div className="ledger-ops-notice">Unable to load database-backed ADA ledgers: {error}</div> : null}
      {mode === "registerLedger" ? (
        <RegisterNewLedgerView
          accounts={accounts}
          loading={status === "loading"}
          onCancel={() => navigate("/internal/operations/ledger/active-ledgers")}
          onSubmit={registerLedger}
        />
      ) : mode === "registerLedgerSuccess" ? (
        <LedgerSuccessView
          onGoHome={() => navigate("/internal/operations/ledger/active-ledgers")}
          onNewLedger={() => navigate("/internal/operations/ledger/register")}
          summary={summary}
        />
      ) : mode === "openingJournal" ? (
        <LedgerRegisterView
          accounts={accounts}
          loading={status === "loading"}
          onCancel={() => navigate("/internal/operations/ledger/active-ledgers")}
          onReviewPostingRules={() => navigate("/internal/operations/ledger/posting-rules")}
          onSubmit={registerLedger}
        />
      ) : mode === "openingJournalSuccess" ? (
        <LedgerSuccessView
          onGoHome={() => navigate("/internal/operations/ledger/active-ledgers")}
          onNewLedger={() => navigate("/internal/operations/ledger/opening-journal")}
          summary={summary}
        />
      ) : (
        <LedgerDashboardView
          accounts={accounts}
          loading={status === "loading"}
          onRegister={() => navigate("/internal/operations/ledger/register")}
        />
      )}
    </section>
  );
};

const LedgerDashboardView = ({
  accounts,
  loading,
  onRegister
}: {
  accounts: AdaAccount[];
  loading: boolean;
  onRegister: () => void;
}) => {
  const stats = useMemo(() => {
    const active = accounts.filter((account) => normalizeStatus(account.status) === "active").length;
    const restricted = accounts.filter((account) => normalizeStatus(account.status) !== "active").length;
    return { active, restricted, total: accounts.length };
  }, [accounts]);

  return (
    <div className="ledger-ops-dashboard">
      <header className="ledger-ops-hero">
        <div>
          <span>Custody Operations</span>
          <h1>Active Ledgers</h1>
          <p>Real-time monitoring of institutional clearing accounts and rail parity.</p>
        </div>
        <div>
          <button type="button"><Download size={15} /> Export Audit Log</button>
          <button className="primary" type="button"><RefreshCw size={15} /> Reconcile Now</button>
          <button className="primary" onClick={onRegister} type="button">Register Ledger</button>
        </div>
      </header>

      <section className="ledger-ops-stat-grid">
        <LedgerOpsStat detail="Loaded from accounts_of_digital_asset" icon label="Total Active Ledgers" value={String(stats.active)} />
        <LedgerOpsStat detail="Reconciliation data not loaded" label="Aggregate Parity" value="Unavailable" />
        <LedgerOpsStat detail="Journal totals require statement query" label="24H Volume" value="Unavailable" />
        <LedgerOpsStat detail="Non-active ADA accounts" label="Open Recon Breaks" value={String(stats.restricted)} />
      </section>

      <section className="ledger-ops-table-section">
        <header>
          <h2>Ledger Registry</h2>
          <div>
            <button title="Filter" type="button"><Filter size={15} /></button>
            <button title="Search" type="button"><Search size={15} /></button>
          </div>
        </header>
        <div>
          <table className="ledger-ops-table">
            <thead>
              <tr>
                <th>ADA ID</th>
                <th>Client Entity</th>
                <th>Purpose</th>
                <th>Asset</th>
                <th>Current Balance</th>
                <th>Last Activity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7}>Loading active ledgers from database...</td></tr> : null}
              {!loading && accounts.length === 0 ? <tr><td colSpan={7}>No active ledgers found.</td></tr> : null}
              {!loading && accounts.map((account) => (
                <tr key={account.id}>
                  <td><code>{account.id}</code></td>
                  <td>{account.businessClientName ?? account.businessClientId}</td>
                  <td><span>{formatLabel(account.usePurpose)}</span></td>
                  <td>{account.assetCode ?? "USDC"}</td>
                  <td className="numeric">Unavailable</td>
                  <td>{recentActivity(account.createdAt)}</td>
                  <td><StatusBadge status={account.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <span>Showing {accounts.length} database-backed ADA ledger references.</span>
          <div>
            <button type="button"><ChevronLeft size={14} /> Previous</button>
            <button type="button">Next <ChevronRight size={14} /></button>
          </div>
        </footer>
      </section>

      <section className="ledger-ops-bottom-grid">
        <article>
          <h3>Rail Status Feed</h3>
          <div>
            <RailStatus label="SWIFT GPI" meta="Status endpoint not connected" value="Unavailable" />
            <RailStatus label="FEDWIRE" meta="Status endpoint not connected" value="Unavailable" />
            <RailStatus label="ETHEREUM L2" meta="Status endpoint not connected" value="Unavailable" />
          </div>
        </article>
        <aside>
          <h3>System Notifications</h3>
          <p>No database-backed ledger notifications are loaded in this view.</p>
        </aside>
      </section>
    </div>
  );
};

const RegisterNewLedgerView = ({
  accounts,
  loading,
  onCancel,
  onSubmit
}: {
  accounts: AdaAccount[];
  loading: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    accountOfDigitalAssetId: string;
    amountMinorUnits: string;
    correlationId: string;
    description: string;
    idempotencyKey: string;
    ledgerName: string;
  }) => Promise<void>;
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [correlationId] = useState(() => crypto.randomUUID());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (accounts.length > 0 && (!selectedAccountId || !accounts.some((account) => account.id === selectedAccountId))) {
      setSelectedAccountId(accounts[0]!.id);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? accounts[0];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData(event.currentTarget);
    const ledgerName = stringForm(form, "ledgerName", "Q4_SETTLEMENT_CORE");
    const amountMinorUnits = decimalToMinorUnits(stringForm(form, "initialBalance", "0"));
    try {
      await onSubmit({
        accountOfDigitalAssetId: stringForm(form, "accountOfDigitalAssetId", selectedAccountId),
        amountMinorUnits,
        correlationId,
        description: stringForm(form, "businessJustification", `${ledgerName} opening journal registration`),
        idempotencyKey,
        ledgerName
      });
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "ledger_registration_failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ledger-ops-register">
      <section className="ledger-ops-register-card">
        <header>
          <span>Operational Treasury</span>
          <h1>Register New Ledger</h1>
          <p>Initialize a cryptographically verifiable settlement ledger. All entries are immutable and subject to the Node Alpha governance protocol.</p>
        </header>

        <form onSubmit={handleSubmit}>
          <LedgerFormBlock index="01" title="Ledger Definition">
            <label>
              <span>Ledger Name</span>
              <input defaultValue="Q4_SETTLEMENT_CORE" name="ledgerName" placeholder="e.g. Q4_SETTLEMENT_CORE" required type="text" />
            </label>
            <label>
              <span>Client Entity</span>
              <select defaultValue={selectedAccount?.businessClientName ?? selectedAccount?.businessClientId ?? ""} name="clientEntity">
                {accounts.length ? accounts.map((account) => (
                  <option key={account.id} value={account.businessClientName ?? account.businessClientId}>
                    {account.businessClientName ?? account.businessClientId}
                  </option>
                )) : (
                  <option value="">No database-backed ADA account available</option>
                )}
              </select>
            </label>
            <div className="wide">
              <span>Purpose</span>
              <div className="ledger-purpose-grid">
                <LedgerPurposeOption defaultChecked icon={Wallet} label="Custody" value="custody" />
                <LedgerPurposeOption icon={GitMerge} label="Netting" value="netting" />
                <LedgerPurposeOption icon={Banknote} label="Payment" value="payment" />
                <LedgerPurposeOption icon={Handshake} label="Settlement" value="settlement" />
              </div>
            </div>
          </LedgerFormBlock>

          <LedgerFormBlock index="02" title="Asset & Rail Configuration">
            <label>
              <span>Base Asset</span>
              <select name="baseAsset">
                <option value="USDC">USDC (Circle USD)</option>
                <option value="EURC">EURC (Circle Euro)</option>
                <option value="WBTC">WBTC (Wrapped Bitcoin)</option>
                <option value="ETH">ETH (Ethereum Native)</option>
              </select>
            </label>
            <label>
              <span>Primary Settlement Rail</span>
              <select name="rail">
                <option value="FEDWIRE">FEDWIRE (Real-time Gross)</option>
                <option value="SWIFT">SWIFT (International)</option>
                <option value="ETHEREUM_L2">ETHEREUM L2 (Optimism)</option>
                <option value="CHIPS">CHIPS (Netting System)</option>
              </select>
            </label>
          </LedgerFormBlock>

          <LedgerFormBlock index="03" title="Accounting Parameters">
            <label>
              <span>Initial Balance</span>
              <input inputMode="decimal" name="initialBalance" placeholder="0.00" step="0.01" type="number" />
            </label>
            <label>
              <span>Minor Units</span>
              <input readOnly value="6 decimals" />
            </label>
            <label className="wide">
              <span>Linked Digital Asset Account (ADA)</span>
              <select name="accountOfDigitalAssetId" onChange={(event) => setSelectedAccountId(event.target.value)} value={selectedAccountId}>
                {loading ? <option value="">Loading ADA accounts...</option> : null}
                {!loading && accounts.length === 0 ? <option value="">No ADA accounts available</option> : null}
                {!loading && accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountName} / {displayAdaAccountCode(account)}
                  </option>
                ))}
              </select>
              <div className="ledger-linked-ada">
                <LinkIcon size={18} />
                <div>
                  <b>{selectedAccount?.accountName ?? "No ADA selected"}</b>
                  <p>{selectedAccount ? displayAdaAccountCode(selectedAccount) : "Unavailable"}</p>
                </div>
                <ChevronDown size={18} />
              </div>
            </label>
          </LedgerFormBlock>

          <LedgerFormBlock index="04" title="Governance & Audit">
            <label>
              <span>Idempotency Key</span>
              <input readOnly value={idempotencyKey} />
            </label>
            <label>
              <span>Correlation ID</span>
              <input readOnly value={correlationId} />
            </label>
            <label className="wide">
              <span>Business Justification</span>
              <textarea name="businessJustification" placeholder="Briefly describe the purpose of this ledger for audit purposes..." rows={4} />
            </label>
          </LedgerFormBlock>

          {submitError ? <div className="form-error">{submitError}</div> : null}
          <footer>
            <button onClick={onCancel} type="button">Cancel</button>
            <button className="primary" disabled={submitting || accounts.length === 0} type="submit">
              {submitting ? "Posting..." : "Register Ledger"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
};

const LedgerPurposeOption = ({
  defaultChecked,
  icon: Icon,
  label,
  value
}: {
  defaultChecked?: boolean;
  icon: typeof Wallet;
  label: string;
  value: string;
}) => (
  <label>
    <input defaultChecked={defaultChecked} name="purpose" type="radio" value={value} />
    <Icon size={18} strokeWidth={1.5} />
    <span>{label}</span>
  </label>
);

const LedgerFormBlock = ({ children, index, title }: { children: React.ReactNode; index: string; title: string }) => (
  <section className="ledger-form-block">
    <header><span>{index}</span><h2>{title}</h2></header>
    <div>{children}</div>
  </section>
);

const LedgerRegisterView = ({
  accounts,
  loading,
  onCancel,
  onReviewPostingRules,
  onSubmit
}: {
  accounts: AdaAccount[];
  loading: boolean;
  onCancel: () => void;
  onReviewPostingRules: () => void;
  onSubmit: (input: {
    accountOfDigitalAssetId: string;
    amountMinorUnits: string;
    correlationId: string;
    description: string;
    idempotencyKey: string;
    ledgerName: string;
  }) => Promise<void>;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [amount, setAmount] = useState("500000.00");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [correlationId] = useState(() => crypto.randomUUID());
  const defaultAccountId = accounts[0]?.id ?? "";
  const [selectedAccountId, setSelectedAccountId] = useState("");

  useEffect(() => {
    if (accounts.length > 0 && (!selectedAccountId || !accounts.some((account) => account.id === selectedAccountId))) {
      setSelectedAccountId(accounts[0]!.id);
    }
  }, [accounts, selectedAccountId]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData(event.currentTarget);
    try {
      await onSubmit({
        accountOfDigitalAssetId: stringForm(form, "accountOfDigitalAssetId", selectedAccountId || defaultAccountId),
        amountMinorUnits: decimalToMinorUnits(amount),
        correlationId,
        description: stringForm(form, "businessJustification", "Opening journal posting"),
        idempotencyKey,
        ledgerName: stringForm(form, "ledgerName", "OPENING_JOURNAL")
      });
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "ledger_registration_failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="ledger-ops-open-journal">
      <header className="open-journal-header">
        <div>
          <h1>Post Opening Journal</h1>
          <p>Establish new asset positions in the master ledger hierarchy.</p>
        </div>
        <button onClick={onReviewPostingRules} type="button">Review Posting Rules</button>
      </header>

      <div className="open-journal-layout">
        <form className="open-journal-form" onSubmit={handleSubmit}>
          <OpenJournalBlock index="01" title="Transaction Identity">
            <label>
              <span>Idempotency Key</span>
              <div className="open-journal-locked-field">
                <input readOnly value={idempotencyKey} />
                <Lock size={16} />
              </div>
              <small>UUID used for operational safety and retry protection.</small>
            </label>
            <label>
              <span>Correlation ID</span>
              <input readOnly value={correlationId} />
              <small>UUID attached to the resulting audit event.</small>
            </label>
          </OpenJournalBlock>

          <OpenJournalBlock index="02" title="Ledger Mapping">
            <label>
              <span>Digital Asset Account (ADA)</span>
              <select name="accountOfDigitalAssetId" onChange={(event) => setSelectedAccountId(event.target.value)} required value={selectedAccountId}>
                {loading ? <option value="">Loading ADA accounts...</option> : null}
                {!loading && accounts.length === 0 ? <option value="">No ADA accounts available</option> : null}
                {!loading && accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.accountName} / {displayAdaAccountCode(account)}
                  </option>
                ))}
              </select>
              <small>ADA UUID: {selectedAccountId || "Select an ADA account"}</small>
            </label>
            <label>
              <span>Posting Rule</span>
              <select name="ledgerName">
                <option value="SEED_OPERATIONAL_FLOAT">SEED_OPERATIONAL_FLOAT</option>
                <option value="CAPITAL_INFUSION_RESERVE">CAPITAL_INFUSION_RESERVE</option>
                <option value="YIELD_REBALANCING_CREDIT">YIELD_REBALANCING_CREDIT</option>
              </select>
              <b>Active</b>
            </label>
          </OpenJournalBlock>

          <section className="open-journal-block open-journal-value-entry">
            <h2>03 / Value Entry</h2>
            <div>
              <label>
                <span>Amount (USDC)</span>
                <input inputMode="decimal" onChange={(event) => setAmount(event.target.value)} required value={amount} />
                <small>Precision: 6 decimal places are converted to minor units.</small>
              </label>
              <aside>
                <h3>Balance Preview</h3>
                <p><span>Debit target</span><code>+ {formatUsdcAmount(amount)}</code></p>
                <p><span>Credit target</span><code>- {formatUsdcAmount(amount)}</code></p>
                <footer><span>Net Ledger Impact</span><code>0.00 USDC</code></footer>
              </aside>
            </div>
          </section>

          <OpenJournalBlock index="04" title="Metadata">
            <label className="wide">
              <span>Audit Description</span>
              <textarea name="businessJustification" placeholder="Specify the reason for this opening journal posting..." rows={3} />
              <small>Required for regulatory reporting and AML/KYB audit trail.</small>
            </label>
          </OpenJournalBlock>

          {submitError ? <div className="form-error">{submitError}</div> : null}
          <footer className="open-journal-actions">
            <button onClick={() => setShowPreview(true)} type="button">Validate & Preview</button>
            <button className="primary" disabled={submitting || accounts.length === 0} type="submit">
              {submitting ? "Posting..." : "Post to Ledger"}
            </button>
          </footer>
        </form>

        <aside className="open-journal-evidence">
          <section>
            <h3>System Readiness</h3>
            <Readiness label="Ledger API" value="Not queried" />
            <Readiness label="Seed Status" value="Not queried" />
            <Readiness icon={<CloudCog size={16} />} label="Node Sync" value="Not queried" />
          </section>
          <section>
            <h3>Recent Journals (Today)</h3>
            <p>Journal history is not loaded in this view. Use the audited journal ledger once the statement endpoint is available.</p>
            <button type="button">View All Journal History</button>
          </section>
          <section className="open-journal-protocol">
            <Info size={24} />
            <h3>Treasury Protocol</h3>
            <p>Opening journals are immutable after ledger confirmation. Retain the generated idempotency key for reconciliation in case of network interruption.</p>
          </section>
        </aside>
      </div>

      {showPreview ? <OpenJournalPreview amount={amount} correlationId={correlationId} idempotencyKey={idempotencyKey} onClose={() => setShowPreview(false)} /> : null}
    </div>
  );
};

const LedgerSuccessView = ({
  onGoHome,
  onNewLedger,
  summary
}: {
  onGoHome: () => void;
  onNewLedger: () => void;
  summary?: OpeningJournalSummary;
}) => (
  <div className="ledger-ops-journal-success">
    <section className="journal-success-header">
      <div>
        <CheckCircle2 size={32} />
        <span>Transaction Confirmed</span>
      </div>
      <h1>Journal Posted Successfully.</h1>
      <div>
        <p><span>Internal Reference ID</span><b>{summary?.journal.id ?? "No journal loaded"}</b></p>
        <p><span>Timestamp</span><b>{summary?.journal.createdAt ? formatDateTime(summary.journal.createdAt) : "No journal loaded"}</b></p>
      </div>
    </section>

    <section className="journal-impact-card">
      <h2>Accounting Impact Summary</h2>
      <div className="journal-impact-top">
        <article>
          <span>Impacted Digital Asset Account (ADA)</span>
          <div><Wallet size={24} /><p><b>{summary?.account.accountName ?? "No ADA loaded"}</b><code>{summary?.account.id ?? "Unavailable"}</code></p></div>
        </article>
        <aside><span>Total Value Post</span><b>{summary ? `${formatMinorUnits(summary.amountMinorUnits)} USDC` : "Unavailable"}</b></aside>
      </div>
      <div className="journal-impact-lines">
        <header><span>Account Type</span><span>Reference</span><span>Debit</span><span>Credit</span></header>
        <p><b>Asset: USDC</b><span>{summary?.account.id ?? "Unavailable"}</span><code>{summary ? formatMinorUnits(summary.amountMinorUnits) : "Unavailable"}</code><code>--</code></p>
        <p><b>Equity: Treasury</b><span>{summary?.journal.id ?? "Unavailable"}</span><code>--</code><code>{summary ? formatMinorUnits(summary.amountMinorUnits) : "Unavailable"}</code></p>
      </div>
    </section>

    <section className="journal-evidence-card">
      <h2>Evidence & Traceability</h2>
      <div>
        <Trace label="Correlation ID" value={summary?.correlationId ?? "Unavailable"} />
        <Trace label="Idempotency Key" value={summary?.idempotencyKey ?? "Unavailable"} />
        <article><span>Persistence</span><p><i /> {summary ? "Database journal recorded" : "No journal loaded"}</p></article>
      </div>
    </section>

    <section className="journal-next-actions">
      <h2>Next Steps</h2>
      <div>
        <button className="primary" onClick={onGoHome} type="button">View Account Statement <ArrowRight size={15} /></button>
        <button onClick={onNewLedger} type="button">Post Another Journal</button>
        <button type="button"><Download size={15} /> Download Receipt (PDF)</button>
      </div>
    </section>
  </div>
);

const OpenJournalBlock = ({ children, index, title }: { children: React.ReactNode; index: string; title: string }) => (
  <section className="open-journal-block">
    <h2>{index} / {title}</h2>
    <div>{children}</div>
  </section>
);

const Readiness = ({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) => (
  <p>
    <span>{label}</span>
    <b>{value}{icon ?? <CheckCircle2 size={16} />}</b>
  </p>
);

const OpenJournalPreview = ({
  amount,
  correlationId,
  idempotencyKey,
  onClose
}: {
  amount: string;
  correlationId: string;
  idempotencyKey: string;
  onClose: () => void;
}) => (
  <div className="open-journal-preview-backdrop">
    <section className="open-journal-preview">
      <header>
        <h2>Validation & Preview</h2>
        <div><CheckCircle2 size={16} /><span>Draft Preview</span></div>
        <button aria-label="Close preview" onClick={onClose} type="button"><X size={16} /></button>
      </header>
      <div>
        <section>
          <h3>Transaction Identity</h3>
          <div className="preview-grid">
            <p><span>Idempotency Key</span><code>{idempotencyKey}</code></p>
            <p><span>Correlation ID</span><code>{correlationId}</code></p>
          </div>
        </section>
        <section>
          <h3>Ledger Impact Draft</h3>
          <div className="preview-ledger-lines">
            <p><span>Posting target</span><b>Debit Account</b><code>+ {formatUsdcAmount(amount)}</code></p>
            <p><span>Posting target</span><b>Credit Account</b><code>- {formatUsdcAmount(amount)}</code></p>
          </div>
        </section>
      </div>
      <footer>
        <button className="primary" onClick={onClose} type="button">Close Preview</button>
      </footer>
    </section>
  </div>
);

const LedgerOpsStat = ({ detail, icon, label, value }: { detail: string; icon?: boolean; label: string; value: string }) => (
  <article>
    <span>{label}</span>
    <p>{value}</p>
    <small>{icon ? <TrendingUp size={14} /> : null}{detail}</small>
  </article>
);

const RailStatus = ({ label, meta, value }: { label: string; meta: string; value: string }) => (
  <div>
    <header><span>{label}</span><i /></header>
    <p>{value}</p>
    <small>{meta}</small>
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const normalized = normalizeStatus(status);
  return <span className={`ledger-ops-status ${normalized}`}>{normalized.toUpperCase()}</span>;
};

const Trace = ({ label, value }: { label: string; value: string }) => (
  <div><span>{label}</span><code>{value}</code></div>
);

const apiFetch = async <T,>(
  path: string,
  options: { body?: Record<string, unknown>; headers?: Record<string, string>; method?: string } = {}
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${path}:${response.status}`);
  return payload;
};

const stringForm = (form: FormData, key: string, fallback = ""): string => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const decimalToMinorUnits = (value: string): string => {
  const normalized = value.replace(/,/g, "").trim();
  const [whole = "0", fraction = ""] = normalized.split(".");
  const paddedFraction = `${fraction}000000`.slice(0, 6);
  const minor = BigInt(whole || "0") * 1000000n + BigInt(paddedFraction || "0");
  return minor.toString();
};

const normalizeStatus = (value: string): string => value.toLowerCase().replace(/\s+/g, "_");

const formatLabel = (value: string): string => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const displayAdaAccountCode = (account: AdaAccount): string =>
  account.id.toUpperCase().startsWith("ADA") ? account.id : `ADA-${account.id.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;

const formatUsdcAmount = (value: string): string => {
  const amount = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(amount)) return "0.00 USDC";
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 2 })} USDC`;
};

const formatMinorUnits = (value?: string): string => {
  if (!value) return "0.00";
  const minorUnits = BigInt(value);
  const whole = minorUnits / 1000000n;
  const fraction = (minorUnits % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ".00"}`;
};

const formatDateTime = (value?: string): string => {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    second: "2-digit",
    year: "numeric"
  }).format(date);
};

const recentActivity = (value?: string): string => {
  if (!value) return "No activity";
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return "Recently";
  const minutes = Math.max(0, Math.round((Date.now() - date) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};
