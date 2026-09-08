import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "../shared/apiClient.js";
import "./business-api-keys-scope.css";

type ApiKeyStatus = "active" | "revoked";

type ApiKeyItem = {
  scopes: string[];
  createdAt: string;
  id: string;
  keyPrefix: string;
  name: string;
  status: ApiKeyStatus;
  ownerBusinessClientName?: string;
};

type BusinessApiKeyApi = {
  createdAt: string;
  id: string;
  keyPrefix: string;
  ownerBusinessClientId: string;
  ownerBusinessClientName?: string;
  revokedAt?: string;
  scopes: string[];
  status: ApiKeyStatus;
};

type ListApiKeysResponse = { keys?: BusinessApiKeyApi[] };
type CreateApiKeyResponse = { key: BusinessApiKeyApi; plaintextKey: string };
type RevokeApiKeyResponse = { key: BusinessApiKeyApi };
type RotateApiKeyResponse = {
  key: BusinessApiKeyApi;
  plaintextKey: string;
  rotatedFromApiKeyId: string;
};

const SCOPE_OPTIONS = [
  {
    label: "ada.read, ada.open, payment-instruction.read",
    scopes: ["ada.read", "ada.open", "payment-instruction.read"]
  },
  {
    label: "ada.read",
    scopes: ["ada.read"]
  },
  {
    label: "ada.read, ada.open, payment-instruction.read, payment-instruction.create",
    scopes: ["ada.read", "ada.open", "payment-instruction.read", "payment-instruction.create"]
  }
] as const;

function CreateApiKeyModal({
  isOpen,
  onClose,
  onExecuteCreateKey
}: {
  isOpen: boolean;
  onClose: () => void;
  onExecuteCreateKey: (name: string, scopes: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("Treasury Bot Agent");
  const [scope, setScope] = useState<string>(SCOPE_OPTIONS[0].label);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  if (!isOpen) return null;

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || isSubmitting) return;
    const selected = SCOPE_OPTIONS.find((item) => item.label === scope);
    if (!selected) return;
    setIsSubmitting(true);
    setSubmitError("");
    try {
      await onExecuteCreateKey(name.trim(), [...selected.scopes]);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to create API key.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="bc-api-modal-overlay" role="dialog" aria-modal="true" aria-label="Create API key">
      <div className="bc-api-modal-panel">
        <div className="bc-api-modal-head">
          <div>
            <div className="kicker">PROGRAMMATIC ACCESS</div>
            <h3>Create Scoped API Key</h3>
          </div>
          <button onClick={onClose} type="button" aria-label="Close create API key modal">
            x
          </button>
        </div>

        <form onSubmit={handleCreate} className="bc-api-modal-form">
          <div>
            <label>Key Name / Application:</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Treasury Automated Router"
            />
          </div>

          <div>
            <label>Permissions Scope:</label>
            <select value={scope} onChange={(event) => setScope(event.target.value)}>
              {SCOPE_OPTIONS.map((option) => (
                <option key={option.label} value={option.label}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="bc-api-modal-actions">
            <button type="button" onClick={onClose} disabled={isSubmitting}>Cancel</button>
            <button className="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Generating..." : "Generate Key"}</button>
          </div>
          {submitError ? <p className="bc-api-error">{submitError}</p> : null}
        </form>
      </div>
    </div>
  );
}

function formatUtc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

function labelForKey(key: BusinessApiKeyApi): string {
  return key.ownerBusinessClientName ? `${key.ownerBusinessClientName} API Key` : "Business API Key";
}

export function BusinessApiKeysContent({ token }: { token: string }) {
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revealedSecret, setRevealedSecret] = useState<{ keyId: string; plaintextKey: string; reason: "created" | "rotated" } | null>(null);
  const [busyKeyId, setBusyKeyId] = useState<string>("");

  const hydrateKeys = async () => {
    if (!token) {
      setError("Business session not found. Sign in again to manage API keys.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await apiRequest<ListApiKeysResponse>("/business/api-keys", { token });
      const keys = (response.keys ?? []).map((key) => ({
        createdAt: formatUtc(key.createdAt),
        id: key.id,
        keyPrefix: key.keyPrefix,
        name: labelForKey(key),
        ownerBusinessClientName: key.ownerBusinessClientName,
        scopes: key.scopes,
        status: key.status
      }));
      setApiKeys(keys);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load API keys.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void hydrateKeys();
  }, [token]);

  const sortedKeys = useMemo(
    () => [...apiKeys].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [apiKeys]
  );

  async function handleCreateKey(name: string, scopes: string[]) {
    if (!token) return;
    setError("");
    try {
      const payload = await apiRequest<CreateApiKeyResponse>("/business/api-keys", {
        method: "POST",
        token,
        body: {
          name,
          scopes
        }
      });

      setApiKeys((previous) => [
        {
          createdAt: formatUtc(payload.key.createdAt),
          id: payload.key.id,
          keyPrefix: payload.key.keyPrefix,
          name: name || labelForKey(payload.key),
          ownerBusinessClientName: payload.key.ownerBusinessClientName,
          scopes: payload.key.scopes,
          status: payload.key.status
        },
        ...previous
      ]);
      setRevealedSecret({ keyId: payload.key.id, plaintextKey: payload.plaintextKey, reason: "created" });
      setToast(`Generated API Key ${payload.key.id}`);
      setTimeout(() => setToast(""), 1800);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to create API key.");
      throw requestError;
    }
  }

  async function revokeKey(apiKeyId: string) {
    if (!token || busyKeyId) return;
    setBusyKeyId(apiKeyId);
    setError("");
    try {
      const payload = await apiRequest<RevokeApiKeyResponse>(`/business/api-keys/${encodeURIComponent(apiKeyId)}/revoke`, {
        method: "POST",
        token,
        body: { reasonCode: "user_revoked_key" }
      });
      setApiKeys((current) => current.map((key) => key.id === apiKeyId ? { ...key, status: payload.key.status } : key));
      setToast(`Revoked API Key ${apiKeyId}`);
      setTimeout(() => setToast(""), 1800);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to revoke API key.");
    } finally {
      setBusyKeyId("");
    }
  }

  async function rotateKey(apiKeyId: string, scopes: string[]) {
    if (!token || busyKeyId) return;
    setBusyKeyId(apiKeyId);
    setError("");
    try {
      const payload = await apiRequest<RotateApiKeyResponse>(`/business/api-keys/${encodeURIComponent(apiKeyId)}/rotate`, {
        method: "POST",
        token,
        body: {
          scopes,
          reasonCode: "scheduled_rotation"
        }
      });
      setApiKeys((current) => {
        const revokedSource = current.map((item) => item.id === apiKeyId ? { ...item, status: "revoked" as const } : item);
        return [
          {
            createdAt: formatUtc(payload.key.createdAt),
            id: payload.key.id,
            keyPrefix: payload.key.keyPrefix,
            name: labelForKey(payload.key),
            ownerBusinessClientName: payload.key.ownerBusinessClientName,
            scopes: payload.key.scopes,
            status: payload.key.status
          },
          ...revokedSource
        ];
      });
      setRevealedSecret({ keyId: payload.key.id, plaintextKey: payload.plaintextKey, reason: "rotated" });
      setToast(`Rotated API Key ${apiKeyId}`);
      setTimeout(() => setToast(""), 1800);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to rotate API key.");
    } finally {
      setBusyKeyId("");
    }
  }

  function copySecret(value: string) {
    void navigator.clipboard.writeText(value);
    setToast("Copied one-time key to clipboard");
    setTimeout(() => setToast(""), 1800);
  }

  return (
    <section className="bc-api-scope">
      {toast ? <div className="bc-api-toast">{toast}</div> : null}

      <div className="bc-api-wrap">
        <header className="bc-api-header">
          <div>
            <div className="kicker">SECURITY AND ACCESS // SCOPED CREDENTIALS</div>
            <h2>Scoped API Keys</h2>
            <p>Programmatic access keys with fine-grained RBAC permissions for treasury automation.</p>
          </div>

          <button className="primary" onClick={() => setIsCreateOpen(true)} type="button">
            + Generate New API Key
          </button>
        </header>

        {revealedSecret ? (
          <section className="bc-api-secret-panel" role="status" aria-live="polite">
            <div>
              <strong>One-time secret reveal ({revealedSecret.reason === "created" ? "created" : "rotated"})</strong>
              <p>This key is shown once. Store it now. It will not be shown again after this panel is dismissed or the page reloads.</p>
            </div>
            <div className="bc-api-secret-value">
              <code>{revealedSecret.plaintextKey}</code>
              <div>
                <button type="button" onClick={() => copySecret(revealedSecret.plaintextKey)}>Copy</button>
                <button type="button" onClick={() => setRevealedSecret(null)}>Dismiss</button>
              </div>
            </div>
          </section>
        ) : null}

        {error ? <p className="bc-api-error">{error}</p> : null}

        <section className="bc-api-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Key Identifier</th>
                <th>Name / Application</th>
                <th>Allowed Scopes</th>
                <th>Created At</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6}>Loading business API keys...</td>
                </tr>
              ) : null}
              {!loading && sortedKeys.length === 0 ? (
                <tr>
                  <td colSpan={6}>No API keys created yet.</td>
                </tr>
              ) : null}
              {sortedKeys.map((key) => (
                <tr key={key.id}>
                  <td>
                    <div className="key-id">{key.id}</div>
                    <div className="key-prefix">{key.keyPrefix}****************</div>
                  </td>
                  <td className="key-name">{key.name}</td>
                  <td>
                    <span className="scope-chip">{key.scopes.join(", ")}</span>
                  </td>
                  <td className="created-at">{key.createdAt}</td>
                  <td>
                    <span className={`status ${key.status}`}>{key.status.toUpperCase()}</span>
                  </td>
                  <td className="actions">
                    <button
                      disabled={busyKeyId === key.id || key.status !== "active"}
                      onClick={() => void rotateKey(key.id, key.scopes)}
                      type="button"
                    >
                      Rotate
                    </button>
                    <button
                      disabled={busyKeyId === key.id || key.status !== "active"}
                      onClick={() => void revokeKey(key.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <CreateApiKeyModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onExecuteCreateKey={handleCreateKey}
      />
    </section>
  );
}
