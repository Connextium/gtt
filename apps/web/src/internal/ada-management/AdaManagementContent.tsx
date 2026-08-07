import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDollarSign,
  Copy,
  Download,
  Edit2,
  Eye,
  Fingerprint,
  Filter,
  History,
  Info,
  Link as LinkIcon,
  Lock,
  Landmark,
  MoreHorizontal,
  Network,
  PersonStanding,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  User,
  X
} from "lucide-react";
import type React from "react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AdaAccountControlContent } from "./AdaAccountControlContent.js";
import { AdaSettlementAnalyticsContent } from "./AdaSettlementAnalyticsContent.js";
import { AdaStatementContent } from "./AdaStatementContent.js";
import "./ada-management-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type AdaRouteMode = "list" | "new" | "success" | "detail" | "instruments" | "linkRail" | "linkRailSuccess" | "circleConfirm" | "circleSuccess" | "linkFiat" | "linkFiatSuccess" | "linkFiatDetail" | "statements" | "settlementAnalytics" | "accountControl";

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
  metadata?: Record<string, unknown>;
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
  purpose?: string;
  railCode?: string;
  railName?: string;
  assetCode?: string;
  status: string;
  networkCode?: string;
  isDefault?: boolean;
  provider?: string;
  metadata?: {
    walletId?: string;
    address?: string;
    walletAddress?: string;
    businessWireAccountId?: string;
    trackingRef?: string;
  };
}

interface LinkedFiatFormInput {
  bankName: string;
  holderName: string;
  purpose: string;
  routingNumber: string;
  accountNumber: string;
  accountType: string;
  allocation: string;
  isDefault: boolean;
  billingLine1: string;
  billingCity: string;
  billingDistrict: string;
  billingPostalCode: string;
  billingCountry: string;
  bankAddressLine1: string;
  bankAddressCity: string;
  bankAddressDistrict: string;
  bankAddressCountry: string;
}

interface LinkedFiatAccount {
  id: string;
  bankName: string;
  accountNumberLast4: string;
  routingNumber?: string;
  purpose?: string;
  canUpdatePurpose?: boolean;
  status: string;
  createdAt?: string;
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
  account?: AdaAccount;
  circleWallets: LinkedInstrumentRail[];
  rails: LinkedInstrumentRail[];
  fiatLinks: LinkedFiatAccount[];
  activity: LinkedActivity[];
  audit: LinkedAuditEvent[];
}

interface ProviderMapping {
  id: string;
  operationType: string;
  status: string;
  requestPayload?: Record<string, unknown>;
  responsePayload?: Record<string, unknown>;
  providerRequestId?: string;
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

interface LinkedFiatSummary {
  account: AdaAccount;
  linkedInstrument: LinkedInstrumentRail;
  correlationId: string;
  idempotencyKey: string;
  form: {
    bankName: string;
    holderName: string;
    purpose: string;
    routingNumber: string;
    accountNumberLast4: string;
    accountType: string;
    allocation: string;
  };
}

interface CircleProvisionSummary {
  account: AdaAccount;
  circleOperation?: ProviderMapping;
  correlationId: string;
  idempotencyKey: string;
  linkedInstrument?: LinkedInstrumentRail;
  reusedExistingMapping?: boolean;
}

interface TenantCircleActivationPayload {
  circleIntegration?: {
    environment?: string;
    status?: string;
    walletAccountType?: string;
    walletBlockchains?: string[];
    walletSetId?: string;
    walletSetName?: string;
  };
  walletSet?: {
    environment?: string;
    status?: string;
    walletAccountType?: string;
    walletBlockchains?: string[];
    walletSetId?: string;
    walletSetName?: string;
  };
}

interface BusinessClientWalletSetPayload {
  businessClient?: {
    id: string;
    legalName: string;
    country?: string;
    onboardingStatus: string;
    circleWalletSetId?: string;
  };
}

export const AdaManagementContent = ({
  accountId,
  fiatLinkId,
  mode,
  navigate
}: {
  accountId?: string;
  fiatLinkId?: string;
  mode: AdaRouteMode;
  navigate: (path: string) => void;
}) => {
  const [accounts, setAccounts] = useState<AdaAccount[]>([]);
  const [clients, setClients] = useState<BusinessClient[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [provisioned, setProvisioned] = useState<ProvisionedAdaSummary | undefined>();
  const [linkedRail, setLinkedRail] = useState<LinkedRailSummary | undefined>();
  const [circleProvisioned, setCircleProvisioned] = useState<CircleProvisionSummary | undefined>();
  const [linkedFiat, setLinkedFiat] = useState<LinkedFiatSummary | undefined>();

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
    setAccounts((current) => [normalized, ...current.filter((account) => account.id !== normalized.id)]);
    navigate("/internal/operations/accounts-of-digital-asset/success");
  };

  const linkRail = async (
    account: AdaAccount,
    input: {
      assetCode: string;
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

  const provisionCircleWallet = async (account: AdaAccount, network?: string) => {
    const idempotencyKey = `ada-provision-circle-${crypto.randomUUID()}`;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = await apiFetch<{
      account: AdaAccount;
      circleOperation?: ProviderMapping;
      linkedInstrument?: LinkedInstrumentRail;
      reusedExistingMapping?: boolean;
    }>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/provision-circle`, {
      body: {
        reason: "Provision Circle developer-controlled wallet",
        idempotencyKey,
        ...(network ? { walletBlockchains: [network] } : {})
      },
      headers: {
        "idempotency-key": idempotencyKey,
        "x-correlation-id": correlationId
      },
      method: "POST"
    });
    const normalized = normalizeAdaAccount(payload.account, clients);
    const summary = {
      account: normalized,
      circleOperation: payload.circleOperation,
      correlationId,
      idempotencyKey,
      linkedInstrument: payload.linkedInstrument,
      reusedExistingMapping: payload.reusedExistingMapping
    };
    setAccounts((current) => current.map((item) => item.id === normalized.id ? normalized : item));
    setCircleProvisioned(summary);
    navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments/circle/success`);
  };

  const linkFiatAccount = async (
    account: AdaAccount,
    input: LinkedFiatFormInput
  ) => {
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const idempotencyKey = `ada-fiat-${crypto.randomUUID()}`;
    const requestBody = {
      assetCode: account.assetCode ?? "USDC",
      instrumentType: "fiat_wire_bank_account",
      isDefault: input.isDefault,
      networkCode: input.routingNumber,
      purpose: input.purpose,
      railCode: `fiat-${input.accountType}-${input.routingNumber}`.toLowerCase(),
      railName: input.bankName,
      railType: "fiat",
      wireAccount: {
        accountNumber: input.accountNumber,
        routingNumber: input.routingNumber,
        billingDetails: {
          name: input.holderName,
          line1: input.billingLine1,
          city: input.billingCity,
          district: input.billingDistrict,
          postalCode: input.billingPostalCode,
          country: input.billingCountry
        },
        bankAddress: {
          bankName: input.bankName,
          line1: input.bankAddressLine1,
          city: input.bankAddressCity,
          district: input.bankAddressDistrict,
          country: input.bankAddressCountry
        }
      }
    };
    console.log("[Link New Bank Account: Fiat Infrastructure] Request body", requestBody);
    const payload = await apiFetch<{ linkedInstrument: LinkedInstrumentRail }>(
      `/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments`,
      {
        body: requestBody,
        headers: {
          "idempotency-key": idempotencyKey,
          "x-correlation-id": correlationId
        },
        method: "POST"
      }
    );

    setLinkedFiat({
      account,
      linkedInstrument: payload.linkedInstrument,
      correlationId,
      idempotencyKey,
      form: {
        bankName: input.bankName,
        holderName: input.holderName,
        purpose: input.purpose,
        routingNumber: input.routingNumber,
        accountNumberLast4: input.accountNumber.slice(-4),
        accountType: input.accountType,
        allocation: input.allocation
      }
    });

    navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments/fiat/success`);
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

  if (mode === "detail" || mode === "instruments" || mode === "linkRail" || mode === "linkRailSuccess" || mode === "circleConfirm" || mode === "circleSuccess" || mode === "linkFiat" || mode === "linkFiatSuccess" || mode === "linkFiatDetail" || mode === "statements" || mode === "settlementAnalytics" || mode === "accountControl") {
    const selectedAccount = findAdaAccount(accounts, accountId);
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
    ) : mode === "circleConfirm" ? (
      <AdaProvisionCircleConfirm
        account={selectedAccount}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
        onConfirm={(network) => provisionCircleWallet(selectedAccount, network)}
      />
    ) : mode === "circleSuccess" ? (
      <AdaProvisionCircleSuccess
        account={selectedAccount}
        onDone={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
        onViewAda={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}`)}
        result={circleProvisioned?.account.id === selectedAccount.id ? circleProvisioned : undefined}
      />
    ) : mode === "linkFiat" ? (
      <AdaLinkFiatAccountView
        account={selectedAccount}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
        onSubmit={(input) => linkFiatAccount(selectedAccount, input)}
      />
    ) : mode === "linkFiatSuccess" ? (
      <AdaLinkFiatAccountSuccess
        account={selectedAccount}
        onReturn={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
        onViewAda={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}`)}
        summary={linkedFiat?.account.id === selectedAccount.id ? linkedFiat : undefined}
      />
    ) : mode === "linkFiatDetail" ? (
      <AdaLinkedFiatAccountDetailView
        account={selectedAccount}
        fiatLinkId={fiatLinkId}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
      />
    ) : mode === "instruments" ? (
      <AdaLinkedInstrumentsView
        account={selectedAccount}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}`)}
        onNewRail={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/linked-instruments/new`)}
        onLinkFiat={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/linked-instruments/fiat/new`)}
        onViewFiatDetails={(linkedFiatId) => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/linked-instruments/fiat/details/${encodeURIComponent(linkedFiatId)}`)}
        onProvisionCircle={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/linked-instruments/circle/confirm`)}
      />
    ) : mode === "statements" ? (
      <AdaStatementContent
        account={selectedAccount}
        onBack={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}`)}
      />
    ) : mode === "settlementAnalytics" ? (
      <AdaSettlementAnalyticsContent
        account={selectedAccount}
        onOpenStatement={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/statements`)}
      />
    ) : mode === "accountControl" ? (
      <AdaAccountControlContent
        account={selectedAccount}
      />
    ) : (
      <AdaDetailView
        account={selectedAccount}
        onBack={() => navigate("/internal/operations/accounts-of-digital-asset")}
        onLifecycleAction={runAdaAction}
        onLinkedInstruments={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/instruments`)}
        onAccountControl={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/account-control`)}
        onSettlementAnalytics={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/settlement-analytics`)}
        onStatements={() => navigate(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selectedAccount.id)}/statements`)}
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
  onLinkedInstruments,
  onAccountControl,
  onSettlementAnalytics,
  onStatements
}: {
  account: AdaAccount;
  onBack: () => void;
  onLifecycleAction: (account: AdaAccount, action: string, reason?: string) => Promise<AdaAccount>;
  onLinkedInstruments: () => void;
  onAccountControl: () => void;
  onSettlementAnalytics: () => void;
  onStatements: () => void;
}) => {
  const [currentAccount, setCurrentAccount] = useState(account);
  const [providerMappings, setProviderMappings] = useState<ProviderMapping[]>([]);
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
    apiFetch<ProviderMappingsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/provider-mappings`)
      .then((payload) => {
        if (!active) return;
        setProviderMappings(payload.mappings ?? []);
      })
      .catch(() => {
        if (!active) return;
        setProviderMappings([]);
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
            <button onClick={onAccountControl} type="button"><ShieldCheck size={15} /> Account Control</button>
            <button onClick={onSettlementAnalytics} type="button"><Circle size={15} /> Settlement Analytics</button>
            <button onClick={onStatements} type="button"><CircleDollarSign size={15} /> ADA Statement</button>
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
              <DetailItem label="Business Client Wallet Set ID" value={latestMapping?.providerAccountId ?? "Not provisioned"} />
              <DetailItem label="Circle Wallet ID" value={latestMapping?.providerWalletId ?? "Not provisioned"} />
              <DetailItem label="Circle Wallet Address" value={latestMapping?.providerAddressId ?? "Not provisioned"} />
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

const AdaLinkedInstrumentsView = ({ account, onBack, onLinkFiat, onNewRail, onProvisionCircle, onViewFiatDetails }: { account: AdaAccount; onBack: () => void; onLinkFiat: () => void; onNewRail: () => void; onProvisionCircle: () => void; onViewFiatDetails: (linkedFiatId: string) => void }) => {
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
  const circleWallets = payload?.circleWallets ?? [];
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
            <DetailItem label="Linked Instruments" value={String(circleWallets.length + rails.length + fiatLinks.length)} />
          </div>
        </section>

        {status === "error" || error ? <div className="ada-management-notice">{error || "Linked instrument database query failed"}</div> : null}

        <InstrumentSection
          actionIcon={Circle}
          actionLabel="Provision Circle Wallet"
          onAction={onProvisionCircle}
          title="Circle Provisioned Wallets"
        >
          <div className="ada-instruments-table-wrap">
            <table className="ada-instruments-table">
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>Address / ID</th>
                  <th>Network</th>
                  <th>Status</th>
                  <th>Default</th>
                  <th>Provider</th>
                </tr>
              </thead>
              <tbody>
                {status === "loading" ? <tr><td colSpan={6}>Loading Circle wallets from database...</td></tr> : null}
                {status !== "loading" && circleWallets.length === 0 ? <tr><td colSpan={6}>No Circle wallets provisioned for this ADA.</td></tr> : null}
                {circleWallets.map((wallet) => (
                  <tr key={wallet.id}>
                    <td>{wallet.railName ?? "Circle Wallet"}</td>
                    <td><code>{wallet.id}</code></td>
                    <td>{wallet.networkCode ?? wallet.railCode ?? "Pending"}</td>
                    <td><StatusPill status={wallet.status} /></td>
                    <td>{wallet.isDefault ? <CheckCircle2 size={15} /> : "-"}</td>
                    <td>{wallet.provider ?? "circle"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InstrumentSection>

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
                    <td><code>{rail.railCode ?? rail.id}</code></td>
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
          onAction={onLinkFiat}
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
                  <div className="ada-bank-actions">
                    <button onClick={() => onViewFiatDetails(bank.id)} type="button">View Details <ArrowRight size={14} /></button>
                    <button type="button">Deactivate <ArrowUpRight size={14} /></button>
                  </div>
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

const AdaLinkedFiatAccountDetailView = ({
  account,
  fiatLinkId,
  onBack
}: {
  account: AdaAccount;
  fiatLinkId?: string;
  onBack: () => void;
}) => {
  const [payload, setPayload] = useState<LinkedInstrumentsPayload | undefined>();
  const [providerMappings, setProviderMappings] = useState<ProviderMapping[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isAccordionOpen, setIsAccordionOpen] = useState(false);
  const [purposeDraft, setPurposeDraft] = useState("");
  const [purposeSaving, setPurposeSaving] = useState(false);
  const [purposeNotice, setPurposeNotice] = useState("");

  const copyStyle = {
    addressOnFile: "Address On File",
    cityDistrictOnFile: "City, District On File",
    cityDistrictPostalOnFile: "City, District, Postal On File",
    bankOnFile: "Bank On File",
    timelineInstructionsRetrieved: "Instructions Retrieved",
    timelineRegistrationInitiated: "Registration Initiated"
  } as const;

  const loadDetails = async ({ silent }: { silent?: boolean } = {}) => {
    setError("");
    if (!silent) {
      setStatus("loading");
    }
    try {
      const [instrumentsPayload, mappingsPayload] = await Promise.all([
        apiFetch<LinkedInstrumentsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments`),
        apiFetch<ProviderMappingsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/provider-mappings`).catch(() => ({ accountId: account.id, mappings: [] }))
      ]);
      setPayload(instrumentsPayload);
      setProviderMappings(mappingsPayload.mappings ?? []);
      setStatus("ready");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "linked_fiat_detail_fetch_failed";
      if (silent && status === "ready") {
        // Keep the current detail view mounted during refresh failures.
        setError(message);
        return;
      }
      setPayload(undefined);
      setProviderMappings([]);
      setStatus("error");
      setError(message);
    }
  };

  useEffect(() => {
    void loadDetails();
  }, [account.id]);

  const refreshDetails = async () => {
    setRefreshing(true);
    try {
      await loadDetails({ silent: true });
    } finally {
      setRefreshing(false);
    }
  };

  const fiatLinks = payload?.fiatLinks ?? [];
  const selectedFiat = useMemo(() => {
    if (fiatLinks.length === 0) return undefined;
    if (fiatLinkId) return fiatLinks.find((item) => item.id === fiatLinkId) ?? fiatLinks[0];
    const updatable = fiatLinks.find((item) => item.canUpdatePurpose);
    return updatable ?? fiatLinks[0];
  }, [fiatLinkId, fiatLinks]);

  const purposeOptions = useMemo(() => linkedFiatPurposeOptionsForAccount(account), [account]);

  useEffect(() => {
    const defaultPurpose = purposeOptions[0]?.value ?? "minting";
    if (!selectedFiat) {
      setPurposeDraft(defaultPurpose);
      setPurposeNotice("");
      return;
    }
    setPurposeDraft(normalizeLinkedFiatPurpose(selectedFiat.purpose) ?? defaultPurpose);
    setPurposeNotice("");
  }, [purposeOptions, selectedFiat?.id, selectedFiat?.purpose]);

  const wireMappings = useMemo(
    () => providerMappings.filter((item) => /wire|fiat|bank/i.test(item.operationType)),
    [providerMappings]
  );
  const latestWireMapping = wireMappings[0] ?? providerMappings[0];
  const accountMetadata = toRecord(payload?.account?.metadata);
  const wireFunding = toRecord(accountMetadata?.wireFunding);
  const responsePayload = toRecord(latestWireMapping?.responsePayload);
  const wireSetup = toRecord(responsePayload?.wireSetup);
  const wireAccount = toRecord(wireSetup?.wireAccount);
  const billingDetails = toRecord(wireAccount?.billingDetails);
  const billingAddress = toRecord(billingDetails?.address);
  const bankAddress = toRecord(wireAccount?.bankAddress);
  const wireInstructions = toRecord(wireSetup?.wireInstructions) ?? toRecord(wireFunding?.wireInstructions);
  const beneficiary = toRecord(wireInstructions?.beneficiary);
  const beneficiaryAddress = toRecord(beneficiary?.address);
  const beneficiaryBank = toRecord(wireInstructions?.beneficiaryBank);
  const beneficiaryBankAddress = toRecord(beneficiaryBank?.address);

  const trackingRef =
    toStringOrUndefined(wireFunding?.trackingRef)
    ?? toStringOrUndefined(wireFunding?.wireTrackingRef)
    ?? toStringOrUndefined(wireSetup?.trackingRef)
    ?? toStringOrUndefined(wireInstructions?.trackingRef)
    ?? "Unavailable";
  const businessWireAccountId =
    toStringOrUndefined(wireFunding?.businessWireAccountId)
    ?? toStringOrUndefined(wireSetup?.businessWireAccountId)
    ?? latestWireMapping?.providerAccountId
    ?? "Unavailable";
  const providerRequestId =
    latestWireMapping?.providerRequestId
    ?? toStringOrUndefined(wireSetup?.providerRequestId)
    ?? "Unavailable";

  const billingName =
    toStringOrUndefined(billingDetails?.name)
    ?? account.businessClientName
    ?? account.businessClientId;
  const billingLine = addressLine([
    toStringOrUndefined(billingAddress?.line1),
    toStringOrUndefined(billingAddress?.line2)
  ], copyStyle.addressOnFile);
  const billingCityLine = addressLine([
    toStringOrUndefined(billingAddress?.city),
    toStringOrUndefined(billingAddress?.district),
    toStringOrUndefined(billingAddress?.postalCode)
  ], copyStyle.cityDistrictPostalOnFile);
  const billingCountry = toStringOrUndefined(billingAddress?.country) ?? "US";

  const bankName = selectedFiat?.bankName ?? toStringOrUndefined(bankAddress?.bankName) ?? copyStyle.bankOnFile;
  const bankLine = addressLine([
    toStringOrUndefined(bankAddress?.line1),
    toStringOrUndefined(bankAddress?.line2)
  ], copyStyle.addressOnFile);
  const bankCityLine = addressLine([
    toStringOrUndefined(bankAddress?.city),
    toStringOrUndefined(bankAddress?.district)
  ], copyStyle.cityDistrictOnFile);
  const bankCountry = toStringOrUndefined(bankAddress?.country) ?? "US";

  const beneficiaryName = toStringOrUndefined(beneficiary?.name) ?? "CIRCLE INTERNET";
  const beneficiaryLine = addressLine([
    toStringOrUndefined(beneficiaryAddress?.line1),
    toStringOrUndefined(beneficiaryAddress?.line2)
  ], copyStyle.addressOnFile);
  const beneficiaryCityLine = addressLine([
    toStringOrUndefined(beneficiaryAddress?.city),
    toStringOrUndefined(beneficiaryAddress?.district),
    toStringOrUndefined(beneficiaryAddress?.postalCode)
  ], copyStyle.cityDistrictPostalOnFile);
  const beneficiaryCountry = toStringOrUndefined(beneficiaryAddress?.country) ?? "SG";

  const beneficiaryBankName = toStringOrUndefined(beneficiaryBank?.name) ?? "STANDARD CHARTERED BANK";
  const beneficiaryBankLine = addressLine([
    toStringOrUndefined(beneficiaryBankAddress?.line1),
    toStringOrUndefined(beneficiaryBankAddress?.line2)
  ], copyStyle.addressOnFile);
  const beneficiaryBankCityLine = addressLine([
    toStringOrUndefined(beneficiaryBankAddress?.city),
    toStringOrUndefined(beneficiaryBankAddress?.district),
    toStringOrUndefined(beneficiaryBankAddress?.postalCode)
  ], copyStyle.cityDistrictPostalOnFile);
  const beneficiaryBankCountry = toStringOrUndefined(beneficiaryBankAddress?.country) ?? "SG";

  const beneficiaryBankRouting = toRecord(beneficiaryBank?.routingNumber);
  const swiftCode = toStringOrUndefined(beneficiaryBankRouting?.swiftCode) ?? "Unavailable";
  const routingMask = maskEndDigits(selectedFiat?.routingNumber, 4, "****0248");
  const accountMask = maskEndDigits(selectedFiat?.accountNumberLast4, 4, "****7890");
  const beneficiaryAccountMask = maskEndDigits(toStringOrUndefined(beneficiaryBank?.accountNumber), 4, "****0499");

  const registerTime = latestWireMapping?.createdAt ?? selectedFiat?.createdAt;
  const instructionsUpdated = latestWireMapping?.createdAt ?? selectedFiat?.createdAt;
  const lastUpdated = payload?.audit?.[0]?.createdAt ?? instructionsUpdated;

  const registerResponsePreview = {
    status: latestWireMapping?.status ?? "pending",
    providerId: providerRequestId
  };
  const instructionsResponsePreview = {
    beneficiary: beneficiaryName,
    bank: beneficiaryBankName
  };

  const rawPreview = JSON.stringify({
    registerResponse: registerResponsePreview,
    instructionsResponse: instructionsResponsePreview
  }, null, 2);

  const copyValue = async (value: string) => {
    if (!value || value === "Unavailable") return;
    await navigator.clipboard?.writeText(value);
  };

  const updatePurpose = async () => {
    if (!selectedFiat) return;
    if (!selectedFiat.canUpdatePurpose) {
      setPurposeNotice("Purpose reset unavailable for this legacy wire account record.");
      return;
    }
    setPurposeSaving(true);
    setPurposeNotice("");
    const idempotencyKey = `ada-fiat-purpose-${crypto.randomUUID()}`;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const payload = await apiFetch<{ linkedInstrument: LinkedInstrumentRail }>(
        `/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments/${encodeURIComponent(selectedFiat.id)}`,
        {
          body: { purpose: purposeDraft },
          headers: {
            "idempotency-key": idempotencyKey,
            "x-correlation-id": correlationId
          },
          method: "PATCH"
        }
      );
      const updatedPurpose = normalizeLinkedFiatPurpose(payload.linkedInstrument.purpose) ?? purposeDraft;
      setPurposeDraft(updatedPurpose);
      setPayload((current) => {
        if (!current) return current;
        return {
          ...current,
          fiatLinks: current.fiatLinks.map((item) => item.id === selectedFiat.id ? { ...item, purpose: updatedPurpose } : item)
        };
      });
      setPurposeNotice(`Purpose updated to ${linkedFiatPurposeLabel(updatedPurpose)}.`);
      await loadDetails({ silent: true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "linked_fiat_purpose_update_failed";
      setPurposeNotice(`Unable to update purpose: ${message}`);
    } finally {
      setPurposeSaving(false);
    }
  };

  return (
    <section className="ada-scope">
      <div className="ada-wire-view-shell">
        <nav className="ada-breadcrumbs" aria-label="Linked wire account breadcrumb">
          <button onClick={onBack} type="button">Linked Instruments</button>
          <ChevronRight size={13} />
          <span>Linked Wire Account</span>
        </nav>

        <header className="ada-wire-view-header">
          <div>
            <h1>Linked Wire Account</h1>
            <div className="ada-wire-view-badges">
              <div>
                <span>ID</span>
                <code>{selectedFiat?.id ?? "Unavailable"}</code>
              </div>
              <div className="status">
                <span>STATUS</span>
                <code>{(selectedFiat?.status ?? "pending").toUpperCase()}</code>
              </div>
              <div>
                <span>TRACKING REF</span>
                <code>{trackingRef}</code>
              </div>
              <div>
                <span>PURPOSE</span>
                <code>{linkedFiatPurposeLabel(selectedFiat?.purpose ?? account.usePurpose)}</code>
              </div>
            </div>
          </div>

          <div className="ada-wire-view-header-meta">
            <div>
              <Fingerprint size={14} />
              <span>Virtual Account Enabled</span>
            </div>
            <p>
              Last Updated: <code>{formatIsoStamp(lastUpdated)}</code>
            </p>
          </div>
        </header>

        {status === "error" || error ? <div className="ada-management-notice">Unable to load linked wire account details: {error || "linked_fiat_detail_fetch_failed"}</div> : null}
        {status === "loading" ? <div className="ada-management-notice">Loading linked wire account details...</div> : null}
        {status === "ready" && !selectedFiat ? <div className="ada-management-notice">No linked wire account found for this ADA account.</div> : null}

        {status === "ready" && selectedFiat ? (
          <div className="ada-wire-view-layout">
            <div className="ada-wire-view-main">
              <section className="ada-wire-view-section">
                <h3>Wire Account Registration Profile</h3>
                <div className="ada-wire-view-profile-grid">
                  <article>
                    <h4><User size={14} /> Billing Details</h4>
                    <div>
                      <strong>{billingName}</strong>
                      <p>
                        {billingLine}<br />
                        {billingCityLine}<br />
                        {billingCountry}
                      </p>
                    </div>
                  </article>

                  <article>
                    <h4><Landmark size={14} /> Bank Details</h4>
                    <div>
                      <strong>{bankName}</strong>
                      <p>
                        {bankLine}<br />
                        {bankCityLine}<br />
                        {bankCountry}
                      </p>
                    </div>
                  </article>

                  <div className="ada-wire-view-mask-row">
                    <div>
                      <span>Account Number</span>
                      <code>{accountMask}</code>
                    </div>
                    <div>
                      <span>Routing Number</span>
                      <code>{routingMask}</code>
                    </div>
                  </div>

                  <div className="ada-wire-view-meta-row">
                    <div>
                      <span>Register Time</span>
                      <code>{formatIsoStamp(registerTime)}</code>
                    </div>
                    <div>
                      <span>Provider Req ID</span>
                      <code>{providerRequestId}</code>
                    </div>
                  </div>
                </div>
              </section>

              <section className="ada-wire-view-section">
                <h3>Wire Instructions Profile</h3>
                <div className="ada-wire-view-instructions">
                  <div>
                    <h4>Beneficiary</h4>
                    <strong>{beneficiaryName}</strong>
                    <p>
                      {beneficiaryLine}<br />
                      {beneficiaryCityLine}<br />
                      Country: {beneficiaryCountry}
                    </p>
                  </div>
                  <div>
                    <h4>Beneficiary Bank</h4>
                    <strong>{beneficiaryBankName}</strong>
                    <p>
                      {beneficiaryBankLine}<br />
                      {beneficiaryBankCityLine}<br />
                      Country: {beneficiaryBankCountry}
                    </p>
                    <div className="ada-wire-view-instructions-meta">
                      <div>
                        <span>SWIFT</span>
                        <code>{swiftCode}</code>
                      </div>
                      <div>
                        <span>CURRENCY</span>
                        <code>{account.assetCode ?? "USD"}</code>
                      </div>
                      <div>
                        <span>ROUTING</span>
                        <code>{routingMask}</code>
                      </div>
                      <div>
                        <span>ACCOUNT</span>
                        <code>{beneficiaryAccountMask}</code>
                      </div>
                    </div>
                  </div>
                </div>

                <footer>
                  <div>
                    <span>Instructions Updated</span>
                    <code>{formatIsoStamp(instructionsUpdated)}</code>
                  </div>
                  <div>
                    <span>Provider Req ID</span>
                    <code>{providerRequestId}</code>
                  </div>
                </footer>
              </section>
            </div>

            <aside className="ada-wire-view-side">
              <section className="ada-wire-side-card">
                <h3>Operations</h3>
                <div>
                  <button disabled={refreshing} onClick={() => void refreshDetails()} type="button">
                    <RefreshCw className={refreshing ? "spin" : ""} size={12} />
                    <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
                  </button>
                  <button onClick={() => void copyValue(trackingRef)} type="button"><Copy size={12} /> Copy Tracking Ref</button>
                  <button onClick={() => void copyValue(businessWireAccountId)} type="button"><Copy size={12} /> Copy Business ID</button>
                </div>
                <div className="ada-wire-purpose-reset">
                  <label htmlFor="linked-fiat-purpose-reset">Purpose</label>
                  <select
                    disabled={purposeSaving || !selectedFiat?.canUpdatePurpose}
                    id="linked-fiat-purpose-reset"
                    onChange={(event) => setPurposeDraft(event.target.value)}
                    value={purposeDraft}
                  >
                    {purposeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <button
                    disabled={purposeSaving || !selectedFiat?.canUpdatePurpose || !purposeDraft}
                    onClick={() => void updatePurpose()}
                    type="button"
                  >
                    {purposeSaving ? "Updating..." : "Reset Purpose"}
                  </button>
                  <small>
                    {selectedFiat?.canUpdatePurpose
                      ? "Updates linked-instrument routing purpose for this wire account."
                      : "Legacy wire account record: purpose reset unavailable."}
                  </small>
                  {purposeNotice ? <p className={purposeNotice.startsWith("Unable") ? "error" : "success"}>{purposeNotice}</p> : null}
                </div>
              </section>

              <section className="ada-wire-side-card">
                <h3>Timeline</h3>
                <div className="ada-wire-view-timeline">
                  <article>
                    <strong>{copyStyle.timelineInstructionsRetrieved}</strong>
                    <code>{formatIsoStamp(instructionsUpdated)}</code>
                  </article>
                  <article>
                    <strong>{copyStyle.timelineRegistrationInitiated}</strong>
                    <code>{formatIsoStamp(registerTime)}</code>
                  </article>
                </div>
              </section>

              <section className={`ada-wire-side-card ${isAccordionOpen || isDrawerOpen ? "active" : ""}`}>
                <button
                  aria-expanded={isAccordionOpen}
                  className="ada-wire-payload-toggle"
                  onClick={() => {
                    setIsAccordionOpen((open) => !open);
                    setIsDrawerOpen(true);
                  }}
                  type="button"
                >
                  <h3>Raw Payload (Role-Gated)</h3>
                  <ChevronDown className={isAccordionOpen ? "open" : ""} size={14} />
                </button>
                {isAccordionOpen ? (
                  <div className="ada-wire-inline-payload">
                    <pre>{rawPreview}</pre>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>
        ) : null}
      </div>

      {isDrawerOpen ? (
        <>
          <button aria-label="Close payload drawer overlay" className="ada-wire-payload-overlay" onClick={() => {
            setIsDrawerOpen(false);
            setIsAccordionOpen(false);
          }} type="button" />
          <aside className="ada-wire-payload-drawer">
            <header>
              <h2>Audit Evidence: Raw Payload</h2>
              <button aria-label="Close payload drawer" onClick={() => {
                setIsDrawerOpen(false);
                setIsAccordionOpen(false);
              }} type="button">
                <X size={14} />
              </button>
            </header>
            <div>
              <section>
                <h3>Register Response</h3>
                <pre>{JSON.stringify(registerResponsePreview, null, 2)}</pre>
              </section>
              <section>
                <h3>Instructions Response</h3>
                <pre>{JSON.stringify(instructionsResponsePreview, null, 2)}</pre>
              </section>
            </div>
            <footer>
              <p>Access Level: Administrator / Auditor</p>
            </footer>
          </aside>
        </>
      ) : null}
    </section>
  );
};

const AdaProvisionCircleConfirm = ({
  account,
  onBack,
  onConfirm
}: {
  account: AdaAccount;
  onBack: () => void;
  onConfirm: (network: string) => Promise<void>;
}) => {
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [activation, setActivation] = useState<TenantCircleActivationPayload | undefined>();
  const [activationStatus, setActivationStatus] = useState<"loading" | "ready" | "error">("loading");
  const [activationError, setActivationError] = useState("");
  const [businessClientWalletSetId, setBusinessClientWalletSetId] = useState<string | undefined>();
  const [existingCircleWallet, setExistingCircleWallet] = useState<LinkedInstrumentRail | undefined>();
  const [walletStatus, setWalletStatus] = useState<"loading" | "ready" | "error">("loading");
  const [walletError, setWalletError] = useState("");
  const [selectedNetwork, setSelectedNetwork] = useState("ARC-TESTNET");

  useEffect(() => {
    let active = true;
    setActivationStatus("loading");
    setActivationError("");
    setWalletStatus("loading");
    setWalletError("");
    Promise.all([
      apiFetch<TenantCircleActivationPayload>("/tenants/current/activation"),
      apiFetch<BusinessClientWalletSetPayload>(`/business-clients/${encodeURIComponent(account.businessClientId)}`).catch(() => undefined),
      apiFetch<LinkedInstrumentsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments`).catch(() => undefined)
    ])
      .then(([activationPayload, businessClientPayload, linkedPayload]) => {
        if (!active) return;
        setActivation(activationPayload);
        setBusinessClientWalletSetId(businessClientPayload?.businessClient?.circleWalletSetId);
        setActivationStatus("ready");
        const availableNetworks = activationPayload.circleIntegration?.walletBlockchains?.length
          ? activationPayload.circleIntegration.walletBlockchains
          : activationPayload.walletSet?.walletBlockchains ?? [];
        if (availableNetworks.length > 0) {
          setSelectedNetwork(availableNetworks[0]!);
        }
        const activeCircleWallet = linkedPayload?.circleWallets?.find((wallet) => normalizeStatus(wallet.status) === "active");
        setExistingCircleWallet(activeCircleWallet ?? linkedPayload?.circleWallets?.[0]);
        setWalletStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setActivation(undefined);
        setBusinessClientWalletSetId(undefined);
        setActivationStatus("error");
        setActivationError(caught instanceof Error ? caught.message : "tenant_activation_fetch_failed");
        setExistingCircleWallet(undefined);
        setWalletStatus("error");
        setWalletError(caught instanceof Error ? caught.message : "linked_instruments_fetch_failed");
      });
    return () => {
      active = false;
    };
  }, [account.id]);

  const integration = activation?.circleIntegration;
  const walletSet = activation?.walletSet;
  const walletSetId = businessClientWalletSetId;
  const walletSetName = account.businessClientName ? `${account.businessClientName} Wallet Set` : "Business Client Wallet Set";
  const walletSetEnvironment = integration?.environment ?? walletSet?.environment;
  const walletSetStatus = integration?.status ?? walletSet?.status;
  const walletBlockchains = integration?.walletBlockchains?.length
    ? integration.walletBlockchains
    : walletSet?.walletBlockchains ?? [];
  const selectableNetworks = walletBlockchains.length > 0 ? walletBlockchains : ["ARC-TESTNET", "ARC", "MATIC-AMOY", "ETH-SEPOLIA", "ARB-SEPOLIA", "BASE-SEPOLIA", "OP-SEPOLIA"];
  const walletAccountType = integration?.walletAccountType ?? walletSet?.walletAccountType ?? "SCA";
  const existingWalletId = existingCircleWallet?.metadata?.walletId ?? "Unavailable";
  const existingWalletAddress =
    existingCircleWallet?.metadata?.address
    ?? existingCircleWallet?.metadata?.walletAddress
    ?? existingCircleWallet?.metadata?.walletId
    ?? "Unavailable";

  const confirm = async () => {
    setSubmitting(true);
    setSubmitError("");
    try {
      await onConfirm(selectedNetwork);
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : "circle_wallet_provision_failed");
      setSubmitting(false);
    }
  };

  return (
    <section className="ada-scope">
      <div className="ada-link-rail-content">
        <nav className="ada-breadcrumbs" aria-label="Provision Circle wallet breadcrumb">
          <button onClick={onBack} type="button">Linked Instruments</button>
          <ChevronRight size={13} />
          <span>Provision Circle Wallet</span>
        </nav>

        <section className="ada-link-rail-card ada-circle-provision-card">
          <header>
            <h1>Provision Circle Wallet</h1>
            <p>
              Create a Circle developer-controlled wallet and register it as a linked instrument for ADA account <code>{account.accountName}</code>.
            </p>
          </header>

          <section className="ada-link-rail-section">
            <h2>01. Confirmation Scope</h2>
            <div className="ada-circle-confirm-grid">
              <DetailItem label="ADA Account" value={account.accountName} />
              <DetailItem label="ADA Code" value={displayAdaCode(account)} />
              <DetailItem label="Business Client" value={account.businessClientName ?? account.businessClientId} />
              <DetailItem label="Purpose" value={capitalize(account.usePurpose)} />
              <DetailItem label="Asset" value={account.assetCode ?? "USDC"} />
              <DetailItem label="Current Status" value={capitalize(account.status)} />
            </div>
          </section>

          <section className="ada-link-rail-section">
            <h2>02. Circle Wallet Behavior</h2>
            <div className="ada-circle-confirm-list">
              <div><Circle size={17} /><span>A developer-controlled Circle wallet will be created using this business client's wallet set.</span></div>
              <div><LinkIcon size={17} /><span>The created wallet is persisted as a <code>circle_wallet</code> linked instrument.</span></div>
              <div><CheckCircle2 size={17} /><span>Legacy tenant-level wallet mappings are ignored. Provisioning confirms business-client wallet set and wallet address.</span></div>
            </div>
          </section>

          <section className="ada-link-rail-section">
            <h2>03. Business Client Wallet Set</h2>
            {activationStatus === "error" ? <div className="ada-management-notice">Unable to load wallet set context: {activationError}</div> : null}
            <div className="ada-circle-confirm-grid">
              <DetailItem label="Wallet Set Name" value={activationStatus === "loading" ? "Loading..." : walletSetName ?? "Not configured"} />
              <DetailItem label="Wallet Set ID" value={activationStatus === "loading" ? "Loading..." : walletSetId ?? "Will be created on provision"} />
              <DetailItem label="Environment" value={activationStatus === "loading" ? "Loading..." : walletSetEnvironment ?? "Unavailable"} />
              <DetailItem label="Network Scope" value={activationStatus === "loading" ? "Loading..." : walletBlockchains.join(", ") || "Not configured"} />
              <DetailItem label="Wallet Type" value={activationStatus === "loading" ? "Loading..." : walletAccountType} />
              <DetailItem label="Activation Status" value={activationStatus === "loading" ? "Loading..." : capitalize(walletSetStatus ?? "draft")} />
              <DetailItem label="Provider" value="Circle" />
            </div>
            <div className="ada-circle-network-picker">
              <label>
                <span>Provision Network</span>
                <select onChange={(event) => setSelectedNetwork(event.target.value)} value={selectedNetwork}>
                  {selectableNetworks.map((network) => <option key={network} value={network}>{network}</option>)}
                </select>
              </label>
            </div>
          </section>

          <section className="ada-link-rail-section">
            <h2>04. Existing Circle Wallet (If Already Provisioned)</h2>
            {walletStatus === "error" ? <div className="ada-management-notice">Unable to load linked wallet details: {walletError}</div> : null}
            {walletStatus === "loading" ? <p className="ada-empty-line">Loading linked wallet details...</p> : null}
            {walletStatus === "ready" && existingCircleWallet ? (
              <div className="ada-circle-confirm-grid">
                <DetailItem label="Wallet ID" value={existingWalletId} />
                <DetailItem label="Wallet Address" value={existingWalletAddress} />
                <DetailItem label="Network" value={existingCircleWallet.networkCode ?? "Tenant default"} />
                <DetailItem label="Instrument Status" value={capitalize(existingCircleWallet.status)} />
              </div>
            ) : null}
            {walletStatus === "ready" && !existingCircleWallet ? (
              <p className="ada-empty-line">No Circle wallet is linked yet. Confirm to provision a new wallet for this ADA account.</p>
            ) : null}
          </section>

          {submitError ? <div className="form-error">Circle wallet provisioning failed: {submitError}</div> : null}

          <footer>
            <button disabled={submitting} onClick={onBack} type="button">Cancel</button>
            <div>
              <button className="primary" disabled={submitting} onClick={() => void confirm()} type="button">
                {submitting ? "Provisioning..." : "Confirm Provision Circle Wallet"}
              </button>
            </div>
          </footer>

          <aside>
            <div><span>Correlation ID</span><code>Generated on confirmation</code></div>
            <div><span>Idempotency Key</span><code>Generated on confirmation</code></div>
          </aside>
        </section>
      </div>
    </section>
  );
};

const AdaProvisionCircleSuccess = ({
  account,
  onDone,
  onViewAda,
  result
}: {
  account: AdaAccount;
  onDone: () => void;
  onViewAda: () => void;
  result?: CircleProvisionSummary;
}) => {
  const wallet = result?.linkedInstrument;
  const operation = result?.circleOperation;
  const copy = (text: string) => void navigator.clipboard?.writeText(text);

  return (
    <section className="ada-scope">
      <div className="ada-link-success-content">
        <section className="ada-link-success-card ada-circle-result-card">
          <header>
            <div><CheckCircle2 size={30} /></div>
            <h1>{result?.reusedExistingMapping ? "Circle Wallet Already Linked" : "Circle Wallet Provisioned"}</h1>
            <p>
              The Circle developer-controlled wallet is available as a linked instrument for <code>{account.accountName}</code>.
            </p>
          </header>

          <section>
            <h2>Circle Provisioned Wallet</h2>
            <div className="ada-link-success-grid">
              <DetailItem label="Linked Instrument ID" value={wallet?.id ?? "Unavailable"} />
              <DetailItem label="Instrument Type" value={formatActivityType(wallet?.instrumentType ?? "circle_wallet")} />
              <DetailItem label="Business Client Wallet Set ID" value={operation?.providerAccountId ?? "Unavailable"} />
              <DetailItem label="Wallet ID" value={wallet?.metadata?.walletId ?? operation?.providerWalletId ?? "Unavailable"} />
              <DetailItem
                label="Wallet Address"
                value={
                  wallet?.metadata?.address
                  ?? wallet?.metadata?.walletAddress
                  ?? wallet?.metadata?.walletId
                  ?? operation?.providerAddressId
                  ?? "Unavailable"
                }
              />
              <DetailItem label="Network" value={wallet?.networkCode ?? "Tenant default"} />
              <DetailItem label="Status" value={capitalize(wallet?.status ?? operation?.status ?? "active")} />
            </div>
          </section>

          <section className="ada-link-audit-proof">
            <h2>Security & Audit Proof</h2>
            <TraceLine label="Correlation ID" value={result?.correlationId ?? operation?.correlationId ?? "Unavailable"} />
            <TraceLine label="Idempotency Key" value={result?.idempotencyKey ?? operation?.idempotencyKey ?? "Unavailable"} />
            <TraceLine label="Circle Operation ID" value={operation?.id ?? "Unavailable"} />
            <TraceLine label="Provider Request ID" value={operation?.providerRequestId ?? "Unavailable"} />
          </section>

          <section className="ada-circle-copy-grid">
            <CopyLine label="Wallet ID" onCopy={copy} value={wallet?.metadata?.walletId ?? operation?.providerWalletId ?? "Unavailable"} />
            <CopyLine
              label="Wallet Address"
              onCopy={copy}
              value={
                wallet?.metadata?.address
                ?? wallet?.metadata?.walletAddress
                ?? wallet?.metadata?.walletId
                ?? operation?.providerAddressId
                ?? "Unavailable"
              }
            />
          </section>

          <footer>
            <button className="primary" onClick={onDone} type="button">Return to Linked Instruments</button>
            <button onClick={onViewAda} type="button">View ADA Detail</button>
          </footer>
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
    try {
      await onSubmit({
        assetCode,
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

const AdaLinkFiatAccountView = ({
  account,
  onBack,
  onSubmit
}: {
  account: AdaAccount;
  onBack: () => void;
  onSubmit: (input: LinkedFiatFormInput) => Promise<void>;
}) => {
  const [step, setStep] = useState<"form" | "saved" | "confirm">("form");
  const [draftInput, setDraftInput] = useState<LinkedFiatFormInput | undefined>();
  const [attested, setAttested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitToast, setSubmitToast] = useState<{ message: string; providerRequestId?: string } | undefined>();
  const purposeOptions = useMemo(() => linkedFiatPurposeOptionsForAccount(account), [account]);

  const parseDraftInput = (form: FormData): LinkedFiatFormInput => ({
    bankName: stringForm(form, "bankName"),
    holderName: stringForm(form, "holderName"),
    purpose: stringForm(form, "purpose", purposeOptions[0]?.value ?? account.usePurpose),
    routingNumber: stringForm(form, "routingNumber"),
    accountNumber: stringForm(form, "accountNumber"),
    accountType: "corporate",
    allocation: "minting",
    isDefault: true,
    billingLine1: stringForm(form, "billingLine1"),
    billingCity: stringForm(form, "billingCity"),
    billingDistrict: stringForm(form, "billingDistrict"),
    billingPostalCode: stringForm(form, "billingPostalCode"),
    billingCountry: stringForm(form, "billingCountry"),
    bankAddressLine1: stringForm(form, "bankAddressLine1"),
    bankAddressCity: stringForm(form, "bankAddressCity"),
    bankAddressDistrict: stringForm(form, "bankAddressDistrict"),
    bankAddressCountry: stringForm(form, "bankAddressCountry")
  });

  const handleDraftSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setDraftInput(parseDraftInput(form));
    setStep("saved");
    setSubmitError("");
    setSubmitToast(undefined);
  };

  const handleAuthorizeProvision = async () => {
    if (!draftInput) return;
    setSubmitting(true);
    setSubmitError("");
    setSubmitToast(undefined);
    try {
      await onSubmit(draftInput);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "fiat_link_create_failed";
      const providerRequestId = caught instanceof ApiRequestError
        ? caught.providerRequestId
        : parseProviderRequestIdFromMessage(message);
      setSubmitError(message);
      setSubmitToast({
        message: "Unable to link bank account",
        providerRequestId
      });
      setSubmitting(false);
    }
  };

  const maskedAccountNumber = draftInput?.accountNumber
    ? `**** **** ${draftInput.accountNumber.slice(-4)}`
    : "Unavailable";

  const formDefaults = draftInput;

  const copyProviderRequestId = async () => {
    if (!submitToast?.providerRequestId) return;
    try {
      await navigator.clipboard.writeText(submitToast.providerRequestId);
      setSubmitToast({ ...submitToast, message: "Provider Request ID copied" });
    } catch {
      setSubmitToast({ ...submitToast, message: "Copy failed. Please copy manually." });
    }
  };

  return (
    <section className="ada-scope">
      <div className="ada-fiat2-shell">
        <nav className="ada-breadcrumbs" aria-label="Link new bank account breadcrumb">
          <button onClick={onBack} type="button">Linked Instruments</button>
          <ChevronRight size={13} />
          <span>Link New Bank Account</span>
        </nav>

        {step === "form" ? (
          <main className="ada-fiat2-layout">
            <section className="ada-fiat2-context">
              <h1>Link New Bank Account: Circle Infrastructure</h1>
              <p>
                Establish a secure fiat rail for institutional minting and redemption operations. All accounts are subject to rigorous automated KYC/AML verification upon linkage. Ensure the institutional name exactly matches your platform verification profile to avoid settlement delays.
              </p>
              <aside>
                <h2>Security Protocol Active</h2>
                <p>Information is transmitted via highly encrypted channels. Linking process may require a 1-cent micro-deposit confirmation taking 1-2 business days depending on the underlying banking network.</p>
              </aside>
            </section>

            <form className="ada-fiat2-form-card" onSubmit={handleDraftSave}>
              <header>
                <h2><Landmark size={18} /> Circle Registration Requirements</h2>
              </header>

              <div className="ada-fiat2-form-grid">
                <h3>Banking Infrastructure</h3>
                <label>
                  <span>Routing Number (ABA/SWIFT)</span>
                  <input defaultValue={formDefaults?.routingNumber ?? ""} id="routingNumber" name="routingNumber" placeholder="9-Digit ABA or SWIFT Code" required />
                </label>
                <label>
                  <span>Account Number</span>
                  <input defaultValue={formDefaults?.accountNumber ?? ""} id="accountNumber" name="accountNumber" placeholder="e.g. 00123456789" required />
                </label>
                <label>
                  <span>Purpose</span>
                  <select defaultValue={formDefaults?.purpose ?? purposeOptions[0]?.value ?? account.usePurpose} id="purpose" name="purpose" required>
                    {purposeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>

                <h3>Billing Details</h3>
                <label className="wide">
                  <span>Full Name (Billing Name)</span>
                  <input
                    defaultValue={formDefaults?.holderName ?? account.businessClientName ?? ""}
                    id="holderName"
                    name="holderName"
                    placeholder="Institutional Entity Name exactly as it appears on account"
                    required
                  />
                  <small>Must match the verified entity name: Ledger & Lineage Alpha Node</small>
                </label>
                <label className="wide">
                  <span>Address Line 1</span>
                  <input defaultValue={formDefaults?.billingLine1 ?? ""} id="billingLine1" name="billingLine1" required />
                </label>
                <label>
                  <span>City</span>
                  <input defaultValue={formDefaults?.billingCity ?? ""} id="billingCity" name="billingCity" required />
                </label>
                <label>
                  <span>District/State</span>
                  <input defaultValue={formDefaults?.billingDistrict ?? ""} id="billingDistrict" name="billingDistrict" required />
                </label>
                <label>
                  <span>Postal Code</span>
                  <input defaultValue={formDefaults?.billingPostalCode ?? ""} id="billingPostalCode" name="billingPostalCode" required />
                </label>
                <label>
                  <span>Country</span>
                  <input defaultValue={formDefaults?.billingCountry ?? "US"} id="billingCountry" name="billingCountry" readOnly required />
                </label>

                <h3>Bank Address</h3>
                <label className="wide">
                  <span>Bank Name</span>
                  <input defaultValue={formDefaults?.bankName ?? ""} id="bankName" name="bankName" placeholder="e.g. Signature Bank, Silvergate" required />
                </label>
                <label className="wide">
                  <span>Address Line 1</span>
                  <input defaultValue={formDefaults?.bankAddressLine1 ?? ""} id="bankAddressLine1" name="bankAddressLine1" required />
                </label>
                <label>
                  <span>City</span>
                  <input defaultValue={formDefaults?.bankAddressCity ?? ""} id="bankAddressCity" name="bankAddressCity" required />
                </label>
                <label>
                  <span>District/State</span>
                  <input defaultValue={formDefaults?.bankAddressDistrict ?? ""} id="bankAddressDistrict" name="bankAddressDistrict" required />
                </label>
                <label>
                  <span>Country</span>
                  <input defaultValue={formDefaults?.bankAddressCountry ?? "US"} id="bankAddressCountry" name="bankAddressCountry" readOnly required />
                </label>
              </div>

              <footer>
                <button onClick={onBack} type="button">Cancel</button>
                <button className="primary" type="submit">
                  LINK TO CIRCLE INFRASTRUCTURE <ArrowRight size={14} />
                </button>
              </footer>
            </form>
          </main>
        ) : null}

        {step === "saved" && draftInput ? (
          <main className="ada-fiat2-stage-card">
            <header>
              <div>
                <h1>Record Saved</h1>
                <p>The institutional bank details have been securely recorded. Provisioning to Circle requires explicit initiation.</p>
              </div>
              <span>PENDING VERIFICATION</span>
            </header>

            <div className="ada-fiat2-stage-grid">
              <article>
                <h2>Institution Details</h2>
                <DetailItem label="Bank Name" value={draftInput.bankName} />
                <DetailItem label="Account Name" value={draftInput.holderName} />
                <DetailItem label="Routing Number (ABA)" value={draftInput.routingNumber} />
                <DetailItem label="Account Number" value={maskedAccountNumber} />
                <DetailItem label="Purpose" value={linkedFiatPurposeLabel(draftInput.purpose)} />
                <DetailItem label="Currency" value="USD" />
              </article>

              <article>
                <h2>Billing Profile</h2>
                <DetailItem label="Entity Address" value={`${draftInput.billingLine1}, ${draftInput.billingCity}, ${draftInput.billingDistrict} ${draftInput.billingPostalCode}, ${draftInput.billingCountry}`} />
                <DetailItem label="Target ADA Endpoint" value={account.id} />
                <div>
                  <span>Compliance Framework</span>
                  <p><BadgeCheck size={14} /> KYB/AML Cleared</p>
                </div>
              </article>
            </div>

            <footer>
              <p>Initiating provisioning will lock these details and submit a formal link request to the Circle API. This action cannot be reversed without support intervention.</p>
              <div>
                <button onClick={() => setStep("form")} type="button">Edit Details</button>
                <button className="primary" onClick={() => setStep("confirm")} type="button">PROVISION TO CIRCLE <ArrowRight size={14} /></button>
              </div>
            </footer>
          </main>
        ) : null}

        {step === "confirm" && draftInput ? (
          <main className="ada-fiat2-confirm-card">
            <header>
              <span>Fiat Gateway</span>
              <h1>Confirm Bank Account Linking</h1>
              <p>
                Review the institutional account details before finalizing authorization. This action will initialize the Circle API provisioning call and create a permanent settlement path.
              </p>
            </header>

            <div className="ada-fiat2-confirm-grid">
              <DetailItem label="Bank Name" value={draftInput.bankName} />
              <DetailItem label="Account Number" value={maskedAccountNumber} />
              <DetailItem label="Routing (ABA)" value={draftInput.routingNumber} />
              <DetailItem label="Purpose" value={linkedFiatPurposeLabel(draftInput.purpose)} />
              <DetailItem label="Billing Details" value={draftInput.holderName} />
              <DetailItem label="Bank Address" value={`${draftInput.bankAddressLine1}, ${draftInput.bankAddressCity}, ${draftInput.bankAddressDistrict}, ${draftInput.bankAddressCountry}`} />
            </div>

            <label className="ada-fiat2-attestation">
              <input checked={attested} onChange={(event) => setAttested(event.target.checked)} type="checkbox" />
              <span>I confirm this bank account is owned by the business client and authorized for institutional wire operations.</span>
            </label>

            {submitError ? <div className="form-error">Unable to link bank account: {submitError}</div> : null}

            {submitToast ? (
              <aside className="ada-toast ada-toast-error" role="alert">
                <div className="ada-toast-header">
                  <strong>{submitToast.message}</strong>
                  <button aria-label="Dismiss error toast" onClick={() => setSubmitToast(undefined)} type="button">
                    <X size={14} />
                  </button>
                </div>
                {submitToast.providerRequestId ? (
                  <div className="ada-toast-request-id">
                    <span>Provider Request ID</span>
                    <div>
                      <code>{submitToast.providerRequestId}</code>
                      <button onClick={copyProviderRequestId} type="button"><Copy size={12} /> Copy</button>
                    </div>
                  </div>
                ) : null}
              </aside>
            ) : null}

            <footer>
              <button disabled={submitting} onClick={() => setStep("saved")} type="button">Cancel</button>
              <button className="primary" disabled={!attested || submitting} onClick={handleAuthorizeProvision} type="button">
                {submitting ? "Authorizing..." : "Authorize & Provision"}
              </button>
            </footer>
          </main>
        ) : null}
      </div>
    </section>
  );
};

const AdaLinkFiatAccountSuccess = ({
  account,
  onReturn,
  onViewAda,
  summary
}: {
  account: AdaAccount;
  onReturn: () => void;
  onViewAda: () => void;
  summary?: LinkedFiatSummary;
}) => {
  const linked = summary?.linkedInstrument;
  const masked = summary?.form.accountNumberLast4 ? `**** **** **** ${summary.form.accountNumberLast4}` : "Unavailable";

  return (
    <section className="ada-scope">
      <div className="ada-fiat2-success-shell">
        <section className="ada-fiat2-success-card">
          <header>
            <div><Check size={26} /></div>
            <h1>Bank Account Linked</h1>
            <p>The external settlement account has been successfully verified and mapped to the institutional treasury ledger.</p>
          </header>

          <div className="ada-fiat2-success-grid">
            <article>
              <h2>Linked Instrument</h2>
              <DetailItem label="Institution" value={summary?.form.bankName ?? "Unavailable"} />
              <DetailItem label="Account Identification" value={masked} />
              <DetailItem label="Purpose Tag" value={linkedFiatPurposeLabel(summary?.form.purpose)} />
              <DetailItem label="Status" value={capitalize(linked?.status ?? "active")} />
            </article>

            <article>
              <h2>Ledger Mapping</h2>
              <DetailItem label="Internal Sub-Account ID" value={account.id} />
              <DetailItem label="Circle Account Reference" value={linked?.metadata?.businessWireAccountId ?? "Unavailable"} />
              <DetailItem label="Routing Verification" value="Micro-deposit sequence complete" />
              <DetailItem label="Linked Instrument ID" value={linked?.id ?? "Unavailable"} />
            </article>
          </div>

          <section className="ada-fiat2-trace">
            <h2>Security & Audit Proof</h2>
            <TraceLine label="Correlation ID" value={summary?.correlationId ?? "Unavailable"} />
            <TraceLine label="Idempotency Key" value={summary?.idempotencyKey ?? "Unavailable"} />
          </section>

          <footer>
            <button onClick={onViewAda} type="button">View Audit Log</button>
            <button className="primary" onClick={onReturn} type="button">Return to Linked Instruments</button>
          </footer>
        </section>
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
              <DetailItem label="Rail ID" value={rail?.id ?? "Unavailable"} />
              <DetailItem label="Instrument Type" value={rail?.instrumentType ? formatActivityType(rail.instrumentType) : "Unavailable"} />
              <DetailItem label="Purpose" value={rail?.railName ? formatActivityType(rail.railName) : "Unavailable"} />
              <DetailItem label="Status" value={rail?.status ? capitalize(rail.status) : "Unavailable"} />
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
          <header><h2>ADA Details</h2><StatusPill status={account?.status ?? "unavailable"} /></header>
          <div>
            <DetailItem label="Account Name" value={account?.accountName ?? "Unavailable"} large />
            <DetailItem label="Linked Business Client" value={account?.businessClientName ?? account?.businessClientId ?? "Unavailable"} />
            <DetailItem label="Asset" value={account?.assetCode ?? "Unavailable"} icon />
            <DetailItem label="Rail" value={account?.assetRail ? formatRailLabel(account.assetRail) : "Unavailable"} />
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
          <CopyLine label="ADA ID" onCopy={copy} value={account?.id ?? "Unavailable"} />
          <CopyLine label="Provider Mapping" onCopy={copy} value="Available on ADA Detail" />
        </article>

        <article>
          <h2>Audit Traceability</h2>
          <TraceLine label="Correlation ID" value={provisioned?.correlationId ?? "Unavailable"} />
          <TraceLine label="Idempotency Key" value={provisioned?.idempotencyKey ?? "Unavailable"} />
          <TraceLine label="Ledger ID" value={account?.id ?? "Unavailable"} />
          <TraceLine label="Provision Status" value={account?.status ? normalizeStatus(account.status).toUpperCase() : "UNAVAILABLE"} />
        </article>
      </section>

      <section className="ada-success-support">
        <p>{account ? `Persisted ADA record created at ${formatDateTime(account.createdAt)}.` : "No persisted ADA response is loaded for this success view."}</p>
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

class ApiRequestError extends Error {
  providerRequestId?: string;
  step?: string;
}

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
  const payload = await response.json() as T & {
    detail?: string;
    error?: string;
    providerRequestId?: string;
    step?: string;
    authDebug?: Record<string, unknown>;
    circleOperation?: {
      providerRequestId?: string;
      responsePayload?: {
        providerRequestId?: string;
        authDebug?: Record<string, unknown>;
        provider?: {
          authDebug?: Record<string, unknown>;
        };
      };
    };
  };
  if (!response.ok) {
    const authDebug = payload.authDebug
      ?? payload.circleOperation?.responsePayload?.authDebug
      ?? payload.circleOperation?.responsePayload?.provider?.authDebug;
    const providerRequestId = payload.providerRequestId
      ?? payload.circleOperation?.providerRequestId
      ?? payload.circleOperation?.responsePayload?.providerRequestId
      ?? (typeof authDebug?.providerRequestId === "string" ? authDebug.providerRequestId : undefined);
    const step = payload.step;
    const debugDetail = authDebug
      ? [
          typeof authDebug.baseUrl === "string" ? `baseUrl=${authDebug.baseUrl}` : undefined,
          typeof authDebug.endpoint === "string" ? `endpoint=${authDebug.endpoint}` : undefined,
          typeof authDebug.providerRequestId === "string" ? `requestId=${authDebug.providerRequestId}` : undefined,
          typeof authDebug.apiKeyConfigured !== "undefined" ? `apiKeyConfigured=${String(authDebug.apiKeyConfigured)}` : undefined,
          typeof authDebug.entitySecretConfigured !== "undefined" ? `entitySecretConfigured=${String(authDebug.entitySecretConfigured)}` : undefined,
          typeof authDebug.apiKeyPrefix === "string" ? `apiKeyPrefix=${authDebug.apiKeyPrefix}` : undefined,
          typeof authDebug.entitySecretPrefix === "string" ? `entitySecretPrefix=${authDebug.entitySecretPrefix}` : undefined
        ].filter(Boolean).join("; ")
      : undefined;
    const message = [
      payload.error ?? `${path}:${response.status}`,
      payload.detail,
      providerRequestId ? `providerRequestId=${providerRequestId}` : undefined,
      typeof step === "string" ? `step=${step}` : undefined,
      debugDetail
    ].filter(Boolean).join(" - ");
    const error = new ApiRequestError(message);
    error.providerRequestId = providerRequestId;
    error.step = typeof step === "string" ? step : undefined;
    throw error;
  }
  return payload;
};

const parseProviderRequestIdFromMessage = (message: string): string | undefined => {
  const match = message.match(/(?:providerRequestId|requestId)=([^\s;]+)/i);
  return match?.[1];
};

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const toStringOrUndefined = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const addressLine = (parts: Array<string | undefined>, fallback: string): string => {
  const line = parts.filter(Boolean).join(", ");
  return line || fallback;
};

const maskEndDigits = (value: string | undefined, revealCount: number, fallback: string): string => {
  if (!value) return fallback;
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) return fallback;
  if (normalized.length <= revealCount) return `${"*".repeat(Math.max(0, revealCount - normalized.length))}${normalized}`;
  return `${"*".repeat(Math.max(4, normalized.length - revealCount))}${normalized.slice(-revealCount)}`;
};

const formatIsoStamp = (value?: string): string => {
  if (!value) return "Unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
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

const linkedFiatPurposeValues = ["minting", "redemption", "bidirectional"] as const;

const normalizeLinkedFiatPurpose = (value?: string): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["minting", "settlement"].includes(normalized)) return "minting";
  if (["redemption", "payment"].includes(normalized)) return "redemption";
  if (["bidirectional", "dual-purpose", "dual_purpose", "dual purpose", "operating", "custody"].includes(normalized)) {
    return "bidirectional";
  }
  return undefined;
};

const linkedFiatPurposeLabel = (value?: string): string => {
  const normalized = normalizeLinkedFiatPurpose(value);
  const labels: Record<string, string> = {
    minting: "Minting",
    redemption: "Redemption",
    bidirectional: "Bidirectional (Dual-Purpose)"
  };
  if (normalized) return labels[normalized] ?? capitalize(normalized);
  return value ? capitalize(value) : "Unavailable";
};

const linkedFiatPurposeOptionsForAccount = (account: AdaAccount): Array<{ value: string; label: string }> => {
  void account;
  return linkedFiatPurposeValues.map((value) => ({
    value,
    label: linkedFiatPurposeLabel(value)
  }));
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
