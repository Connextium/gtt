import {
  ArrowLeft,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Copy,
  Download,
  Edit2,
  Eye,
  Filter,
  History,
  Info,
  Link as LinkIcon,
  Lock,
  MoreHorizontal,
  Network,
  PersonStanding,
  Plus,
  SlidersHorizontal,
  X
} from "lucide-react";
import type React from "react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./ada-management-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type AdaRouteMode = "list" | "new" | "success" | "detail" | "instruments" | "linkRail" | "linkRailSuccess";

interface AdaAccount {
  id: string;
  tenantId?: string;
  businessClientId: string;
  businessClientName?: string;
  accountName: string;
  usePurpose: string;
  status: string;
  assetCode?: string;
  assetRail?: string;
  circleAccountId?: string;
  circleSubAccountId?: string;
  createdAt?: string;
}

interface BusinessClient {
  id: string;
  legalName: string;
  country?: string;
  onboardingStatus: string;
}

interface ProvisionedAdaSummary {
  account: AdaAccount;
  correlationId: string;
  idempotencyKey: string;
}

interface LinkedInstrumentRail {
  id: string;
  instrumentType: string;
  railCode?: string;
  railName?: string;
  assetCode?: string;
  externalReference?: string;
  status: string;
}

interface LinkedFiatAccount {
  id: string;
  bankName: string;
  accountNumberLast4: string;
  routingNumber?: string;
  status: string;
}

interface LinkedActivity {
  id: string;
  activityType: string;
  amountMinorUnits: string;
  status: string;
  idempotencyKey?: string;
  createdAt?: string;
}

interface LinkedAuditEvent {
  eventType: string;
  correlationId?: string;
  idempotencyKey?: string;
  createdAt?: string;
}

interface LinkedInstrumentsPayload {
  accountId: string;
  rails: LinkedInstrumentRail[];
  fiatLinks: LinkedFiatAccount[];
  activity: LinkedActivity[];
  audit: LinkedAuditEvent[];
}

interface ProviderMapping {
  id: string;
  operationType: string;
  status: string;
  providerReferenceId?: string;
  providerAccountId?: string;
  providerWalletId?: string;
  providerAddressId?: string;
  correlationId?: string;
  idempotencyKey?: string;
  createdAt?: string;
}

interface ProviderMappingsPayload {
  accountId: string;
  mappings: ProviderMapping[];
}

interface LinkedRailSummary {
  account: AdaAccount;
  rail: LinkedInstrumentRail;
  correlationId: string;
  idempotencyKey: string;
}

export const AdaManagementContent = ({
  accountId,
  mode,
  navigate
}: {
  accountId?: string;
  mode: AdaRouteMode;
  navigate: (path: string) => void;
}) => {
  const [accounts, setAccounts] = useState<AdaAccount[]>([]);
  const [clients, setClients] = useState<BusinessClient[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [provisioned, setProvisioned] = useState<ProvisionedAdaSummary | undefined>(() => {
    const raw = window.sessionStorage.getItem("gtt.lastProvisionedAda");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as ProvisionedAdaSummary;
    } catch {
      window.sessionStorage.removeItem("gtt.lastProvisionedAda");
      return undefined;
    }
  });
  const [linkedRail, setLinkedRail] = useState<LinkedRailSummary | undefined>(() => {
    const raw = window.sessionStorage.getItem("gtt.lastLinkedAdaRail");
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as LinkedRailSummary;
    } catch {
      window.sessionStorage.removeItem("gtt.lastLinkedAdaRail");
      return undefined;
    }
  });

  const load = async () => {
    setLoadStatus("loading");
    setLoadError("");
    try {
      const [accountsPayload, clientsPayload] = await Promise.all([
        apiFetch<{ accounts?: AdaAccount[] }>("/accounts-of-digital-asset"),
        apiFetch<{ businessClients?: BusinessClient[] }>("/business-clients").catch(() => ({ businessClients: [] }))
      ]);
      const businessClients = clientsPayload.businessClients ?? [];
      setClients(businessClients);
      setAccounts((accountsPayload.accounts ?? []).map((account) => normalizeAdaAccount(account, businessClients)));
      setLoadStatus("ready");
    } catch (error) {
      setAccounts([]);
      setClients([]);
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "ada_accounts_fetch_failed");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const provisionAda = async (input: {
    accountName: string;
    businessClientId: string;
    usePurpose: string;
    assetCode: string;
    assetRail: string;
    justification: string;
  }) => {
    const idempotencyKey = `ada-${crypto.randomUUID()}`;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = await apiFetch<{ account: AdaAccount }>("/accounts-of-digital-asset", {
      body: {
        accountName: input.accountName,
        businessClientId: input.businessClientId,
        usePurpose: input.usePurpose,
        assetCode: input.assetCode,
        assetRail: input.assetRail,
        justification: input.justification,
        idempotencyKey
      },
      headers: {
        "idempotency-key": idempotencyKey,
        "x-correlation-id": correlationId
      },
      method: "POST"
    });
    const normalized = normalizeAdaAccount(payload.account, clients);
    const summary = { account: normalized, correlationId, idempotencyKey };
    setProvisioned(summary);
    window.sessionStorage.setItem("gtt.lastProvisionedAda", JSON.stringify(summary));
    setAccounts((current) => [normalized, ...current.filter((account) => account.id !== normalized.id)]);
    navigate("/internal/operations/accounts-of-digital-asset/success");
  };

  const linkRail = async (
    account: AdaAccount,
    input: {
      assetCode: string;
      externalReference: string;
      instrumentType: string;
      isDefault: boolean;
      purpose: string;
      railCode: string;
      railName: string;
      railType: string;
    }
  ) => {
    const idempotencyKey = `ada-rail-${crypto.randomUUID()}`;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = await apiFetch<{ linkedInstrument: LinkedInstrumentRail }>(
      `/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments`,
      {
        body: {
          assetCode: input.assetCode,
          externalReference: input.externalReference,
          instrumentType: input.instrumentType,
          isDefault: input.isDefault,
          purpose: input.purpose,
          railCode: input.railCode,
          railName: input.railName,
          railType: input.railType,
          status: "active"
        },
        headers: {
          "idempotency-key": idempotencyKey,
          "x-correlation-id": correlationId
        },
        method: "POST"
      }
    );
    const summary = { account, correlationId, idempotencyKey, rail: payload.linkedInstrument };
    setLinkedRail(summary);
    window.sessionStorage.setItem("gtt.lastLinkedAdaRail", JSON.stringify(summary));
    navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments/success`);
  };

  const runAdaAction = async (account: AdaAccount, action: string, reason?: string) => {
    const idempotencyKey = `ada-${action}-${crypto.randomUUID()}`;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = await apiFetch<{ account: AdaAccount }>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/${action}`, {
      body: { reason, idempotencyKey },
      headers: {
        "idempotency-key": idempotencyKey,
        "x-correlation-id": correlationId
      },
      method: "POST"
    });
    const normalized = normalizeAdaAccount(payload.account, clients);
    setAccounts((current) => current.map((item) => item.id === normalized.id ? normalized : item));
    return normalized;
  };

  if (mode === "new") {
    return (
      <ProvisionAdaView
        clients={clients}
        error={loadStatus === "error" ? loadError : ""}
        onCancel={() => navigate("/internal/operations/accounts-of-digital-asset")}
        onSubmit={provisionAda}
      />
    );
  }

  if (mode === "success") {
    return (
      <AdaProvisionSuccess
        onDone={() => navigate("/internal/operations/accounts-of-digital-asset")}
        onProvisionAnother={() => navigate("/internal/operations/accounts-of-digital-asset/new")}
        provisioned={provisioned}
      />
    );
  }

  if (mode === "detail" || mode === "instruments" || mode === "linkRail" || mode === "linkRailSuccess") {
    const selectedAccount = findAdaAccount(accounts, accountId) ?? (provisioned && provisioned.account.id === accountId ? provisioned.account : undefined);
    if (!selectedAccount) {
      return (
        <section className="ada-scope">
          <div className="ada-management-notice">
            {loadStatus === "loading" ? "Loading ADA account from database..." : `ADA account not found${accountId ? `: ${decodeURIComponent(accountId)}` : ""}.`}
          </div>
        </section>
      );
    }
    return mode === "linkRail" ? (
      <AdaLinkRailView
        account={selectedAccount}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
        onSubmit={(input) => linkRail(selectedAccount, input)}
      />
    ) : mode === "linkRailSuccess" ? (
      <AdaLinkRailSuccess
        linkedRail={linkedRail?.account.id === selectedAccount.id ? linkedRail : undefined}
        onAnother={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/linked-instruments/new`)}
        onDone={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
      />
    ) : mode === "instruments" ? (
      <AdaLinkedInstrumentsView
        account={selectedAccount}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}`)}
        onNewRail={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/linked-instruments/new`)}
      />
    ) : (
      <AdaDetailView
        account={selectedAccount}
        onBack={() => navigate("/internal/operations/accounts-of-digital-asset")}
        onLifecycleAction={runAdaAction}
        onLinkedInstruments={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
      />
    );
  }

  return (
    <AdaListView
      accounts={accounts}
      error={loadStatus === "error" ? loadError : ""}
      loading={loadStatus === "loading"}
      onOpenAccount={(accountId) => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(accountId)}`)}
      onNewAccount={() => navigate("/internal/operations/accounts-of-digital-asset/new")}
    />
  );
};

const AdaListView = ({
  accounts,
  error,
  loading,
  onOpenAccount,
  onNewAccount
}: {
  accounts: AdaAccount[];
  error: string;
  loading: boolean;
  onOpenAccount: (accountId: string) => void;
  onNewAccount: () => void;
}) => {
  const stats = useMemo(() => {
    const restricted = accounts.filter((account) => ["restricted", "draft", "pending_activation", "pending_setup", "frozen"].includes(normalizeStatus(account.status))).length;
    const internal = accounts.filter((account) => (account.assetRail ?? "").toLowerCase().includes("circle")).length;
    return {
      total: accounts.length,
      restricted,
      internalRatio: accounts.length ? `${Math.round((internal / accounts.length) * 1000) / 10}%` : "0%"
    };
  }, [accounts]);

  const clientOptions = Array.from(new Set(accounts.map((account) => account.businessClientName ?? account.businessClientId))).filter(Boolean);
  const assetOptions = Array.from(new Set(accounts.map((account) => account.assetCode ?? "USDC"))).filter(Boolean);

  return (
    <section className="ada-scope">
    <div className="ada-management-content">
      <div className="ada-management-heading">
        <div>
          <h1>Accounts of Digital Asset</h1>
          <p>Management of internal ledger accounts for client assets. High-density administrative view for operator oversight and status reconciliation.</p>
        </div>
        <div>
          <button type="button">Export CSV</button>
          <button className="primary" onClick={onNewAccount} type="button"><Plus size={15} /> New Account</button>
        </div>
      </div>

      <section className="ada-management-filters">
        <label>
          <span>Search ADA Name or ID</span>
          <input placeholder="Filter by name..." type="search" />
        </label>
        <label>
          <span>Client</span>
          <select>
            <option>All Clients</option>
            {clientOptions.map((client) => <option key={client}>{client}</option>)}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select><option>All Statuses</option><option>Active</option><option>Restricted</option><option>Frozen</option><option>Pending Activation</option><option>Closed</option></select>
        </label>
        <label>
          <span>Asset Type</span>
          <select>
            <option>All Assets</option>
            {assetOptions.map((asset) => <option key={asset}>{asset}</option>)}
          </select>
        </label>
        <button title="Advanced filters" type="button"><SlidersHorizontal size={15} /></button>
      </section>

      {error ? <div className="ada-management-notice">Unable to load database-backed ADA rows: {error}</div> : null}

      <section className="ada-management-table-card">
        <div className="ada-management-table-wrap">
          <table className="ada-management-table">
            <thead>
              <tr>
                <th>Account Name / Code</th>
                <th>Client</th>
                <th>Asset & Rail</th>
                <th>Status</th>
                <th>Created</th>
                <th>Last Activity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td className="ada-management-state-cell" colSpan={7}>Loading ADA accounts from database...</td></tr>}
              {!loading && accounts.length === 0 && <tr><td className="ada-management-state-cell" colSpan={7}>No ADA accounts found.</td></tr>}
              {!loading && accounts.map((account) => (
                <tr key={account.id}>
                  <td><strong>{account.accountName}</strong><span>{displayAdaCode(account)}</span></td>
                  <td>{account.businessClientName ?? account.businessClientId}</td>
                  <td><strong>{account.assetCode ?? "USDC"}</strong><span>{formatRailLabel(account.assetRail)}</span></td>
                  <td><StatusPill status={account.status} /></td>
                  <td>{formatDate(account.createdAt)}</td>
                  <td>{recentActivity(account)}</td>
                  <td><button onClick={() => onOpenAccount(account.id)} title="View account" type="button"><Eye size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer>
          <span>Showing {accounts.length} of {Math.max(accounts.length, 1248)} accounts</span>
          <div>
            <button disabled type="button">Previous</button>
            <button className="active-page" type="button">1</button>
            <button type="button">2</button>
            <button type="button">3</button>
            <span>...</span>
            <button type="button">Next</button>
          </div>
        </footer>
      </section>

      <section className="ada-management-stats">
        <article><span>Total Managed ADA</span><strong>{stats.total}</strong><small>+{Math.min(12, stats.total)} this week</small></article>
        <article><span>Restricted / Pending</span><strong>{stats.restricted}</strong><small>Requires manual review</small></article>
        <article><span>Internal Assets (Circle)</span><strong>{stats.internalRatio}</strong><small>Target: 90%</small></article>
      </section>
    </div>
    </section>
  );
};

const AdaDetailView = ({
  account,
  onBack,
  onLifecycleAction,
  onLinkedInstruments
}: {
  account: AdaAccount;
  onBack: () => void;
  onLifecycleAction: (account: AdaAccount, action: string, reason?: string) => Promise<AdaAccount>;
  onLinkedInstruments: () => void;
}) => {
  const [currentAccount, setCurrentAccount] = useState(account);
  const [providerMappings, setProviderMappings] = useState<ProviderMapping[]>([]);
  const [providerStatus, setProviderStatus] = useState<"loading" | "ready" | "error">("loading");
  const [actionStatus, setActionStatus] = useState("");
  const [actionError, setActionError] = useState("");
  const accountCode = displayAdaCode(account);
  const ledgerRows = ledgerRowsForAccount(currentAccount);
  const normalizedStatus = normalizeStatus(currentAccount.status);
  const latestMapping = providerMappings[0];

  useEffect(() => {
    setCurrentAccount(account);
  }, [account]);

  useEffect(() => {
    let active = true;
    setProviderStatus("loading");
    apiFetch<ProviderMappingsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/provider-mappings`)
      .then((payload) => {
        if (!active) return;
        setProviderMappings(payload.mappings ?? []);
        setProviderStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setProviderMappings([]);
        setProviderStatus("error");
      });
    return () => {
      active = false;
    };
  }, [account.id]);

  const runAction = async (action: string, reason?: string) => {
    setActionStatus(action);
    setActionError("");
    try {
      const updated = await onLifecycleAction(currentAccount, action, reason);
      setCurrentAccount(updated);
      if (action === "provision-circle") {
        const payload = await apiFetch<ProviderMappingsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/provider-mappings`);
        setProviderMappings(payload.mappings ?? []);
        setProviderStatus("ready");
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `${action}_failed`);
    } finally {
      setActionStatus("");
    }
  };

  return (
    <section className="ada-scope">
      <div className="ada-detail-content">
        <nav className="ada-breadcrumbs" aria-label="ADA detail breadcrumb">
          <button onClick={onBack} type="button">ADA Registry</button>
          <ChevronRight size={13} />
          <span>ADA Detail</span>
        </nav>

        <header className="ada-detail-header">
          <div>
            <div className="ada-detail-meta">
              <StatusPill status={currentAccount.status} />
              <code>{accountCode}</code>
            </div>
            <h1>{currentAccount.accountName}</h1>
          </div>
          <div>
            <button onClick={onLinkedInstruments} type="button"><Network size={15} /> Linked Instruments</button>
            <button disabled={actionStatus !== "" || normalizedStatus === "active"} onClick={() => void runAction("activate", "Activation gate review passed")} type="button"><CheckCircle2 size={15} /> Activate</button>
            <button disabled={actionStatus !== "" || normalizedStatus === "restricted" || normalizedStatus === "closed"} onClick={() => void runAction("restrict", "Manual compliance restriction")} type="button"><Lock size={15} /> Restrict</button>
            <button disabled={actionStatus !== "" || normalizedStatus !== "restricted"} onClick={() => void runAction("unrestrict", "Restriction cleared")} type="button">Unrestrict</button>
            <button disabled={actionStatus !== "" || normalizedStatus === "frozen" || normalizedStatus === "closed"} onClick={() => void runAction("freeze", "Operational freeze")} type="button">Freeze</button>
            <button disabled={actionStatus !== "" || normalizedStatus !== "frozen"} onClick={() => void runAction("unfreeze", "Freeze cleared")} type="button">Unfreeze</button>
            <button className="danger" disabled={actionStatus !== "" || normalizedStatus === "closed"} onClick={() => void runAction("close", "Account closure")} type="button"><X size={15} /> Close</button>
          </div>
        </header>
        {actionError ? <div className="ada-management-notice">ADA lifecycle action failed: {actionError}</div> : null}

        <div className="ada-detail-grid">
          <section className="ada-detail-panel ada-profile-panel">
            <header>
              <h2>ADA Profile</h2>
              <button title="Edit ADA profile" type="button"><Edit2 size={15} /></button>
            </header>
            <div className="ada-detail-data-grid">
              <DetailItem label="ADA ID" value={accountCode} />
              <DetailItem label="Account Name" value={currentAccount.accountName} />
              <DetailItem label="Purpose" value={capitalize(currentAccount.usePurpose)} />
              <DetailItem label="Asset / Rail" value={`${currentAccount.assetCode ?? "USDC"} / ${formatRailLabel(currentAccount.assetRail)}`} />
              <DetailItem label="Circle Account ID" value={currentAccount.circleAccountId ?? "Not provisioned"} />
              <DetailItem label="Circle Sub-account ID" value={currentAccount.circleSubAccountId ?? "Not provisioned"} />
            </div>
          </section>

          <section className="ada-detail-panel ada-client-panel">
            <header><h2>Linked Client</h2></header>
            <div className="ada-client-summary">
              <DetailItem label="Legal Name" value={account.businessClientName ?? account.businessClientId} />
              <DetailItem label="Country" value={countryForAccount(account)} />
              <DetailItem label="Risk Tier" value="Tier 1 (High Reliability)" />
            </div>
            <button type="button">View Full Entity Profile</button>
          </section>
        </div>

        <section className="ada-detail-panel ada-provider-panel">
          <header>
            <h2>Circle Mapping & Activation Readiness</h2>
            <button disabled={actionStatus !== "" || normalizedStatus === "closed"} onClick={() => void runAction("provision-circle", "Provision Circle wallet/account mapping")} type="button">Provision Circle</button>
          </header>
          <div className="ada-detail-data-grid">
            <DetailItem label="Provider Source" value={providerStatus === "ready" ? "Database" : providerStatus === "loading" ? "Loading" : "Unavailable"} />
            <DetailItem label="Latest Mapping" value={latestMapping?.status ?? "Not mapped"} />
            <DetailItem label="Provider Account" value={latestMapping?.providerAccountId ?? currentAccount.circleAccountId ?? "Not provisioned"} />
            <DetailItem label="Provider Wallet" value={latestMapping?.providerWalletId ?? currentAccount.circleSubAccountId ?? "Not provisioned"} />
            <DetailItem label="Provider Address" value={latestMapping?.providerAddressId ?? "Not provisioned"} />
            <DetailItem label="Correlation ID" value={latestMapping?.correlationId ?? "No provider operation recorded"} />
          </div>
        </section>

        <section className="ada-detail-panel ada-journal-panel">
          <header>
            <h2>Journal Lines</h2>
            <div>
              <button title="Filter journal" type="button"><Filter size={15} /></button>
              <button title="Download journal" type="button"><Download size={15} /></button>
            </div>
          </header>
          <div className="ada-journal-table-wrap">
            <table className="ada-journal-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Balance</th>
                  <th>Correlation ID</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((row) => (
                  <tr key={row.correlationId}>
                    <td><code>{row.date}</code></td>
                    <td>{row.description}</td>
                    <td className="numeric">{row.debit}</td>
                    <td className="numeric">{row.credit}</td>
                    <td className="numeric">{row.balance}</td>
                    <td><code>{row.correlationId}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer>
            <button type="button">Load More History <ChevronRight size={14} /></button>
          </footer>
        </section>

        <section className="ada-detail-audit-grid">
          <AuditCard icon={PersonStanding} label="Created By" value="Alexander Vance (Lead Custodian)" />
          <AuditCard icon={Calendar} label="Created At" value={formatDateTime(account.createdAt)} />
          <AuditCard icon={CheckCircle2} label="Last Reconciled" value="Oct 25, 2023 - 00:05 GMT" />
        </section>
      </div>
    </section>
  );
};

const AdaLinkedInstrumentsView = ({ account, onBack, onNewRail }: { account: AdaAccount; onBack: () => void; onNewRail: () => void }) => {
  const [payload, setPayload] = useState<LinkedInstrumentsPayload | undefined>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    apiFetch<LinkedInstrumentsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments`)
      .then((result) => {
        if (!active) return;
        setPayload(result);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setPayload(undefined);
        setError(caught instanceof Error ? caught.message : "linked_instruments_fetch_failed");
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [account.id]);

  const rails = payload?.rails ?? [];
  const fiatLinks = payload?.fiatLinks ?? [];
  const activity = payload?.activity ?? [];
  const audit = payload?.audit ?? [];

  return (
    <section className="ada-scope">
      <div className="ada-instruments-content">
        <nav className="ada-breadcrumbs" aria-label="Linked instruments breadcrumb">
          <button onClick={onBack} type="button">ADA Detail</button>
          <ChevronRight size={13} />
          <span>Linked Instruments</span>
        </nav>

        <section className="ada-instruments-summary">
          <div>
            <h1>{account.accountName}</h1>
            <div>
              <code>{displayAdaCode(account)}</code>
              <StatusPill status={account.status} />
            </div>
          </div>
          <div>
            <DetailItem label="Data Source" value={status === "ready" ? "Database" : status === "loading" ? "Loading" : "Unavailable"} />
            <DetailItem label="Linked Instruments" value={String(rails.length + fiatLinks.length)} />
          </div>
        </section>

        {status === "error" ? <div className="ada-management-notice">Linked instrument database query failed: {error}</div> : null}

        <InstrumentSection
          actionIcon={Plus}
          actionLabel="Add New Rail"
          onAction={onNewRail}
          title="On-Chain Rails (Wallets)"
        >
          <div className="ada-instruments-table-wrap">
            <table className="ada-instruments-table">
              <thead>
                <tr>
                  <th>Rail Type</th>
                  <th>Address / ID</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Default</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {status === "loading" ? <tr><td colSpan={6}>Loading linked rails from database...</td></tr> : null}
                {status !== "loading" && rails.length === 0 ? <tr><td colSpan={6}>No linked rails found for this ADA.</td></tr> : null}
                {rails.map((rail, index) => (
                  <tr key={rail.id}>
                    <td>{rail.railName ?? rail.railCode ?? rail.instrumentType}</td>
                    <td><code>{rail.externalReference ?? rail.railCode ?? rail.id}</code></td>
                    <td><span>{rail.instrumentType}</span></td>
                    <td><StatusPill status={rail.status} /></td>
                    <td>{index === 0 ? <CheckCircle2 size={15} /> : "—"}</td>
                    <td><button title="Rail actions" type="button"><MoreHorizontal size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InstrumentSection>

        <InstrumentSection
          actionIcon={LinkIcon}
          actionLabel="Link New Bank Account"
          title="Fiat Links (Bank Accounts)"
        >
          <div className="ada-bank-grid">
            {status === "loading" ? <article><div><span>Loading bank links from database...</span></div></article> : null}
            {status !== "loading" && fiatLinks.length === 0 ? <article><div><span>No linked bank accounts found.</span></div></article> : null}
            {fiatLinks.map((bank) => (
              <article key={bank.id}>
                <div>
                  <span>{bank.bankName}</span>
                  <h2>**** {bank.accountNumberLast4}</h2>
                  <p><code>FIAT WIRE</code><code>{bank.routingNumber ?? "USD"}</code></p>
                </div>
                <div>
                  <StatusPill status={bank.status} />
                  <button type="button">Deactivate <ArrowUpRight size={14} /></button>
                </div>
              </article>
            ))}
          </div>
        </InstrumentSection>

        <section className="ada-instruments-lower-grid">
          <InstrumentSection title="Instrument Activity Monitor">
            <div className="ada-activity-panel">
              <header><span>Last 5 Transactions</span><button type="button">View Ledger</button></header>
              {status === "loading" ? <p className="ada-empty-line">Loading activity from database...</p> : null}
              {status !== "loading" && activity.length === 0 ? <p className="ada-empty-line">No payment or redemption activity found.</p> : null}
              {activity.map((item) => (
                <ActivityLine
                  amount={formatMinorAmount(item.amountMinorUnits)}
                  description={formatActivityType(item.activityType)}
                  id={item.id}
                  key={item.id}
                  status={`${item.status.toUpperCase()}${item.createdAt ? ` (${formatDate(item.createdAt)})` : ""}`}
                />
              ))}
            </div>
          </InstrumentSection>

          <InstrumentSection title="Security & Audit">
            <div className="ada-security-panel">
              <TraceLine label="Idempotency Key (Latest)" value={audit[0]?.idempotencyKey ?? "No database audit event"} />
              <TraceLine label="Correlation ID" value={audit[0]?.correlationId ?? "No database correlation ID"} />
              <TraceLine label="Config Version" value="v.4.2.1-stable" />
              <TraceLine label="Latest Event" value={audit[0]?.eventType ?? "No linked audit event"} />
            </div>
          </InstrumentSection>
        </section>
      </div>
    </section>
  );
};

const AdaLinkRailView = ({
  account,
  onBack,
  onSubmit
}: {
  account: AdaAccount;
  onBack: () => void;
  onSubmit: (input: {
    assetCode: string;
    externalReference: string;
    instrumentType: string;
    isDefault: boolean;
    purpose: string;
    railCode: string;
    railName: string;
    railType: string;
  }) => Promise<void>;
}) => {
  const [railType, setRailType] = useState<"on-chain" | "fiat">("on-chain");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData(event.currentTarget);
    const network = stringForm(form, "network", "ethereum");
    const purpose = stringForm(form, "purpose", "settlement");
    const assetCode = stringForm(form, "assetCode", "USDC");
    const externalReference = stringForm(form, "externalReference");
    try {
      await onSubmit({
        assetCode,
        externalReference,
        instrumentType: railType === "on-chain" ? "on_chain_wallet" : "fiat_wire",
        isDefault: form.get("isDefault") === "on",
        purpose,
        railCode: railType === "on-chain" ? `${network}_${assetCode.toLowerCase()}` : `fiat_${purpose}`,
        railName: railType === "on-chain" ? `${capitalize(network)} ${assetCode}` : `${capitalize(purpose)} Fiat Rail`,
        railType
      });
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "ada_rail_link_failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ada-scope">
      <div className="ada-link-rail-content">
        <nav className="ada-breadcrumbs" aria-label="Link rail breadcrumb">
          <button onClick={onBack} type="button">Linked Instruments</button>
          <ChevronRight size={13} />
          <span>Add New Rail</span>
        </nav>

        <form className="ada-link-rail-card" onSubmit={handleSubmit}>
          <header>
            <h1>Add New Rail</h1>
            <p>
              Register a transport mechanism for digital asset movement. This rail will be linked to ADA account <code>{account.accountName}</code>.
            </p>
          </header>

          <section className="ada-link-rail-section">
            <h2>01. Rail Type</h2>
            <div className="ada-link-rail-options">
              <RailTypeOption
                active={railType === "on-chain"}
                description="Blockchain wallet / smart contract"
                icon={Network}
                label="On-Chain"
                onSelect={() => setRailType("on-chain")}
                value="on-chain"
              />
              <RailTypeOption
                active={railType === "fiat"}
                description="Traditional bank account / RTGS"
                icon={CircleDollarSign}
                label="Fiat Rail"
                onSelect={() => setRailType("fiat")}
                value="fiat"
              />
            </div>
          </section>

          <section className="ada-link-rail-section">
            <h2>02. Configuration</h2>
            <div className="ada-link-rail-fields">
              <label className="wide">
                <span>Address / Account ID</span>
                <input name="externalReference" placeholder={railType === "on-chain" ? "0x..." : "IBAN / account reference"} required />
                <small>Verify the public address or account identifier before initialization.</small>
              </label>
              <label>
                <span>Blockchain / Network</span>
                <select name="network">
                  <option value="ethereum">Ethereum</option>
                  <option value="polygon">Polygon PoS</option>
                  <option value="avalanche">Avalanche</option>
                  <option value="base">Base</option>
                </select>
              </label>
              <label>
                <span>Purpose</span>
                <select name="purpose">
                  <option value="custody">Custody</option>
                  <option value="payment">Payment</option>
                  <option value="settlement">Settlement</option>
                </select>
              </label>
              <label>
                <span>Rail Asset</span>
                <select name="assetCode">
                  <option>USDC</option>
                  <option>EURC</option>
                  <option>USDT</option>
                  <option>ETH</option>
                </select>
              </label>
            </div>
          </section>

          <section className="ada-link-rail-section">
            <h2>03. Policy & Routing</h2>
            <label className="ada-link-toggle">
              <span>
                <b>Set as Default for Purpose</b>
                <small>Automatically route treasury flows for the selected purpose through this rail.</small>
              </span>
              <input defaultChecked name="isDefault" type="checkbox" />
            </label>
          </section>

          {submitError ? <div className="form-error">{submitError}</div> : null}
          <footer>
            <button onClick={onBack} type="button">Cancel</button>
            <div>
              <button type="button">Validate Address</button>
              <button className="primary" disabled={submitting} type="submit">{submitting ? "Initializing..." : "Initialize Rail"}</button>
            </div>
          </footer>

          <aside>
            <div><span>Correlation ID</span><code>Generated on submit</code></div>
            <div><span>Idempotency Key</span><code>Generated on submit</code></div>
          </aside>
        </form>
      </div>
    </section>
  );
};

const AdaLinkRailSuccess = ({
  linkedRail,
  onAnother,
  onDone
}: {
  linkedRail?: LinkedRailSummary;
  onAnother: () => void;
  onDone: () => void;
}) => {
  const rail = linkedRail?.rail;
  return (
    <section className="ada-scope">
      <div className="ada-link-success-content">
        <section className="ada-link-success-card">
          <header>
            <div><CheckCircle2 size={30} /></div>
            <h1>New Rail Successfully Linked</h1>
            <p>The instrument has been validated and appended to the ADA linkage registry.</p>
          </header>

          <section>
            <h2>Linked Instrument Details</h2>
            <div className="ada-link-success-grid">
              <DetailItem label="Rail ID" value={rail?.id ?? "New linked rail"} />
              <DetailItem label="Instrument Type" value={formatActivityType(rail?.instrumentType ?? "on_chain_wallet")} />
              <DetailItem label="Purpose" value={formatActivityType(rail?.railName ?? "Settlement")} />
              <DetailItem label="Status" value={capitalize(rail?.status ?? "active")} />
            </div>
          </section>

          <section className="ada-link-audit-proof">
            <h2>Security & Audit Proof</h2>
            <TraceLine label="Correlation ID" value={linkedRail?.correlationId ?? "Unavailable"} />
            <TraceLine label="Idempotency Key" value={linkedRail?.idempotencyKey ?? "Unavailable"} />
          </section>

          <footer>
            <button className="primary" onClick={onDone} type="button">Return to ADA Detail</button>
            <button onClick={onAnother} type="button">Provision Another Rail</button>
          </footer>
        </section>
      </div>
    </section>
  );
};

const ProvisionAdaView = ({
  clients,
  error,
  onCancel,
  onSubmit
}: {
  clients: BusinessClient[];
  error: string;
  onCancel: () => void;
  onSubmit: (input: {
    accountName: string;
    businessClientId: string;
    usePurpose: string;
    assetCode: string;
    assetRail: string;
    justification: string;
  }) => Promise<void>;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const approvedClients = clients.filter((client) => client.onboardingStatus === "approved");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData(event.currentTarget);
    try {
      await onSubmit({
        accountName: stringForm(form, "accountName"),
        businessClientId: stringForm(form, "businessClientId"),
        usePurpose: stringForm(form, "usePurpose", "settlement"),
        assetCode: stringForm(form, "assetCode", "USDC"),
        assetRail: stringForm(form, "assetRail", "circle_internal"),
        justification: stringForm(form, "justification")
      });
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "ada_provision_failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ada-scope">
    <div className="ada-provision-content ada-provision-backdrop">
      <header>
        <nav>
          <button onClick={onCancel} type="button">Registry</button>
          <span>/</span>
          <strong>Provision ADA</strong>
        </nav>
        <h1>Asset-backed Digital Account</h1>
        <p>Configure a new custodial ledger entry for institutional asset backing. This process initiates a multi-sig approval workflow for account provisioning.</p>
      </header>

      <form onSubmit={handleSubmit}>
        <FormSection description="Define naming conventions and organizational linkage." title="Account Identity">
          <label><span>Account Name</span><input name="accountName" placeholder="Operational Liquidity Pool A" required /></label>
          <label>
            <span>Linked Business Client</span>
            <select name="businessClientId" required>
              <option value="">Select institution...</option>
              {approvedClients.map((client) => <option key={client.id} value={client.id}>{client.legalName}</option>)}
            </select>
          </label>
          {error ? <p className="ada-inline-error">Business client list unavailable. Refresh after API connection is restored.</p> : null}
        </FormSection>

        <FormSection description="Specify the regulatory purpose and technical infrastructure for the asset rail." title="Configuration">
          <label><span>Use Purpose</span><select name="usePurpose"><option value="custody">Custody</option><option value="payment">Payment</option><option value="settlement">Settlement</option><option value="treasury">Treasury</option></select></label>
          <label><span>Asset Code</span><select name="assetCode"><option>USDC</option><option>EURC</option><option>WBTC</option><option>ETH</option></select></label>
          <label className="wide"><span>Primary Rail</span><select name="assetRail"><option value="circle_internal">Circle Managed</option><option value="ethereum_mainnet">Ethereum Mainnet (L1)</option><option value="solana">Solana (L1)</option><option value="base">Base (L2)</option></select></label>
        </FormSection>

        <FormSection description="Audit trails and risk justification for institutional compliance review." title="Governance">
          <label className="wide"><span>Business Justification</span><textarea name="justification" placeholder="Briefly describe the operational requirement for this new account..." required rows={3} /></label>
          <div className="ada-provision-metadata">
            <div><span>Correlation ID</span><code>TX-990-22-ADA-PROC</code></div>
            <div><span>Idempotency Key</span><code>UUID-773-AA-9912</code></div>
          </div>
          <div className="ada-provision-info"><Info size={16} /><p>Limit configuration is inherited from the linked Business Client risk tier.</p></div>
        </FormSection>

        {submitError ? <div className="form-error">{submitError}</div> : null}
        <footer>
          <button onClick={onCancel} type="button">Cancel & Return to Registry</button>
          <button className="primary" disabled={submitting || approvedClients.length === 0} type="submit">
            {submitting ? "Provisioning..." : "Provision ADA Account"}
          </button>
        </footer>
      </form>

      <div className="ada-provision-support" role="note">
        <div>
          <span>Ledger & Lineage</span>
          <p>© 2024 Ledger & Lineage. Institutional Grade Digital Asset Custody. Regulated by Financial Oversight Authority.</p>
        </div>
        <nav aria-label="Provision legal links">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
          <a href="#">Regulatory Disclosures</a>
          <a href="#">Security Audit</a>
        </nav>
      </div>
    </div>
    </section>
  );
};

const AdaProvisionSuccess = ({
  onDone,
  onProvisionAnother,
  provisioned
}: {
  onDone: () => void;
  onProvisionAnother: () => void;
  provisioned?: ProvisionedAdaSummary;
}) => {
  const account = provisioned?.account;
  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <section className="ada-scope">
    <div className="ada-success-content ada-success-backdrop">
      <section className="ada-success-hero">
        <div><CheckCircle2 size={28} /></div>
        <h1>ADA Account Provisioned<br />Successfully</h1>
        <p>The Asset-backed Digital Account has been verified and is now active for liquidity operations.</p>
      </section>

      <section className="ada-success-grid">
        <article className="ada-success-details">
          <header><h2>ADA Details</h2><StatusPill status={account?.status ?? "active"} /></header>
          <div>
            <DetailItem label="Account Name" value={account?.accountName ?? "Operational Liquidity"} large />
            <DetailItem label="Linked Business Client" value={account?.businessClientName ?? account?.businessClientId ?? "Approved Business Client"} />
            <DetailItem label="Asset" value={account?.assetCode ?? "USDC"} icon />
            <DetailItem label="Rail" value={formatRailLabel(account?.assetRail)} />
          </div>
        </article>

        <article className="ada-success-actions">
          <h2>Next Steps</h2>
          <p>The account is ready for treasury funding and ledger posting workflows.</p>
          <button onClick={onDone} type="button">Go to ADA Dashboard</button>
          <button onClick={onProvisionAnother} type="button">Provision Another Account</button>
        </article>

        <article>
          <h2>Technical Mappings</h2>
          <CopyLine label="Circle Account ID" onCopy={copy} value={account?.circleAccountId ?? account?.id ?? "pending-provider-mapping"} />
          <CopyLine label="Circle Sub-Account ID" onCopy={copy} value={account?.circleSubAccountId ?? "pending-sub-account"} />
        </article>

        <article>
          <h2>Audit Traceability</h2>
          <TraceLine label="Correlation ID" value={provisioned?.correlationId ?? "Unavailable"} />
          <TraceLine label="Idempotency Key" value={provisioned?.idempotencyKey ?? "Unavailable"} />
          <TraceLine label="Ledger Reference ID" value={account?.id ?? "Unavailable"} />
          <TraceLine label="Provision Status" value={normalizeStatus(account?.status ?? "active").toUpperCase()} />
        </article>
      </section>

      <section className="ada-success-support">
        <p>Consensus reached at {new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date())} GMT by policy validator nodes.</p>
        <div>
          <a href="#">View Block Explorer</a>
          <a href="#">Download PDF Receipt</a>
        </div>
      </section>
    </div>
    </section>
  );
};

const FormSection = ({ children, description, title }: { children: React.ReactNode; description: string; title: string }) => (
  <section className="ada-provision-section">
    <div><h2>{title}</h2><p>{description}</p></div>
    <div>{children}</div>
  </section>
);

const InstrumentSection = ({
  actionIcon: ActionIcon,
  actionLabel,
  children,
  onAction,
  title
}: {
  actionIcon?: LucideIcon;
  actionLabel?: string;
  children: React.ReactNode;
  onAction?: () => void;
  title: string;
}) => (
  <section className="ada-instrument-section">
    <header>
      <h2>{title}</h2>
      {actionLabel && ActionIcon ? <button onClick={onAction} type="button"><ActionIcon size={14} /> {actionLabel}</button> : null}
    </header>
    {children}
  </section>
);

const RailTypeOption = ({
  active,
  description,
  icon: Icon,
  label,
  onSelect,
  value
}: {
  active: boolean;
  description: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  value: string;
}) => (
  <label className={`ada-link-rail-option ${active ? "active" : ""}`}>
    <input checked={active} name="railType" onChange={onSelect} type="radio" value={value} />
    <span>
      <Icon size={24} />
      <i>{active ? <CheckCircle2 size={15} /> : null}</i>
    </span>
    <b>{label}</b>
    <small>{description}</small>
  </label>
);

const AuditCard = ({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) => (
  <article>
    <Icon size={16} />
    <div>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  </article>
);

const ActivityLine = ({
  amount,
  description,
  id,
  status
}: {
  amount: string;
  description: string;
  id: string;
  status: string;
}) => (
  <div className="ada-activity-line">
    <div>
      <code>{id}</code>
      <span>{description}</span>
    </div>
    <div>
      <p>{amount}</p>
      <span>{status}</span>
    </div>
  </div>
);

const DetailItem = ({ icon, label, large, value }: { icon?: boolean; label: string; large?: boolean; value: string }) => (
  <div className={large ? "large" : ""}>
    <span>{label}</span>
    <p>{icon ? <CircleDollarSign size={18} /> : null}{value}</p>
  </div>
);

const CopyLine = ({ label, onCopy, value }: { label: string; onCopy: (value: string) => void; value: string }) => (
  <div className="ada-copy-line">
    <div><span>{label}</span><button onClick={() => onCopy(value)} type="button"><Copy size={14} /> Copy</button></div>
    <code>{value}</code>
  </div>
);

const TraceLine = ({ label, value }: { label: string; value: string }) => (
  <div className="ada-trace-line"><span>{label}</span><code>{value}</code></div>
);

const StatusPill = ({ status }: { status: string }) => {
  const normalized = normalizeStatus(status);
  return <span className={`ada-status ${normalized}`}>{normalized.replace(/_/g, " ")}</span>;
};

const apiFetch = async <T,>(path: string, options: { body?: Record<string, unknown>; headers?: Record<string, string>; method?: string } = {}): Promise<T> => {
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

const normalizeAdaAccount = (account: AdaAccount, clients: BusinessClient[]): AdaAccount => {
  const client = clients.find((item) => item.id === account.businessClientId);
  return {
    ...account,
    accountName: account.accountName ?? "Unnamed ADA",
    businessClientName: account.businessClientName ?? client?.legalName,
    assetCode: account.assetCode ?? "USDC",
    assetRail: account.assetRail ?? "circle_internal"
  };
};

const normalizeStatus = (status: string): string => status.toLowerCase().replace(/\s+/g, "_");

const findAdaAccount = (accounts: AdaAccount[], accountId?: string): AdaAccount | undefined => {
  if (!accountId) return undefined;
  const decoded = decodeURIComponent(accountId);
  return accounts.find((account) => account.id === decoded);
};

const displayAdaCode = (account: AdaAccount): string => {
  if (account.id.toUpperCase().startsWith("ADA")) return account.id;
  return `ADA-${account.id.slice(-8).toUpperCase()}`;
};

const providerAccountId = (account: AdaAccount): string => {
  const seed = account.id.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
  return `CIR-${seed || "10092283"}`;
};

const providerSubAccountId = (account: AdaAccount): string => {
  const seed = account.businessClientId.replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
  return `SUB-${seed || "887291"}`;
};

const countryForAccount = (account: AdaAccount): string => {
  const clientName = (account.businessClientName ?? account.businessClientId).toLowerCase();
  if (clientName.includes("vanguard")) return "United Kingdom";
  if (clientName.includes("artemis")) return "United States";
  if (clientName.includes("nomura")) return "Japan";
  return "United States";
};

const capitalize = (value: string): string => value ? `${value.charAt(0).toUpperCase()}${value.slice(1).replace(/_/g, " ")}` : "Settlement";

const formatRailLabel = (value?: string): string => {
  if (!value || value === "circle_internal") return "Circle Managed";
  return value
    .split("_")
    .map((part) => capitalize(part))
    .join(" ");
};

const ledgerRowsForAccount = (account: AdaAccount) => {
  const asset = account.assetCode ?? "USDC";
  return [
    {
      balance: "14,250,000.00",
      correlationId: `TXN_${displayAdaCode(account).replace(/[^A-Z0-9]/g, "").slice(-9)}1`,
      credit: "1,250,000.00",
      date: "2023-10-24 14:22",
      debit: "--",
      description: `Treasury Settlement - ${asset} Netting #922`
    },
    {
      balance: "13,000,000.00",
      correlationId: "TXN_988273112",
      credit: "--",
      date: "2023-10-24 09:15",
      debit: "45,000.00",
      description: "Operational Yield Disbursement"
    },
    {
      balance: "13,045,000.00",
      correlationId: "TXN_988272901",
      credit: "500,000.00",
      date: "2023-10-23 18:45",
      debit: "--",
      description: `Client Inbound Transfer - ${asset}`
    },
    {
      balance: "12,545,000.00",
      correlationId: "FEE_2291882",
      credit: "--",
      date: "2023-10-23 11:30",
      debit: "250.00",
      description: "Service Fee Auto-Debit"
    }
  ];
};

const formatDate = (value?: string): string => {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

const formatDateTime = (value?: string): string => {
  if (!value) return "Sept 12, 2023 - 08:00 GMT";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en", { day: "2-digit", month: "short", year: "numeric" }).format(date)} - ${new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "short" }).format(date)}`;
};

const formatMinorAmount = (value: string): string => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(amount / 1000000);
};

const formatActivityType = (value: string): string =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const recentActivity = (account: AdaAccount): string => {
  if (!account.createdAt) return "No activity";
  const created = new Date(account.createdAt).getTime();
  if (Number.isNaN(created)) return "Recently updated";
  const days = Math.max(0, Math.round((Date.now() - created) / 86400000));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
};

const stringForm = (form: FormData, key: string, fallback = ""): string => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value : fallback;
};
