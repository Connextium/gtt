import { ArrowRight, CheckCircle2, Circle, Eye, HelpCircle, Lock, ShieldAlert } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import internalHouseImageUrl from "../../assets-internal/internal-house.jpg";
import {
  canAccessOperations,
  initialUsers,
  type AppUser,
  type RoleCode
} from "../../identity.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

interface InternalAuthResponse {
  user?: {
    id: string;
    email: string;
    displayName: string;
    tenantId: string;
    userType: AppUser["userType"];
    roles: RoleCode[];
    status: AppUser["status"];
  };
  redirectTo?: string;
  error?: string;
}

const appUserFromInternalResponse = (responseUser: InternalAuthResponse["user"]): AppUser | undefined => {
  if (!responseUser) return undefined;
  return {
    id: responseUser.id,
    authUserId: responseUser.id,
    tenantId: responseUser.tenantId,
    email: responseUser.email,
    displayName: responseUser.displayName,
    userType: responseUser.userType,
    status: responseUser.status,
    roles: responseUser.roles,
    createdAt: new Date().toISOString()
  };
};

const internalLanding = (_user: AppUser, redirectTo?: string): string => {
  if (!redirectTo || redirectTo.endsWith("/foundation")) {
    return "/internal/operations/commandcentre";
  }
  return redirectTo;
};

export const InternalOperationGateway = ({ onLogin }: { onLogin: (redirectTo: string, user: AppUser) => void }) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/internal-access/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const body = await response.json() as InternalAuthResponse;
      if (!response.ok) {
        setError(body.error ?? "Internal login failed.");
        return;
      }
      const user = appUserFromInternalResponse(body.user);
      if (!user) {
        setError("Internal login did not return a user profile.");
        return;
      }
      onLogin(internalLanding(user, body.redirectTo), user);
    } catch {
      const localUser = initialUsers.find((user) => user.email === email.trim().toLowerCase() && canAccessOperations(user));
      if (!localUser || password.trim().length === 0) {
        setError("Internal login failed.");
        return;
      }
      onLogin(internalLanding(localUser), localUser);
    }
  };

  return (
    <section className="internal-shell internal-login-shell">
      <header className="internal-fixed-header">
        <span className="internal-brand">Internal Admin Console</span>
        <div className="internal-header-actions">
          <HelpCircle size={20} />
          <span>V.4.2.0</span>
        </div>
      </header>

      <main className="internal-login-main">
        <section className="internal-login-panel">
          <div className="internal-form-frame">
            <h1>Administration Gateway</h1>
            <p>Secure access for authorized personnel only.</p>

            <form className="internal-form" onSubmit={submit}>
              <label htmlFor="admin_id">
                Administrator ID
                <input
                  autoComplete="email"
                  id="admin_id"
                  placeholder="Enter System ID or Email"
                  type="text"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>

              <label htmlFor="password">
                <span className="internal-label-row">
                  <span>Security Token / Password</span>
                  <button className="internal-text-command" type="button">Forgot Credentials?</button>
                </span>
                <div className="internal-password-field">
                  <input
                    autoComplete="current-password"
                    id="password"
                    placeholder="••••••••••••"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} title="Toggle password visibility">
                    <Eye size={16} />
                  </button>
                </div>
              </label>

              {error && <div className="form-error">{error}</div>}

              <button className="internal-primary-command" type="submit">
                Sign in to console
                <ArrowRight size={18} />
              </button>
            </form>

            <p className="internal-audit-copy">
              Institutional Monitoring: Access to this system is restricted to authorized personnel. Use is monitored for security and regulatory compliance. Unauthorized access or use is strictly prohibited and subject to legal action.
            </p>
          </div>
        </section>

        <InternalLoginVisual />
      </main>

      <footer className="internal-login-footer">
        <nav aria-label="Internal compliance links">
          <a href="#">Privacy Protocol</a>
          <a href="#">Compliance Framework</a>
          <a href="#">System Status</a>
        </nav>
        <p>© 2024 Treasury Platform Internal. All rights reserved. Regulatory disclosure: for authorized personnel only.</p>
      </footer>
    </section>
  );
};

export const InternalAccessInitialization = ({
  navigate,
  onInitialized
}: {
  navigate: (path: string) => void;
  onInitialized: (user: AppUser) => void;
}) => {
  const query = new URLSearchParams(window.location.search);
  const [email, setEmail] = useState(query.get("email") ?? "");
  const [setupToken, setSetupToken] = useState(query.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const reqLength = password.length >= 14;
  const reqChars = /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[^A-Za-z0-9]/.test(password);
  const reqUnique = password.length > 0 && !["password", "1234", "qwerty", "admin"].some((pattern) => password.toLowerCase().includes(pattern));
  const allValid = reqLength && reqChars && reqUnique && password === confirm && setupToken.trim().length > 0 && email.trim().length > 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!allValid) return;
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${apiBaseUrl}/internal-access/initialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, setupToken, password })
      });
      const body = await response.json() as InternalAuthResponse;
      if (!response.ok) {
        setError(body.error ?? "Access initialization failed.");
        return;
      }
      const user = appUserFromInternalResponse(body.user);
      if (!user) {
        setError("Access initialization did not return a user profile.");
        return;
      }
      setNotice("Internal access initialized.");
      onInitialized(user);
      navigate(internalLanding(user, body.redirectTo));
    } catch {
      setError("Access initialization service is unavailable.");
    }
  };

  return (
    <section className="internal-shell">
      <header className="internal-header">
        <div>
          <span className="internal-brand">Internal Admin Console</span>
          <small>Administration Gateway</small>
        </div>
        <div className="internal-header-actions">
          <HelpCircle size={20} />
          <span>Support</span>
        </div>
      </header>

      <main className="internal-init-main">
        <section className="internal-init-panel">
          <div className="internal-form-frame">
            <h1>Access Initialization</h1>
            <p>Security protocol requires a mandatory password update for all administrative identities upon initial console access.</p>

            <form className="internal-form" onSubmit={submit}>
              <label>
                Administrator Email
                <div className="internal-locked-field">
                  <input value={email} onChange={(event) => setEmail(event.target.value)} required />
                  <Lock size={16} />
                </div>
              </label>

              <label>
                Setup Token
                <div className="internal-locked-field">
                  <input value={setupToken} onChange={(event) => setSetupToken(event.target.value)} required />
                  <Lock size={16} />
                </div>
              </label>

              <label htmlFor="new_pwd">
                New Administrative Password
                <input
                  autoComplete="new-password"
                  id="new_pwd"
                  placeholder="••••••••••••"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </label>

              <label htmlFor="confirm_pwd">
                Confirm Password
                <input
                  autoComplete="new-password"
                  id="confirm_pwd"
                  placeholder="••••••••••••"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  required
                />
              </label>

              <div className="internal-protocol-box">
                <h3>Complexity Protocols</h3>
                <RequirementLine met={reqLength} label="Minimum 14 characters" />
                <RequirementLine met={reqChars} label="Uppercase, lowercase, numeric, and symbol" />
                <RequirementLine met={reqUnique} label='No sequential or common patterns, for example "1234" or "password"' />
              </div>

              {error && <div className="form-error">{error}</div>}
              {notice && <div className="form-notice">{notice}</div>}

              <button className="internal-primary-command" disabled={!allValid} type="submit">
                Establish secure identity
              </button>
            </form>

            <div className="internal-security-notice">
              <ShieldAlert size={20} />
              <div>
                <strong>Security Notice</strong>
                <p>Administrative access is logged and audited in real-time. Unauthorized attempts to bypass security protocols will trigger immediate credential revocation and internal investigation.</p>
              </div>
            </div>
          </div>
        </section>

        <InternalInitVisual />
      </main>

      <footer className="internal-init-footer">
        <p>© 2024 Treasury Platform Internal. All rights reserved. Regulatory disclosure: for authorized personnel only.</p>
        <div>
          <a href="#">Privacy Protocol</a>
          <a href="#">Compliance Framework</a>
          <span><i />System Nominal</span>
        </div>
      </footer>
    </section>
  );
};

const RequirementLine = ({ met, label }: { met: boolean; label: string }) => (
  <div className={`internal-requirement ${met ? "met" : ""}`}>
    {met ? <CheckCircle2 size={16} /> : <Circle size={16} />}
    <span>{label}</span>
  </div>
);

const InternalLoginVisual = () => (
  <aside className="internal-visual-panel internal-login-visual">
    <img alt="" src={internalHouseImageUrl} />
    <div className="internal-visual-overlay" />
    <div className="internal-status-stack">
      <span className="internal-terminal-ready">Terminal status: ready</span>
      <span>Encryption: AES-256</span>
    </div>
  </aside>
);

const InternalInitVisual = () => (
  <aside className="internal-visual-panel internal-init-visual">
    <img alt="" src={internalHouseImageUrl} />
    <div className="internal-grid-overlay" />
    <div className="internal-init-visual-copy">
      <span>Institutional grade security</span>
      <h2>Encapsulating complex digital assets within regulated frameworks.</h2>
      <p>Our treasury console utilizes military-grade encryption and strict administrative hierarchy to ensure global liquidity stability.</p>
    </div>
  </aside>
);
