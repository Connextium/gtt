import {
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  Network,
  RefreshCw,
  Settings,
  ShieldCheck,
  Upload,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./tenant-activation-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type TenantActivationMode = "config" | "success";
type ActivationStatus = "draft" | "activating" | "active" | "failed";

interface TenantActivationPayload {
  tenant?: {
    id?: string;
    tenant_name?: string;
    tenantName?: string;
    created_at?: string;
    createdAt?: string;
  };
  circleIntegration?: CircleIntegration;
  walletSet?: {
    environment?: string;
    walletSetId?: string;
    walletSetName?: string;
    walletBlockchains?: string[];
    status?: string;
    errorCode?: string;
    providerRequestId?: string;
    responsePayload?: Record<string, unknown>;
  };
  activationAccepted?: boolean;
  error?: string;
  detail?: string;
}

interface CircleIntegration {
  id?: string;
  tenantId?: string;
  provider?: string;
  environment?: string;
  walletSetId?: string;
  walletSetName?: string;
  walletBlockchains?: string[];
  walletStrategy?: string;
  status?: ActivationStatus | string;
  activatedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: {
    errorCode?: string;
    providerRequestId?: string;
    responsePayload?: unknown;
  };
}

interface ActivationFormState {
  tenantAlias: string;
  displayName: string;
  walletSetName: string;
  walletSetId: string;
  walletBlockchains: string[];
  walletStrategy: string;
  settlementNetwork: string;
}

interface TenantActivationContentProps {
  mode: TenantActivationMode;
  navigate: (path: string) => void;
}

const walletNetworks = [
  { code: "ARC-TESTNET", label: "Circle Arc Testnet", state: "recommended" },
  { code: "MATIC-AMOY", label: "Polygon Amoy", state: "ready" },
  { code: "ETH-SEPOLIA", label: "Ethereum Sepolia", state: "ready" },
  { code: "BASE-SEPOLIA", label: "Base Sepolia", state: "ready" },
  { code: "SOL-DEVNET", label: "Solana Devnet", state: "restricted" }
];

const settlementNetworks = [
  { code: "circle_arc", label: "Circle Arc" },
  { code: "ethereum_l1", label: "Ethereum L1" },
  { code: "polygon_pos", label: "Polygon PoS" },
  { code: "base_l2", label: "Base L2" },
  { code: "solana", label: "Solana" }
];

const environmentOptions = [
  { value: "simulator", label: "Simulator" },
  { value: "circle-sandbox", label: "Sandbox" },
  { value: "circle-production", label: "Production" }
];

const defaultWalletBlockchains = ["ARC-TESTNET", "SOL-DEVNET"];

const strategyOptions = [
  { value: "omnibus_custodial_set", title: "Omnibus Custodial Set", detail: "Platform-managed shared liquidity pools." },
  { value: "distributed_client", title: "Distributed Client", detail: "One-to-one individual account mapping." },
  { value: "third_party_custodian", title: "Third Party Custodian", detail: "External custody network adapter." }
];

export const TenantActivationContent = ({ mode, navigate }: TenantActivationContentProps) => {
  const [payload, setPayload] = useState<TenantActivationPayload | undefined>();
  const [form, setForm] = useState<ActivationFormState>({
    tenantAlias: "Demo Tenant",
    displayName: "DEMO",
    walletSetName: "Demo Tenant Wallet Set",
    walletSetId: "",
    walletBlockchains: defaultWalletBlockchains,
    walletStrategy: "omnibus_custodial_set",
    settlementNetwork: "circle_arc"
  });
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [commitStatus, setCommitStatus] = useState<"idle" | "saving" | "error">("idle");
  const [commitError, setCommitError] = useState("");

  const loadActivation = async (signal?: AbortSignal) => {
    setLoadStatus("loading");
    setLoadError("");
    const current = await apiFetch<TenantActivationPayload>("/tenants/current/activation", { signal });
    setPayload(current);
    setForm(formFromPayload(current));
    setLoadStatus("ready");
  };

  useEffect(() => {
    const controller = new AbortController();
    loadActivation(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "tenant_activation_fetch_failed");
    });
    return () => controller.abort();
  }, []);

  const integration = payload?.circleIntegration;
  const tenantName = tenantDisplayName(payload);
  const circleEnvironment = integration?.environment ?? payload?.walletSet?.environment ?? "simulator";
  const selectedWalletBlockchains = form.walletBlockchains.length ? form.walletBlockchains : defaultWalletBlockchains;
  const walletBlockchainDisplay = selectedWalletBlockchains.join(", ");
  const committedWalletBlockchains = walletBlockchainsFromIntegration(integration, payload?.walletSet);
  const isActivated = integration?.status === "active";
  const networkChanged = Boolean(committedWalletBlockchains.length && !sameStringSet(committedWalletBlockchains, selectedWalletBlockchains));
  const actionLabel = isActivated
    ? networkChanged
      ? "Update Network Scope"
      : "Recommit Activation"
    : "Commit Changes";

  const selectedStrategy = useMemo(
    () => strategyOptions.find((item) => item.value === form.walletStrategy) ?? strategyOptions[0],
    [form.walletStrategy]
  );

  const commitActivation = async () => {
    setCommitStatus("saving");
    setCommitError("");
    try {
      const body = {
        walletSetName: form.walletSetName.trim() || `${form.tenantAlias.trim() || tenantName} Wallet Set`,
        walletBlockchains: selectedWalletBlockchains,
        walletStrategy: form.walletStrategy,
        ...(form.walletSetId.trim() ? { walletSetId: form.walletSetId.trim() } : {}),
        idempotencyKey: `tenant-activation-${crypto.randomUUID()}`
      };
      const next = await apiFetch<TenantActivationPayload>("/tenants/current/activate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": body.idempotencyKey
        },
        body: JSON.stringify(body)
      });
      setPayload(next);
      if (next.walletSet?.status === "failed" || next.circleIntegration?.status === "failed" || next.activationAccepted === false) {
        setCommitStatus("error");
        setCommitError(`Circle wallet set activation failed: ${activationFailureReason(next)}. Network scope was saved.`);
        return;
      }
      navigate("/internal/operations/admin/tenant-activation/success");
    } catch (error) {
      setCommitStatus("error");
      setCommitError(error instanceof Error ? error.message : "tenant_activation_commit_failed");
    } finally {
      setCommitStatus((current) => current === "saving" ? "idle" : current);
    }
  };

  if (mode === "success") {
    return (
      <TenantActivationSuccess
        error={loadStatus === "error" ? loadError : ""}
        navigate={navigate}
        payload={payload}
        reload={() => void loadActivation()}
      />
    );
  }

  return (
    <div className="tenant-activation-scope">
      <main className="tenant-activation-config">
        <div className="tenant-activation-page-frame">
          <header className="tenant-activation-page-header">
            <div>
              <span>SYSTEM // CONFIGURATION // TENANT ACTIVATION</span>
              <h1>Tenant Infrastructure & Identity</h1>
            </div>
            <button onClick={() => void loadActivation()} type="button">
              <RefreshCw size={15} />
              <span>Active Configuration</span>
            </button>
          </header>

          {loadStatus === "error" ? (
            <div className="tenant-activation-error">Unable to load tenant activation: {loadError}</div>
          ) : null}

          <section className="tenant-activation-columns">
            <div className="tenant-activation-module tenant-activation-identity">
              <ModuleHeading index="MODULE 01" title="Tenant Identity & Brand">
                Configure institutional surfacing and white-label parameters for this tenant environment.
              </ModuleHeading>

              <label>
                <span>Tenant Alias</span>
                <input
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    tenantAlias: event.target.value,
                    walletSetName: current.walletSetName === `${current.tenantAlias} Wallet Set` ? `${event.target.value} Wallet Set` : current.walletSetName
                  }))}
                  type="text"
                  value={form.tenantAlias}
                />
                <small>This name appears in platform reporting and system operations.</small>
              </label>

              <label>
                <span>Display Name (Short)</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
                  type="text"
                  value={form.displayName}
                />
              </label>

              <div className="tenant-activation-wordmark">
                <span>Institutional Wordmark</span>
                <div>
                  <div>{form.displayName || "GTT"}</div>
                  <Upload size={24} />
                  <p>Wordmark upload placeholder</p>
                </div>
                <small>Preferred format: single-color SVG, max 100kb.</small>
              </div>
            </div>

            <div className="tenant-activation-module tenant-activation-wallet">
              <ModuleHeading index="MODULE 02" title="Wallet Infrastructure Strategy">
                Define key management, settlement architecture, and Circle wallet-set integration for this tenant.
              </ModuleHeading>

              <div className="tenant-activation-strategy-grid">
                {strategyOptions.map((item) => (
                  <button
                    className={form.walletStrategy === item.value ? "active" : ""}
                    key={item.value}
                    onClick={() => setForm((current) => ({ ...current, walletStrategy: item.value }))}
                    type="button"
                  >
                    <Network size={24} />
                    <span>{item.title}</span>
                    <small>{item.detail}</small>
                  </button>
                ))}
              </div>

              <div className="tenant-activation-wallet-grid">
                <label>
                  <span>Wallet Set Name</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, walletSetName: event.target.value }))}
                    type="text"
                    value={form.walletSetName}
                  />
                </label>
                <label>
                  <span>Existing Circle Wallet Set ID <small>(optional)</small></span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, walletSetId: event.target.value }))}
                    placeholder="Paste an existing Circle wallet-set UUID"
                    type="text"
                    value={form.walletSetId}
                  />
                  <small className="tenant-activation-field-help">When supplied, activation attaches this set and skips wallet-set creation.</small>
                </label>
              </div>

              <div className="tenant-activation-control-grid">
                <div className="tenant-activation-control-card">
                  <div className="tenant-activation-field-title">
                    <span>MPC Key Sharding Strategy</span>
                    <button aria-label="MPC key sharding enabled" type="button"><span /></button>
                  </div>
                  <div className="tenant-activation-select-card">
                    <span>2-of-3 Threshold Signature</span>
                    <Settings size={16} />
                  </div>
                </div>

                <div className="tenant-activation-control-card">
                  <div className="tenant-activation-field-title">
                    <span>Environment</span>
                    <small>Configured by API runtime</small>
                  </div>
                  <div className="tenant-activation-environment-list">
                    {environmentOptions.map((environment) => (
                      <div className={circleEnvironment === environment.value ? "active" : ""} key={environment.value}>
                        <span>{environment.label}</span>
                        <small>{environment.value}</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="tenant-activation-control-card">
                  <div className="tenant-activation-field-title">
                    <span>Settlement Network</span>
                    <small>Single active settlement rail</small>
                  </div>
                  <label className="tenant-activation-select-field">
                    <select
                      onChange={(event) => setForm((current) => ({ ...current, settlementNetwork: event.target.value }))}
                      value={form.settlementNetwork}
                    >
                      {settlementNetworks.map((network) => (
                        <option key={network.code} value={network.code}>{network.label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="tenant-activation-control-card">
                  <div className="tenant-activation-field-title">
                    <span>Network Scope</span>
                    {networkChanged ? <small>Wallet creation network will change</small> : <small>Wallet creation scope</small>}
                  </div>
                  <div className="tenant-activation-network-list">
                    {walletNetworks.map((network) => (
                      <label className={form.walletBlockchains.includes(network.code) ? "active" : ""} key={network.code}>
                        <input
                          checked={form.walletBlockchains.includes(network.code)}
                          onChange={() => setForm((current) => ({
                            ...current,
                            walletBlockchains: toggleRequiredValue(current.walletBlockchains, network.code)
                          }))}
                          type="checkbox"
                        />
                        <span>{network.label}</span>
                        <small>{network.code}</small>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="tenant-activation-endpoints">
                <span>Infrastructure Endpoints</span>
                <div>
                  <EndpointRow label="Settlement Network" value={formatStatus(form.settlementNetwork)} provider="GTT Rail Policy" status="Scoped" />
                  <EndpointRow label="Environment" value={circleEnvironment} provider="API Runtime" status={formatStatus(integration?.status ?? "draft")} />
                  <EndpointRow label="Network Scope" value={walletBlockchainDisplay} provider="Circle Wallets" status={selectedStrategy?.title ?? "Configured"} />
                  <EndpointRow label="Current Activation" value={integration?.walletSetId ?? "Not provisioned"} provider="Tenant Registry" status={formatStatus(integration?.status ?? "draft")} />
                </div>
              </div>
            </div>
          </section>

          <section className="tenant-activation-info-row">
            <div>
              <h4>Configuration Lock</h4>
              <p>Tenant Circle settings are committed through an audited root-operation workflow.</p>
            </div>
            <div>
              <h4>Network Scope</h4>
              <p>Network Scope controls the network selected for wallet creation under the same tenant wallet set.</p>
            </div>
            <div className="tenant-activation-module-visual">
              <span>ACTIVE MODULES: [CIRCLE-WALLET-SET] [NET-GUARD] [AUDIT]</span>
            </div>
          </section>
        </div>
      </main>

      <div className="tenant-activation-actionbar">
        <div className="tenant-activation-actionbar-inner">
          <div>
            <span>{networkChanged ? "NETWORK CHANGE DETECTED" : isActivated ? "ACTIVE TENANT PROFILE" : "UNSAVED TENANT PROFILE"}</span>
            <h3>{networkChanged ? `Scope wallet creation to ${walletBlockchainDisplay}` : `Modified Tenant Profile: ${form.tenantAlias}`}</h3>
          </div>
          <div>
            <span>CHANGE LOG</span>
            <p>{networkChanged ? `Wallet creation networks change to ${walletBlockchainDisplay}; tenant wallet set remains the same.` : `${form.walletSetName}; strategy ${formatStatus(form.walletStrategy)}.`}</p>
          </div>
          <div>
            <span>HASH CHECK</span>
            <code>{shortHash(form.walletSetName, walletBlockchainDisplay)}</code>
          </div>
          <div className="tenant-activation-actionbar-buttons">
            <button onClick={() => setForm(formFromPayload(payload))} type="button">
              <X size={15} />
              <span>Discard</span>
            </button>
            <button disabled={commitStatus === "saving" || loadStatus === "loading"} onClick={() => void commitActivation()} type="button">
              {commitStatus === "saving" ? <RefreshCw size={15} /> : <Check size={15} />}
              <span>{commitStatus === "saving" ? "Committing" : actionLabel}</span>
            </button>
          </div>
        </div>
      </div>

      {commitStatus === "error" ? <div className="tenant-activation-floating-error">{commitError}</div> : null}
    </div>
  );
};

const TenantActivationSuccess = ({
  error,
  navigate,
  payload,
  reload
}: {
  error: string;
  navigate: (path: string) => void;
  payload?: TenantActivationPayload;
  reload: () => void;
}) => {
  const integration = payload?.circleIntegration;
  const walletSet = payload?.walletSet;
  const timestamp = integration?.activatedAt ?? integration?.updatedAt ?? new Date().toISOString();
  const walletSetId = integration?.walletSetId ?? walletSet?.walletSetId ?? "Pending provider wallet set";
  return (
    <div className="tenant-activation-scope">
      <main className="tenant-activation-success">
        <section>
          <header>
            <div>
              <span>SYSTEM NOTIFICATION // ACTIVATION COMPLETE</span>
              <h1>Tenant Activated:<br />{tenantDisplayName(payload)}</h1>
            </div>
            <div>
              <span>TIMESTAMP: {formatDateTime(timestamp)}</span>
              <span>HASH: {shortHash(walletSetId, walletBlockchainsFromIntegration(integration, walletSet).join(","))}</span>
            </div>
          </header>

          {error ? <div className="tenant-activation-error">Unable to refresh activation state: {error}</div> : null}

          <div className="tenant-activation-success-grid">
            <div className="tenant-activation-visual">
              <div>
                <div>
                  <ShieldCheck size={64} />
                </div>
                <span />
                <span />
              </div>
              <small>VISUAL_CERT_ID: {shortHash(walletSetId, "cert")}</small>
            </div>

            <div className="tenant-activation-proof">
              <div className="tenant-activation-proof-stats">
                <div>
                  <span>Settlement Network</span>
                  <p>{walletBlockchainsFromIntegration(integration, walletSet).join(", ") || "Pending"}</p>
                </div>
                <div>
                  <span>Environment</span>
                  <p>{integration?.environment ?? walletSet?.environment ?? "Unavailable"}</p>
                </div>
              </div>
              <div className="tenant-activation-wallet-set-id">
                <span>Wallet Set ID</span>
                <code>{walletSetId}</code>
              </div>
              <div className="tenant-activation-audit">
                <div>
                  <span>AUDIT TRAIL // FINAL COMMITS</span>
                  <small>SECURE</small>
                </div>
                <ul>
                  <AuditLine label="Network Scoping" value={walletBlockchainsFromIntegration(integration, walletSet).join(", ") || "Created"} />
                  <AuditLine label="Circle Wallet Set" value={walletSetId} />
                  <AuditLine label="Tenant Registry" value={`${tenantDisplayName(payload)} mapping active`} />
                  <AuditLine label="Provider Status" value={formatStatus(walletSet?.status ?? integration?.status ?? "active")} />
                </ul>
              </div>
            </div>
          </div>

          <footer>
            <button onClick={() => navigate("/internal/operations/admin/tenant-activation")} type="button">
              <div>
                <span>Next Step</span>
                <p>Return to Tenant Configuration</p>
              </div>
              <ArrowRight size={18} />
            </button>
            <button onClick={reload} type="button">
              <div>
                <span>Record Keeping</span>
                <p>Refresh Archive Proof</p>
              </div>
              <Download size={18} />
            </button>
          </footer>
        </section>

        <div className="tenant-activation-success-meta">
          <span>SYS_ARCH: CLOUD_NATIVE</span>
          <span>VER: GTT-TENANT-ACTIVATION</span>
          <span>END_OF_TRANS_PROTOCOL</span>
        </div>
      </main>
    </div>
  );
};

const ModuleHeading = ({ children, index, title }: { children: string; index: string; title: string }) => (
  <div className="tenant-activation-module-heading">
    <span>{index}</span>
    <h2>{title}</h2>
    <p>{children}</p>
  </div>
);

const EndpointRow = ({ label, provider, status, value }: { label: string; provider: string; status: string; value: string }) => (
  <div>
    <span>{label}</span>
    <code>{value}</code>
    <span>{provider}</span>
    <small>{status}</small>
  </div>
);

const AuditLine = ({ label, value }: { label: string; value: string }) => (
  <li>
    <CheckCircle2 size={15} />
    <span>{label}</span>
    <code>{value}</code>
  </li>
);

const apiFetch = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json() as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error([payload.error ?? `request_failed:${response.status}`, payload.detail].filter(Boolean).join(": "));
  }
  return payload;
};

const activationFailureReason = (payload: TenantActivationPayload): string => {
  const providerError = payload.walletSet?.responsePayload?.providerError;
  const providerRecord = providerError && typeof providerError === "object" ? providerError as Record<string, unknown> : {};
  const message = typeof providerRecord.message === "string" ? providerRecord.message : undefined;
  const code = providerRecord.code !== undefined ? `code=${String(providerRecord.code)}` : undefined;
  const httpStatus = providerRecord.httpStatus !== undefined
    ? `httpStatus=${String(providerRecord.httpStatus)}`
    : payload.walletSet?.responsePayload?.httpStatus !== undefined
      ? `httpStatus=${String(payload.walletSet.responsePayload.httpStatus)}`
      : undefined;
  return [payload.walletSet?.errorCode ?? payload.error ?? "provider_unavailable", payload.detail, message, code, httpStatus]
    .filter(Boolean)
    .join(" - ");
};

const formFromPayload = (payload?: TenantActivationPayload): ActivationFormState => {
  const tenantName = tenantDisplayName(payload);
  const integration = payload?.circleIntegration;
  const walletBlockchains = walletBlockchainsFromIntegration(integration, payload?.walletSet);
  return {
    tenantAlias: tenantName,
    displayName: initials(tenantName),
    walletSetName: integration?.walletSetName ?? `${tenantName} Wallet Set`,
    walletSetId: integration?.walletSetId ?? "",
    walletBlockchains: walletBlockchains.length ? walletBlockchains : defaultWalletBlockchains,
    walletStrategy: integration?.walletStrategy ?? "omnibus_custodial_set",
    settlementNetwork: "circle_arc"
  };
};

const tenantDisplayName = (payload?: TenantActivationPayload): string =>
  payload?.tenant?.tenant_name ?? payload?.tenant?.tenantName ?? "Demo Tenant";

const initials = (value: string): string =>
  value
    .split(/\s+/)
    .map((item) => item[0])
    .join("")
    .slice(0, 5)
    .toUpperCase() || "GTT";

const shortHash = (...parts: string[]): string => {
  let hash = 0;
  for (const char of parts.join(":")) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return `0x${Math.abs(hash).toString(16).padStart(8, "0").slice(0, 8)}`;
};

const formatStatus = (value: string): string =>
  value.replace(/[_-]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const formatDateTime = (value?: string): string => {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().replace("T", " ").slice(0, 19);
};

const toggleRequiredValue = (values: string[], value: string): string[] => {
  if (!values.includes(value)) return [...values, value];
  const next = values.filter((item) => item !== value);
  return next.length ? next : values;
};

const walletBlockchainsFromIntegration = (
  integration?: CircleIntegration,
  walletSet?: TenantActivationPayload["walletSet"]
): string[] => {
  const metadataBlockchains = integration?.metadata?.responsePayload && typeof integration.metadata.responsePayload === "object"
    ? (integration.metadata.responsePayload as { blockchains?: unknown; walletBlockchains?: unknown }).blockchains
      ?? (integration.metadata.responsePayload as { blockchains?: unknown; walletBlockchains?: unknown }).walletBlockchains
    : undefined;
  const candidates = [
    integration?.walletBlockchains,
    metadataBlockchains,
    walletSet?.walletBlockchains
  ];
  for (const candidate of candidates) {
    const normalized = normalizeBlockchainList(candidate);
    if (normalized.length) return normalized;
  }
  return [];
};

const normalizeBlockchainList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
};

const sameStringSet = (left: string[], right: string[]): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((item) => rightSet.has(item));
};
