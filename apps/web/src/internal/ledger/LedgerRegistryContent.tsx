import { Bell, ChevronLeft, ChevronRight, CircleHelp, Filter, HelpCircle, MoreVertical, Search, Terminal, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./ledger-registry-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type LedgerMode = "chart" | "postingRules";

interface LedgerAccount {
  accountCode: string;
  accountName: string;
  accountClass: string;
  normalBalance: string;
  status?: string;
}

interface PostingRule {
  eventType: string;
  ruleName: string;
  status: string;
  debitLedgerAccountCode?: string;
  creditLedgerAccountCode?: string;
}

export const LedgerRegistryContent = ({
  mode,
  navigate
}: {
  mode: LedgerMode;
  navigate: (path: string) => void;
}) => {
  const [accounts, setAccounts] = useState<LedgerAccount[]>([]);
  const [postingRules, setPostingRules] = useState<PostingRule[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    Promise.all([
      apiFetch<{ accounts?: LedgerAccount[] }>("/ledger/chart-of-accounts"),
      apiFetch<{ postingRules?: PostingRule[] }>("/ledger/posting-rules")
    ])
      .then(([accountsPayload, rulesPayload]) => {
        if (!active) return;
        setAccounts((accountsPayload.accounts ?? []).map(normalizeAccount));
        setPostingRules((rulesPayload.postingRules ?? []).map(normalizePostingRule));
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setAccounts([]);
        setPostingRules([]);
        setError(caught instanceof Error ? caught.message : "ledger_registry_fetch_failed");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="ledger-scope">
      {mode === "chart" ? (
        <LedgerTopBar
          activeMode={mode}
          navigate={navigate}
          placeholder="Search accounts, codes, or ledgers..."
        />
      ) : null}
      {status === "error" ? <div className="ledger-notice">Unable to load database-backed ledger rows: {error}</div> : null}
      {mode === "chart" ? (
        <ChartOfAccountsView accounts={accounts} loading={status === "loading"} />
      ) : (
        <PostingRulesView accounts={accounts} loading={status === "loading"} postingRules={postingRules} />
      )}
    </section>
  );
};

const LedgerTopBar = ({
  activeMode,
  navigate,
  placeholder
}: {
  activeMode: LedgerMode;
  navigate: (path: string) => void;
  placeholder: string;
}) => (
  <header className="ledger-topbar">
    <div className="ledger-search">
      <Search size={15} />
      <input placeholder={placeholder} type="search" />
    </div>
    <nav aria-label="Ledger registry views">
      <button
        className={activeMode === "chart" ? "active" : ""}
        onClick={() => navigate("/internal/operations/ledger/chart-of-accounts")}
        type="button"
      >
        Chart
      </button>
      <button
        className={activeMode === "postingRules" ? "active" : ""}
        onClick={() => navigate("/internal/operations/ledger/posting-rules")}
        type="button"
      >
        Posting Rules
      </button>
    </nav>
    <div className="ledger-user-strip">
      <span>Treasury Admin</span>
      <button title="Notifications" type="button"><Bell size={16} /></button>
      <button title="Help" type="button"><HelpCircle size={16} /></button>
      <div><User size={15} /></div>
    </div>
  </header>
);

const ChartOfAccountsView = ({ accounts, loading }: { accounts: LedgerAccount[]; loading: boolean }) => {
  const stats = useMemo(() => {
    const active = accounts.filter((account) => account.status === "Active").length;
    const assetCount = accounts.filter((account) => account.accountClass === "Asset").length;
    const pendingAudit = accounts.filter((account) => account.status !== "Active").length;
    return { active, assetCount, pendingAudit, total: accounts.length };
  }, [accounts]);

  return (
    <div className="ledger-content">
      <header className="ledger-page-header">
        <div>
          <h1>Chart of Accounts</h1>
          <p>A comprehensive ledger of financial classification and structural controls.</p>
        </div>
        <div className="ledger-filter-row">
          <span>Filter By:</span>
          <select>
            <option>All Account Types</option>
            <option>Asset</option>
            <option>Liability</option>
            <option>Equity</option>
            <option>Revenue</option>
            <option>Expense</option>
          </select>
          <button type="button"><Filter size={14} /> Advanced</button>
        </div>
      </header>

      <section className="ledger-stat-grid">
        <LedgerStat label="Total Accounts" value={String(stats.total)} />
        <LedgerStat label="Active Ledgers" value={String(stats.active)} />
        <LedgerStat label="Total Assets" value={String(stats.assetCount)} />
        <LedgerStat accented label="Pending Audit" value={String(stats.pendingAudit).padStart(2, "0")} />
      </section>

      <section className="ledger-table-card">
        <div>
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Account Name</th>
                <th>Classification</th>
                <th>Normal Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6}>Loading chart of accounts from database...</td></tr> : null}
              {!loading && accounts.length === 0 ? <tr><td colSpan={6}>No ledger accounts found.</td></tr> : null}
              {!loading && accounts.map((account) => (
                <tr key={account.accountCode}>
                  <td><code>{account.accountCode}</code></td>
                  <td>{account.accountName}</td>
                  <td><span className="ledger-tag">{account.accountClass}</span></td>
                  <td className="center"><span className="ledger-caps">{account.normalBalance}</span></td>
                  <td className="center"><StatusTag status={account.status ?? "Active"} /></td>
                  <td className="right"><button title="Account actions" type="button"><MoreVertical size={16} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <span>Showing <b>{accounts.length ? `1-${accounts.length}` : "0"}</b> of <b>{Math.max(accounts.length, 248)}</b> accounts</span>
          <div>
            <button type="button"><ChevronLeft size={14} /></button>
            <button className="active" type="button">1</button>
            <button type="button">2</button>
            <button type="button">3</button>
            <span>...</span>
            <button type="button"><ChevronRight size={14} /></button>
          </div>
        </footer>
      </section>

      <footer className="ledger-page-footer">
        <span>Confidential - Internal Treasury Use Only</span>
        <span>Last Sync: {formatTimestamp(new Date())}</span>
      </footer>
    </div>
  );
};

const PostingRulesView = ({
  accounts,
  loading,
  postingRules
}: {
  accounts: LedgerAccount[];
  loading: boolean;
  postingRules: PostingRule[];
}) => {
  const accountByCode = useMemo(() => new Map(accounts.map((account) => [account.accountCode, account])), [accounts]);
  const active = postingRules.filter((rule) => rule.status === "Active").length;
  const draft = postingRules.filter((rule) => rule.status !== "Active").length;

  return (
    <div className="ledger-posting-rules-page">
      <header className="posting-rules-header">
        <div className="posting-rules-search">
          <Search size={18} />
          <input placeholder="Search event types..." type="search" />
        </div>
        <div className="posting-rules-user">
          <button title="Notifications" type="button"><Bell size={20} /></button>
          <button title="Help" type="button"><CircleHelp size={20} /></button>
          <section>
            <p>Admin_01</p>
            <span>Level 4 Access</span>
          </section>
          <div><User size={20} /></div>
        </div>
      </header>

      <main className="posting-rules-content">
        <section className="posting-rules-title">
          <div>
            <h1>Posting Rules</h1>
            <code>v2.4.12-PROD</code>
          </div>
          <p>Define and manage the double-entry accounting logic for all transaction events. Rules dictate how asset movement is recorded across the general ledger and specific dimension silos.</p>
        </section>

        <section className="posting-rules-stats">
          <LedgerStat label="Active Rules" value={String(active)} />
          <LedgerStat label="Draft State" value={String(draft).padStart(2, "0")} />
          <LedgerStat label="Daily Volume" value="1.2k" />
          <LedgerStat label="Last Sync" value={formatTime(new Date())} mono />
        </section>

        <section className="posting-rules-table-card">
          <table className="posting-rules-table">
            <thead>
              <tr>
                <th>Event Type</th>
                <th>Rule Name</th>
                <th>Status</th>
                <th>Debit Account</th>
                <th>Credit Account</th>
                <th>Dimensions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={6}>Loading posting rules from database...</td></tr> : null}
              {!loading && postingRules.length === 0 ? <tr><td colSpan={6}>No posting rules found.</td></tr> : null}
              {!loading && postingRules.map((rule) => {
                const debit = accountByCode.get(rule.debitLedgerAccountCode ?? "");
                const credit = accountByCode.get(rule.creditLedgerAccountCode ?? "");
                return (
                  <tr key={rule.eventType}>
                    <td><code>{rule.eventType}</code></td>
                    <td><strong>{rule.ruleName}</strong></td>
                    <td className="center"><StatusTag status={rule.status} /></td>
                    <td><AccountCode code={rule.debitLedgerAccountCode} name={debit?.accountName} /></td>
                    <td><AccountCode code={rule.creditLedgerAccountCode} name={credit?.accountName} /></td>
                    <td><DimensionTags eventType={rule.eventType} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="posting-rules-panels">
          <article>
          <h2>Dimension Hierarchy</h2>
          <p>Dimensions act as tagging metadata for every journal entry. They ensure that even if money moves through the same GL account, the underlying intent remains searchable and auditable.</p>
          <div>
            <section>
              <h3>Level 1: System</h3>
              <ul>
              <li>Account Code</li>
              <li>Timestamp</li>
              <li>Trace ID</li>
            </ul>
            </section>
            <section>
              <h3>Level 2: User Defined</h3>
              <ul>
              <li>Portfolio Cluster</li>
              <li>Strategy Identifier</li>
              <li>Risk Category</li>
            </ul>
            </section>
          </div>
        </article>
        <aside>
            <Terminal size={34} />
          <h2>Integration Sandbox</h2>
            <p>Test posting logic against the sandbox ledger before pushing to production. Validates against DAA compliance protocols.</p>
          <button type="button">Launch Simulator</button>
        </aside>
        </section>
      </main>

      <footer className="posting-rules-statusbar">
        <div>
          <span><i /> System Status: Online</span>
          <span>Ledger Latency: 12ms</span>
        </div>
        <code>Capital-Treasury-01 // v2.4.12</code>
      </footer>
    </div>
  );
};

const LedgerStat = ({ accented, label, mono, value }: { accented?: boolean; label: string; mono?: boolean; value: string }) => (
  <article className={accented ? "accented" : ""}>
    <span>{label}</span>
    <strong className={mono ? "mono" : ""}>{value}</strong>
  </article>
);

const StatusTag = ({ status }: { status: string }) => {
  const normalized = normalizeStatus(status);
  return <span className={`ledger-status ${normalized}`}>{normalized}</span>;
};

const AccountCode = ({ code, name }: { code?: string; name?: string }) => (
  <div className="ledger-account-ref">
    <code>{code ?? "Not mapped"}</code>
    <span>{name ?? "Ledger account mapping pending"}</span>
  </div>
);

const DimensionTags = ({ eventType }: { eventType: string }) => {
  const values = eventType.includes("opening")
    ? ["ENTITY", "ADA_ID"]
    : eventType.includes("fee")
      ? ["DEPT:OPS", "PRODUCT"]
      : ["ENTITY", "CCY:USD"];
  return <div className="ledger-dimensions">{values.map((value) => <span key={value}>{value}</span>)}</div>;
};

const apiFetch = async <T,>(path: string): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    headers: {
      authorization: `Bearer ${gttApiKey}`
    }
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `${path}:${response.status}`);
  return payload;
};

const normalizeAccount = (account: LedgerAccount): LedgerAccount => ({
  accountCode: account.accountCode,
  accountName: account.accountName,
  accountClass: capitalize(account.accountClass),
  normalBalance: capitalize(account.normalBalance),
  status: account.status ? capitalize(account.status) : "Active"
});

const normalizePostingRule = (rule: PostingRule): PostingRule => ({
  eventType: rule.eventType,
  ruleName: rule.ruleName,
  status: capitalize(rule.status),
  debitLedgerAccountCode: rule.debitLedgerAccountCode,
  creditLedgerAccountCode: rule.creditLedgerAccountCode
});

const normalizeStatus = (value: string): string => capitalize(value).replace(/_/g, " ");

const capitalize = (value: string): string => value ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : value;

const formatTimestamp = (value: Date): string =>
  `${new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(value)} - ${formatTime(value)}`;

const formatTime = (value: Date): string =>
  new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(value);
