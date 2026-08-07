import { type Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  Eye,
  LineChart,
  Loader2,
  Lock,
  Mail,
  Shield
} from "lucide-react";
import { useState, type FormEvent } from "react";
import headquartersBuilding from "../../../assets/headquarters-building.jpg";
import officeInhouse from "../../../assets/office-inhouse.jpg";
import headquartersBuildingAda from "../../../assets-ada/headquarters-building.jpg";
import officeInhouseAda from "../../../assets-ada/office-inhouse.jpg";
import { type InvitationResponse } from "./types.js";
import { apiRequest } from "../shared/apiClient.js";

type Navigate = (path: string) => void;

type SupabaseLike = {
  auth: {
    getSession: () => Promise<{ data: { session: Session | null } }>;
    resetPasswordForEmail: (
      email: string,
      options: { redirectTo: string }
    ) => Promise<{ error: { message: string } | null }>;
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<{ data: { session: Session | null }; error: { message: string } | null }>;
    updateUser: (attributes: { password: string }) => Promise<{ error: { message: string } | null }>;
  };
};

const isAdaHost = typeof window !== "undefined" && window.location.host.toLowerCase().startsWith("ada-");
const registerCoverImage = isAdaHost ? headquartersBuildingAda : headquartersBuilding;
const loginContextImage = isAdaHost ? officeInhouseAda : officeInhouse;

export function RegisterScreen({ navigate }: { navigate: Navigate }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    setSubmitting(true);
    try {
      const result = await apiRequest<InvitationResponse>("/auth/invitations", { method: "POST", body: { email } });
      if (result.status === "existing_account") {
        setNotice(result.message);
        return;
      }
      setSent(true);
      sessionStorage.setItem("gtt_registration_email", email);
      window.setTimeout(() => navigate("/auth/check-email"), 700);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gtt-register-shell">
      <section className="gtt-register-content">
        <header className="gtt-register-header">
          <div className="gtt-register-brand">Global Trade Treasury</div>
          <div className="gtt-register-header-actions">
            <span>Secure Portal v4.0</span>
            <button onClick={() => navigate("/sign-in")} type="button">Existing user login</button>
          </div>
        </header>

        <div className="gtt-register-main">
          <form className="gtt-register-form" onSubmit={submit}>
            <p className="gtt-compliance-note">
              Requires institutional verification. Registration constitutes acceptance of Compliance Protocol 882.
            </p>
            <label htmlFor="registration-email">Corporate Email</label>
            <div className="gtt-input-line">
              <Mail size={18} />
              <input
                id="registration-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="executive@institution.com"
                required
              />
            </div>
            {error ? <div className="form-error">{error}</div> : null}
            {notice ? <div className="form-notice">{notice}</div> : null}
            <button className={`gtt-primary-action ${sent ? "success" : ""}`} disabled={submitting || sent} type="submit">
              <span>{submitting ? "Processing verification..." : sent ? "Invitation sent" : "Initialize onboarding"}</span>
              {submitting ? <Loader2 className="spin" size={18} /> : sent ? <Check size={18} /> : <ArrowRight size={18} />}
            </button>
            <button className="gtt-login-link" onClick={() => navigate("/sign-in")} type="button">
              Existing user? Sign in to continue onboarding
            </button>
          </form>

          <div className="gtt-register-grid" aria-label="Registration capabilities">
            <FeatureBlock icon={Building2} title="Capital Efficiency" copy="Real-time liquidity management with cross-border settlement netting." />
            <FeatureBlock icon={Shield} title="Regulatory Rigor" copy="KYC and AML controls are anchored directly into the onboarding protocol." />
            <FeatureBlock icon={LineChart} title="Unified Ledger" copy="A single source of truth for global trade assets and ADA positions." />
          </div>
        </div>

        <footer className="gtt-register-footer">
          <div>
            <strong>GTT</strong>
            <span>2026 Global Trade Treasury. Member SIPC.</span>
          </div>
          <nav aria-label="Registration policies">
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
            <a href="#">Compliance</a>
          </nav>
        </footer>
      </section>

      <aside className="gtt-register-cover" aria-label="Institutional treasury environment">
        <img src={registerCoverImage} alt="" />
        <div className="gtt-register-copy">
          <span className="gtt-kicker">Institutional Gateway</span>
          <h1>The ADA Treasury.</h1>
          <p>
            Standardize global trade settlements with enterprise-grade ADA liquidity. Integrate multi-currency netting,
            secure ledger automation, and business onboarding within one regulated terminal.
          </p>
        </div>
      </aside>
    </main>
  );
}

export function CheckEmailScreen({ navigate }: { navigate: Navigate }) {
  const email = sessionStorage.getItem("gtt_registration_email");
  return (
    <main className="center-shell">
      <section className="status-card">
        <Mail size={34} />
        <span className="eyebrow">Invitation Sent</span>
        <h1>Check your email.</h1>
        <p>{email ? `The invitation was sent to ${email}.` : "The invitation was accepted for delivery."} Use the email link to create your password.</p>
        <button className="secondary-command" onClick={() => navigate("/register")} type="button">Use a different email</button>
      </section>
    </main>
  );
}

export function SetPasswordScreen({
  navigate,
  nextOnboardingRoute,
  session,
  supabase
}: {
  navigate: Navigate;
  nextOnboardingRoute: (token: string) => Promise<string>;
  session: Session | null;
  supabase?: SupabaseLike;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const email = session?.user.email ?? sessionStorage.getItem("gtt_registration_email") ?? "Verified business email";
  const isLength = password.length >= 16;
  const isComplex = /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
  const isSpecial = /[^a-zA-Z0-9]/.test(password);
  const isMatch = password === confirm && password.length > 0;
  const isValid = isLength && isComplex && isSpecial && isMatch;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!supabase) {
      setError("Supabase browser configuration is missing.");
      return;
    }
    if (!isValid) {
      setError("Password must satisfy all institutional security requirements.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? session?.access_token;
      if (!token) throw new Error("Supabase invitation session is not active.");
      navigate(await nextOnboardingRoute(token));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to set password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gtt-credentials-shell">
      <header className="gtt-credentials-header">
        <div className="gtt-register-brand">Global Trade Treasury</div>
        <span>Terminal Secure Access</span>
        <Lock size={20} />
      </header>

      <section className="gtt-credentials-card">
        <div className="gtt-credentials-title">
          <span className="gtt-kicker">Identity Verification</span>
          <h1>Establish Credentials</h1>
          <p>Configure institutional-grade access credentials for the ADA Treasury Terminal.</p>
        </div>

        <div className="gtt-verified-email">
          <label>Verified Email Address</label>
          <span>{email}</span>
          <CheckCircle2 size={18} />
        </div>

        <form className="gtt-credential-form" onSubmit={submit}>
          <label htmlFor="new-password">New Password</label>
          <div className="gtt-password-line">
            <input
              id="new-password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••••••••••"
              required
            />
            <button type="button" onClick={() => setShowPassword((value) => !value)} title="Toggle password visibility">
              <Eye size={20} />
            </button>
          </div>

          <label htmlFor="confirm-password">Confirm Password</label>
          <div className="gtt-password-line">
            <input
              id="confirm-password"
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="••••••••••••••••"
              required
            />
            <button type="button" onClick={() => setShowConfirm((value) => !value)} title="Toggle confirm password visibility">
              <Eye size={20} />
            </button>
          </div>

          <div className="gtt-requirement-grid">
            <span>Institutional Security Requirements</span>
            <RequirementItem met={isLength} text="Minimum 16 characters" />
            <RequirementItem met={isComplex} text="Mixed alpha-numeric" />
            <RequirementItem met={isSpecial} text="Special character sequence" />
            <RequirementItem met={isMatch} text="Inputs match perfectly" />
          </div>

          {error ? <div className="form-error">{error}</div> : null}
          <button className="gtt-primary-action credential" disabled={!supabase || !isValid || submitting} type="submit">
            <span>{submitting ? "Securing account" : "Secure account"}</span>
            {submitting ? <Loader2 className="spin" size={20} /> : <ArrowRight size={20} />}
          </button>
        </form>
      </section>

      <footer className="gtt-credentials-footer">
        <p>
          By securing this account, you acknowledge adherence to Global Trade Treasury's Master Service Agreement and
          Regulatory Compliance Standards.
        </p>
        <div>
          <span>SIPC Compliant</span>
          <span>Encrypted AES-256</span>
          <span>FINRA Certified</span>
        </div>
      </footer>
    </main>
  );
}

export function SignInScreen({ navigate, supabase }: { navigate: Navigate; supabase?: SupabaseLike }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    if (!supabase) {
      setError("Supabase browser configuration is missing.");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    setSubmitting(true);
    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (signInError) {
        setError(signInError.message);
        return;
      }

      const token = signInData.session?.access_token ?? (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        navigate("/welcome");
        return;
      }

      // Give the auth state listener one tick to publish the signed-in session.
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      navigate("/welcome");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendPasswordRecovery() {
    setError(undefined);
    setNotice(undefined);
    if (!supabase) {
      setError("Supabase browser configuration is missing.");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your business email before requesting password recovery.");
      return;
    }

    setResetting(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/auth/set-password`
    });
    setResetting(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setNotice("Password recovery email sent. Use the email link to set a new password, then sign in again.");
  }

  return (
    <main className="gtt-login-shell">
      <section className="gtt-login-left">
        <div className="gtt-login-panel">
          <button className="gtt-back-command" onClick={() => navigate("/register")} type="button">
            <ArrowLeft size={16} />
            Register instead
          </button>
          <span className="eyebrow">Returning User</span>
          <h1>Sign in to onboarding.</h1>
          <p>Use your verified business credentials to resume the institutional onboarding draft.</p>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="sign-in-email">
              Business email
              <input id="sign-in-email" type="email" placeholder="executive@institution.com" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </label>
            <label htmlFor="sign-in-password">
              Password
              <input id="sign-in-password" type="password" placeholder="••••••••••••••••" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </label>
            {error ? <div className="form-error">{error}</div> : null}
            {notice ? <div className="form-notice">{notice}</div> : null}
            <button className="primary-command" disabled={submitting} type="submit">
              <span>{submitting ? "Signing in" : "Sign in"}</span>
              {submitting ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}
            </button>
            <button className="gtt-login-link" disabled={resetting} onClick={() => void sendPasswordRecovery()} type="button">
              {resetting ? "Sending recovery email..." : "Reset password by email"}
            </button>
          </form>
        </div>
        <footer className="gtt-register-footer gtt-login-footer">
          <div>
            <strong>GTT</strong>
            <span>2026 Global Trade Treasury. Member SIPC.</span>
          </div>
          <nav aria-label="Sign in policies">
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
            <a href="#">Compliance</a>
          </nav>
        </footer>
      </section>
      <aside className="gtt-login-context">
        <img src={loginContextImage} alt="Institutional operations office" />
        <div>
          <span>Secure access</span>
          <strong>Resume your KYB review.</strong>
          <p>Returning users can continue from their saved onboarding session after authentication.</p>
        </div>
      </aside>
    </main>
  );
}

function FeatureBlock({
  copy,
  icon: Icon,
  title
}: {
  copy: string;
  icon: typeof Building2;
  title: string;
}) {
  return (
    <article>
      <Icon size={24} strokeWidth={1.5} />
      <h2>{title}</h2>
      <p>{copy}</p>
    </article>
  );
}

function RequirementItem({ met, text }: { met: boolean; text: string }) {
  return (
    <div className={`gtt-requirement ${met ? "met" : ""}`}>
      {met ? <CheckCircle2 size={16} /> : <Circle size={16} />}
      <span>{text}</span>
    </div>
  );
}
