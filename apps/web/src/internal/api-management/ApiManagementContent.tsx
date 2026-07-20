import {
  AlertTriangle,
  Copy,
  Download,
  Filter,
  Plus,
  RefreshCw,
  ShieldCheck,
  Terminal,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ApiClientData, ApiKeyStatus } from "./api-management-data.js";

interface ApiManagementStat {
  label: string;
  value: string;
  tone?: "error";
}

interface ApiKeyListItem {
  id: string;
  tenantId: string;
  apiClientId: string;
  keyPrefix: string;
  scopes: string[];
  status: "active" | "revoked";
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  createdAt: string;
  keyName?: string;
  clientName?: string;
  clientStatus?: "active" | "disabled";
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

export const ApiManagementContent = ({ navigate }: { navigate: (path: string) => void }) => {
  const [showReveal, setShowReveal] = useState(false);
  const [clients, setClients] = useState<ApiClientData[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoadStatus("loading");
    setLoadError("");

    fetch(`${apiBaseUrl.replace(/\/+$/, "")}/api-keys`, {
      headers: {
        authorization: `Bearer ${gttApiKey}`
      },
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json() as { keys?: ApiKeyListItem[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? `api_keys_fetch_failed:${response.status}`);
        setClients((payload.keys ?? []).map(apiKeyToClientData));
        setLoadStatus("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setClients([]);
        setLoadStatus("error");
        setLoadError(error instanceof Error ? error.message : "api_keys_fetch_failed");
      });

    return () => controller.abort();
  }, []);

  const stats = useMemo<ApiManagementStat[]>(() => {
    const uniqueClientIds = new Set(clients.map((client) => client.uuid));
    const activeKeys = clients.filter((client) => client.status === "active").length;
    const revokedKeys = clients.filter((client) => client.status === "revoked").length;
    return [
      { label: "Total Clients", value: String(uniqueClientIds.size) },
      { label: "Active Keys", value: String(activeKeys) },
      { label: "Revoked (30d)", value: String(revokedKeys).padStart(2, "0"), tone: revokedKeys > 0 ? "error" : undefined },
      { label: "Requests (24h)", value: clients.some((client) => client.lastUsed) ? "Live" : "0" }
    ];
  }, [clients]);

  return (
    <div className="api-management-content">
      <div className="api-management-heading">
        <div>
          <h1>API Key Management</h1>
          <p>
            Configure secure programmatic access to the Treasury Architect engine. Manage client identities,
            scopes, and key lifecycles.
          </p>
        </div>
        <button className="api-management-primary" onClick={() => navigate("/internal/operations/api-keys/new")} type="button">
          <Plus size={16} />
          <span>Create New Key</span>
        </button>
      </div>

      <section className="api-management-stats" aria-label="API key summary">
        {stats.map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <span className={`api-management-stat-value ${item.tone === "error" ? "error" : ""}`}>{item.value}</span>
          </article>
        ))}
      </section>

      {showReveal && (
        <section className="api-management-reveal" aria-live="polite">
          <button className="api-management-close" onClick={() => setShowReveal(false)} title="Dismiss" type="button">
            <X size={18} />
          </button>
          <AlertTriangle size={28} />
          <div>
            <h2>Secure Key Generated</h2>
            <p>
              This is a one-time plaintext reveal for <span className="api-management-inline-emphasis">Settlement-Service-Production-Node-01</span>.
              Store this safely. It will not be shown again.
            </p>
            <div className="api-management-secret">
              <code>ak_live_72kXj9W0qLmN41vR6zB2pT5sA8cV3nE1</code>
              <button type="button">
                <Copy size={14} />
                <span>Copy</span>
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="api-management-table-card">
        <header>
          <h2>Active API Clients</h2>
          <div>
            <button type="button">
              <Filter size={15} />
              <span>Filter</span>
            </button>
            <button type="button">
              <Download size={15} />
              <span>Export CSV</span>
            </button>
          </div>
        </header>

        <div className="api-management-table-wrap">
          <table className="api-management-table">
            <thead>
              <tr>
                <th>Key Name</th>
                <th>Status</th>
                <th>Scopes</th>
                <th>Metadata</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loadStatus === "loading" && (
                <tr>
                  <td className="api-management-state-cell" colSpan={5}>Loading API keys from database...</td>
                </tr>
              )}
              {loadStatus === "error" && (
                <tr>
                  <td className="api-management-state-cell error" colSpan={5}>Unable to retrieve API keys: {loadError}</td>
                </tr>
              )}
              {loadStatus === "ready" && clients.length === 0 && (
                <tr>
                  <td className="api-management-state-cell" colSpan={5}>No API keys found in the database.</td>
                </tr>
              )}
              {loadStatus === "ready" && clients.map((client) => (
                <ApiClientRow client={client} key={client.id} />
              ))}
            </tbody>
          </table>
        </div>

        <footer>
          <span>Showing {clients.length} database-backed keys</span>
          <div>
            <button disabled type="button">Previous</button>
            <button type="button">Next</button>
          </div>
        </footer>
      </section>

      <section className="api-management-doc-grid" aria-label="API management operational guidance">
        <article>
          <Terminal size={30} />
          <div>
            <h2>CLI Auth Method</h2>
            <p>Quickly authenticate local environments using the command line with your managed keys.</p>
            <code>$ treasury-arch login --key [YOUR_API_KEY]</code>
          </div>
        </article>
        <article>
          <ShieldCheck size={30} />
          <div>
            <h2>IP Whitelisting</h2>
            <p>Enforce strict network boundaries so keys are only usable from registered corporate static IPs.</p>
            <button type="button">Manage Whitelist</button>
          </div>
        </article>
      </section>
    </div>
  );
};

const ApiClientRow = ({ client }: { client: ApiClientData }) => (
  <tr className={client.status === "revoked" ? "muted" : ""}>
    <td>
      <span className="api-management-client-name">{client.name}</span>
      <span>UUID: {client.uuid}</span>
    </td>
    <td>
      <StatusPill status={client.status} />
    </td>
    <td>
      <div className="api-management-scopes">
        {client.scopes.map((scope) => (
          <span key={scope}>{scope}</span>
        ))}
      </div>
    </td>
    <td>
      <div className="api-management-meta">
        {client.created && <MetadataLine label="Created" value={client.created} />}
        {client.lastUsed && <MetadataLine label="Last Used" value={client.lastUsed} />}
        {client.lastIp && <MetadataLine label="Last IP" value={client.lastIp} />}
        {client.expires && <MetadataLine label="Expires" value={client.expires} tone="error" />}
      </div>
    </td>
    <td>
      <div className="api-management-actions">
        {client.status === "active" && (
          <>
            <button title="Rotate key" type="button">
              <RefreshCw size={17} />
            </button>
            <button title="Revoke access" type="button">
              <XCircle size={17} />
            </button>
          </>
        )}
        {client.status === "revoked" && <button type="button">View Audit</button>}
        {client.status === "expired" && <button className="renew" type="button">Renew</button>}
      </div>
    </td>
  </tr>
);

const apiKeyToClientData = (key: ApiKeyListItem): ApiClientData => ({
  id: key.id,
  name: key.keyName ?? key.clientName ?? key.keyPrefix,
  uuid: key.apiClientId,
  keyPrefix: key.keyPrefix,
  status: apiKeyStatus(key),
  scopes: key.scopes,
  created: formatApiDate(key.createdAt),
  expires: key.expiresAt ? formatApiDate(key.expiresAt) : undefined,
  lastUsed: key.lastUsedAt ? formatApiDate(key.lastUsedAt) : undefined,
  lastIp: key.lastUsedIp
});

const apiKeyStatus = (key: ApiKeyListItem): ApiKeyStatus => {
  if (key.status === "revoked") return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
};

const formatApiDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
};

const StatusPill = ({ status }: { status: ApiKeyStatus }) => (
  <span className={`api-management-status ${status}`}>
    {status === "active" && <i />}
    {status}
  </span>
);

const MetadataLine = ({
  label,
  tone,
  value
}: {
  label: string;
  tone?: "error";
  value: string;
}) => (
  <>
    <span>{label}:</span>
    <span className={`api-management-meta-value ${tone === "error" ? "error" : ""}`}>{value}</span>
  </>
);
