import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Download } from "lucide-react";
import type React from "react";
import { useState } from "react";
import apiManagementImageUrl from "../../assets-internal/api-management.jpg";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

const scopes = [
  { label: "READ:OPERATIONS", value: "read:operations" },
  { label: "WRITE:ACCOUNTS", value: "write:accounts" },
  { label: "WRITE:LEDGER", value: "write:ledger" },
  { label: "ADMIN:API-KEYS", value: "admin:api-keys" }
] as const;
const expirationPeriods = ["30 DAYS", "90 DAYS", "1 YEAR", "NEVER"] as const;

interface CreatedApiKeyResponse {
  client?: {
    id: string;
    clientName: string;
  };
  key?: {
    id: string;
    keyPrefix: string;
    scopes: string[];
    expiresAt?: string;
    createdAt?: string;
  };
  plaintextKey: string;
}

export const NewApiKeyContent = ({ navigate }: { navigate: (path: string) => void }) => {
  const [step, setStep] = useState<"create" | "reveal">("create");
  const [createdKey, setCreatedKey] = useState<CreatedApiKeyResponse | undefined>();

  if (step === "reveal") {
    return <RevealApiKeyView createdKey={createdKey} onDone={() => navigate("/internal/operations/api-keys")} />;
  }

  return (
    <CreateApiKeyView
      onCancel={() => navigate("/internal/operations/api-keys")}
      onGenerate={(payload) => {
        setCreatedKey(payload);
        setStep("reveal");
      }}
    />
  );
};

const CreateApiKeyView = ({
  onCancel,
  onGenerate
}: {
  onCancel: () => void;
  onGenerate: (payload: CreatedApiKeyResponse) => void;
}) => {
  const [expiration, setExpiration] = useState("90 DAYS");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError("");
    const form = new FormData(event.currentTarget);
    const selectedScopes = form.getAll("scopes").filter((value): value is string => typeof value === "string");
    try {
      const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/api-keys`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${gttApiKey}`,
          "content-type": "application/json",
          "idempotency-key": `api-key-create-${crypto.randomUUID()}`
        },
        body: JSON.stringify({
          clientName: stringForm(form, "clientName", "API Client"),
          scopes: selectedScopes.length ? selectedScopes : ["read:operations"],
          expiresAt: expirationToIso(expiration)
        })
      });
      const payload = await response.json() as CreatedApiKeyResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `api_key_create_failed:${response.status}`);
      if (!payload.plaintextKey) throw new Error("api_key_plaintext_missing");
      onGenerate(payload);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "api_key_create_failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="new-api-key-content">
      <aside className="new-api-key-context">
        <h1>Create New<br />API Key</h1>
        <p>
          Configure scoped programmatic access for a specific API client. Ensure least-privilege access is
          applied to maintain institutional security integrity.
        </p>

        <div className="new-api-key-advisory">
          <h2>Security Advisory</h2>
          <p>The generated Secret Key is stored in hash-only format after initial display. If lost, the key must be revoked and regenerated.</p>
        </div>

        <div className="new-api-key-audit">
          <h2>Audit Evidence</h2>
          <span>Created through POST /api-keys</span>
          <span>Backend writes audit and outbox records</span>
        </div>
      </aside>

      <section className="new-api-key-form-panel">
        <form onSubmit={submit}>
          <label>
            <span>Key Name / Client Name</span>
            <div className="new-api-key-select">
              <input name="clientName" placeholder="e.g. Settlement-Service-Prod" required type="text" />
              <ChevronDown size={16} />
            </div>
          </label>

          <fieldset>
            <legend>Permissions & Scopes</legend>
            <div className="new-api-key-scopes">
              {scopes.map((scope) => (
                <label key={scope.value}>
                  <input defaultChecked={scope.value === "read:operations"} name="scopes" type="checkbox" value={scope.value} />
                  <span>{scope.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Key Expiration Period</legend>
            <div className="new-api-key-expiration">
              {expirationPeriods.map((period) => (
                <button
                  className={expiration === period ? "active" : ""}
                  key={period}
                  onClick={() => setExpiration(period)}
                  type="button"
                >
                  {period}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="new-api-key-enforcement">
            <AlertTriangle size={20} />
            <div>
              <h2>Security Enforcement</h2>
              <p>
                The generated secret key will be displayed once. Copy and store it in a secure hardware module
                or encrypted vault immediately. It will not be recoverable.
              </p>
            </div>
          </div>

          {submitError ? <div className="form-error">{submitError}</div> : null}

          <footer>
            <button className="new-api-key-primary" disabled={submitting} type="submit">
              {submitting ? "Generating..." : "Generate API Key"}
            </button>
            <button className="new-api-key-secondary" onClick={onCancel} type="button">Cancel</button>
          </footer>
        </form>
      </section>
    </div>
  );
};

const RevealApiKeyView = ({
  createdKey,
  onDone
}: {
  createdKey?: CreatedApiKeyResponse;
  onDone: () => void;
}) => {
  const [copied, setCopied] = useState(false);
  const secretKey = createdKey?.plaintextKey ?? "";

  const copySecret = async () => {
    if (!secretKey) return;
    await navigator.clipboard.writeText(secretKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div className="new-api-key-reveal">
      <aside>
        <img alt="API management secure credential workspace" src={apiManagementImageUrl} />
      </aside>

      <section>
        <div className="new-api-key-confirmation">
          <div>
            <CheckCircle2 size={17} />
            <span>System Confirmation</span>
          </div>
          <h1>API Key Generated:<br />One-Time Secret<br />Reveal.</h1>

          <div className="new-api-key-critical">
            <AlertTriangle size={20} />
            <p>
              Critical: This is the only time the secret key will be displayed in plaintext. Store it in a
              secure hardware module or encrypted vault immediately.
            </p>
          </div>
        </div>

        <div className="new-api-key-secret-stack">
          <label>
            <span>API Key ID</span>
            <code>{createdKey?.key?.id ?? "Unavailable"}</code>
          </label>

          <label>
            <span>Secret Key</span>
            <div className="new-api-key-secret">
              <code>{secretKey || "No plaintext key returned"}</code>
              <button disabled={!secretKey} onClick={copySecret} type="button">
                {copied ? (
                  <>
                    <Check size={16} />
                    <span>Copied</span>
                  </>
                ) : (
                  <Copy size={16} />
                )}
              </button>
            </div>
          </label>

          {copied && (
            <div className="new-api-key-copy-state">
              <CheckCircle2 size={16} />
              <span>Secret key copied to clipboard. Secure it now; it will not be shown again.</span>
            </div>
          )}

          <div className="new-api-key-reveal-meta">
            <div>
              <span>Scopes Assigned</span>
              <div>
                {(createdKey?.key?.scopes ?? []).map((scope) => <small key={scope}>{scope.toUpperCase()}</small>)}
              </div>
            </div>
            <div>
              <span>Expiration Date</span>
              <p>{createdKey?.key?.expiresAt ? formatDateTime(createdKey.key.expiresAt) : "Never expires"}</p>
            </div>
          </div>

          <footer>
            <button className="new-api-key-primary" onClick={onDone} type="button">I Have Secured My Key</button>
            <button className="new-api-key-secondary" type="button">
              <Download size={15} />
              Download Credentials (.JSON)
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
};

const stringForm = (form: FormData, key: string, fallback = ""): string => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
};

const expirationToIso = (period: string): string | undefined => {
  if (period === "NEVER") return undefined;
  const days = period === "30 DAYS" ? 30 : period === "90 DAYS" ? 90 : 365;
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

const formatDateTime = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(date);
};
