import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Download } from "lucide-react";
import { useState } from "react";
import apiManagementImageUrl from "../../assets-internal/api-management.jpg";

const scopes = ["READ:LEDGER", "WRITE:TX", "ADMIN:FULL", "READ:ANALYTICS"] as const;
const expirationPeriods = ["30 DAYS", "90 DAYS", "1 YEAR", "NEVER"] as const;
const secretKey = "gtt_demo_generated_key_9a2b5c8e1f0g4h7j";

export const NewApiKeyContent = ({ navigate }: { navigate: (path: string) => void }) => {
  const [step, setStep] = useState<"create" | "reveal">("create");

  if (step === "reveal") {
    return <RevealApiKeyView onDone={() => navigate("/internal/operations/api-keys")} />;
  }

  return <CreateApiKeyView onCancel={() => navigate("/internal/operations/api-keys")} onGenerate={() => setStep("reveal")} />;
};

const CreateApiKeyView = ({
  onCancel,
  onGenerate
}: {
  onCancel: () => void;
  onGenerate: () => void;
}) => {
  const [expiration, setExpiration] = useState("90 DAYS");

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
          <h2>Audit Log Reference</h2>
          <span>REF_ID: ADM-API-992-K</span>
          <span>REQUESTOR: ADMIN_01_PROD</span>
        </div>
      </aside>

      <section className="new-api-key-form-panel">
        <form onSubmit={(event) => {
          event.preventDefault();
          onGenerate();
        }}>
          <label>
            <span>Client Assignment</span>
            <div className="new-api-key-select">
              <select defaultValue="" required>
                <option value="" disabled>Select existing API Client</option>
                <option value="1">Settlement-Service-Prod</option>
                <option value="2">OMS-Integration-Core</option>
                <option value="3">Reporting-Nexus-Alpha</option>
                <option value="4">Liquidity-Bridge-Mainnet</option>
              </select>
              <ChevronDown size={16} />
            </div>
          </label>

          <label>
            <span>Key Name / Description</span>
            <input placeholder="e.g. Primary Write Access - Q4 Ops" type="text" required />
          </label>

          <fieldset>
            <legend>Permissions & Scopes</legend>
            <div className="new-api-key-scopes">
              {scopes.map((scope) => (
                <label key={scope}>
                  <input type="checkbox" />
                  <span>{scope}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            <span className="new-api-key-label-row">
              <span>IP Whitelisting (Optional)</span>
              <small>CIDR format allowed</small>
            </span>
            <textarea placeholder="192.168.1.1, 10.0.0.0/24" rows={3} />
          </label>

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

          <footer>
            <button className="new-api-key-primary" type="submit">Generate API Key</button>
            <button className="new-api-key-secondary" onClick={onCancel} type="button">Cancel</button>
          </footer>
        </form>
      </section>
    </div>
  );
};

const RevealApiKeyView = ({ onDone }: { onDone: () => void }) => {
  const [copied, setCopied] = useState(false);

  const copySecret = async () => {
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
            <code>ak_live_7249...x92k</code>
          </label>

          <label>
            <span>Secret Key</span>
            <div className="new-api-key-secret">
              <code>{secretKey}</code>
              <button onClick={copySecret} type="button">
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
                <small>TREASURY.READ</small>
                <small>LEDGER.WRITE</small>
                <small>ANALYTICS</small>
              </div>
            </div>
            <div>
              <span>Expiration Date</span>
              <p>Dec 31, 2025 - Never Expires</p>
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
