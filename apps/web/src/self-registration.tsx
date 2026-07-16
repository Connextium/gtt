import { createClient, type Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Bell,
  Building2,
  Check,
  CheckCircle2,
  Circle,
  CreditCard,
  Download,
  Eye,
  Gavel,
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Clock,
  LineChart,
  Loader2,
  Lock,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UploadCloud,
  Shield,
  User,
  Users,
  Headphones,
  Wallet,
  FileText,
  TrendingUp
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import applicationPendingGraphic from "./assets/application-pending-graphic.svg";
import headquartersBuilding from "./assets/headquarters-building.jpg";
import officeInhouse from "./assets/office-inhouse.jpg";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const supabase = (() => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return undefined;
  return createClient(url, anonKey);
})();

type Navigate = (path: string) => void;

type OnboardingStatus = "draft" | "submitted" | "pending_review" | "approved" | "rejected";
type OnboardingStepKey = "step_1" | "step_2" | "step_3" | "step_4" | "pending_review" | "reviewd";

interface OnboardingApplication {
  id: string;
  email: string;
  currentStep: OnboardingStepKey;
  status: OnboardingStatus;
  submittedAt?: string;
  updatedAt: string;
}

interface MyOnboardingResponse {
  application: OnboardingApplication;
}

interface InvitationResponse {
  ok: boolean;
  status: "check_email" | "existing_account";
  message: string;
}

export const selfRegistrationRoutes = new Set([
  "/",
  "/register",
  "/sign-in",
  "/auth/check-email",
  "/auth/set-password",
  "/onboarding/step-1",
  "/onboarding/step-2",
  "/onboarding/step-3",
  "/onboarding/step-4",
  "/submission-confirmed",
  "/application-pending",
  "/welcome"
]);

export function SelfRegistrationRouter({ path, navigate }: { path: string; navigate: Navigate }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (path === "/" || path === "/register") return <RegisterScreen navigate={navigate} />;
  if (path === "/sign-in") return <SignInScreen navigate={navigate} />;
  if (path === "/auth/check-email") return <CheckEmailScreen navigate={navigate} />;
  if (path === "/auth/set-password") return <SetPasswordScreen navigate={navigate} session={session} />;
  if (path === "/submission-confirmed") return <Protected loading={loading} session={session} navigate={navigate}><SubmissionConfirmedScreen navigate={navigate} session={session} /></Protected>;
  if (path === "/application-pending") return <Protected loading={loading} session={session} navigate={navigate}><PendingReviewScreen navigate={navigate} session={session} /></Protected>;
  if (path === "/welcome") return <Protected loading={loading} session={session} navigate={navigate}><WelcomeLandingScreen navigate={navigate} session={session} /></Protected>;
  if (path.startsWith("/onboarding/")) {
    return (
      <Protected loading={loading} session={session} navigate={navigate}>
        <OnboardingStepScreen path={path} navigate={navigate} session={session} />
      </Protected>
    );
  }
  return <RegisterScreen navigate={navigate} />;
}

function RegisterScreen({ navigate }: { navigate: Navigate }) {
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
        <img src={headquartersBuilding} alt="" />
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

function CheckEmailScreen({ navigate }: { navigate: Navigate }) {
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

function SetPasswordScreen({ navigate, session }: { navigate: Navigate; session: Session | null }) {
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

function SignInScreen({ navigate }: { navigate: Navigate }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    if (!supabase) {
      setError("Supabase browser configuration is missing.");
      return;
    }
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    navigate(token ? await nextOnboardingRoute(token) : "/onboarding/step-1");
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
            <button className="primary-command" disabled={submitting} type="submit">
              <span>{submitting ? "Signing in" : "Sign in"}</span>
              {submitting ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}
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
        <img src={officeInhouse} alt="Institutional operations office" />
        <div>
          <span>Secure access</span>
          <strong>Resume your KYB review.</strong>
          <p>Returning users can continue from their saved onboarding session after authentication.</p>
        </div>
      </aside>
    </main>
  );
}

function Protected({ children, loading, navigate, session }: { children: ReactNode; loading: boolean; navigate: Navigate; session: Session | null }) {
  useEffect(() => {
    if (!loading && !session) navigate("/register");
  }, [loading, navigate, session]);

  if (loading) return <main className="center-shell"><div className="status-card"><span className="eyebrow">Checking Session</span></div></main>;
  if (!session) return null;
  return <>{children}</>;
}

function OnboardingStepScreen({ path, navigate, session }: { path: string; navigate: Navigate; session: Session | null }) {
  const step = useMemo(() => path.split("/").at(-1) ?? "step-1", [path]);
  const stepNumber = Number(step.replace("step-", ""));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    nextOnboardingRoute(token)
      .then((route) => {
        if (!active) return;
        const currentRoute = `/onboarding/step-${stepNumber}`;
        if (route !== currentRoute) navigate(route);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate, session?.access_token, stepNumber]);

  async function continueStep(payload: Record<string, unknown> = {}) {
    setError(undefined);
    const token = session?.access_token;
    if (!token) return;
    setSaving(true);
    if (stepNumber >= 4) {
      try {
        await apiRequest(`/onboarding/me/steps/step_${stepNumber}`, {
          method: "PATCH",
          token,
          body: { payload: { ...payload, completedFrom: step, savedAt: new Date().toISOString() } }
        });
        const result = await apiRequest<{ redirectTo: string }>("/onboarding/me/submit", { method: "POST", token });
        navigate(result.redirectTo);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unable to submit onboarding.");
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      await apiRequest(`/onboarding/me/steps/step_${stepNumber}`, {
        method: "PATCH",
        token,
        body: { payload: { ...payload, completedFrom: step, savedAt: new Date().toISOString() } }
      });
      navigate(`/onboarding/step-${stepNumber + 1}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save onboarding step.");
    } finally {
      setSaving(false);
    }
  }

  const props = { error, navigate, saving, continueStep };
  if (stepNumber === 2) return <BusinessProfileStep {...props} />;
  if (stepNumber === 3) return <BeneficialOwnershipStep {...props} />;
  if (stepNumber === 4) return <IntendedUseStep {...props} />;
  return <OnboardingIntroStep {...props} />;
}

type StepProps = {
  continueStep: (payload?: Record<string, unknown>) => void;
  error?: string;
  navigate: Navigate;
  saving: boolean;
};

const stepLabels = ["Business Identity", "Business Profile", "Beneficial Ownership", "Intended Use"];

function OnboardingSidebar({ currentStep }: { currentStep: number }) {
  return (
    <aside className="gtt-onboarding-sidebar">
      <div className="gtt-onboarding-brand">
        <span>GTT</span>
        <div>
          <strong>Global Trade Treasury</strong>
          <small>Business onboarding</small>
        </div>
      </div>
      <nav aria-label="Onboarding progress">
        {stepLabels.map((label, index) => {
          const step = index + 1;
          return (
            <div className={`gtt-onboarding-nav-item ${step === currentStep ? "active" : step < currentStep ? "complete" : ""}`} key={label}>
              {step < currentStep ? <CheckCircle2 size={16} /> : <span>{String(step).padStart(2, "0")}</span>}
              <div>
                <strong>{label}</strong>
                <small>{step < currentStep ? "Completed" : step === currentStep ? "In progress" : "Locked"}</small>
              </div>
            </div>
          );
        })}
      </nav>
      <div className="gtt-onboarding-sidebar-note">
        <KeyRound size={18} />
        <p>Authenticated session bound to the institutional KYB draft.</p>
      </div>
    </aside>
  );
}

function OnboardingTopBar({ currentStep, title }: { currentStep: number; title: string }) {
  return (
    <header className="gtt-onboarding-topbar">
      <div>
        <span>Step {currentStep} of 4</span>
        <h1>{title}</h1>
      </div>
      <div className="gtt-step-progress" aria-label={`Step ${currentStep} of 4`}>
        {[1, 2, 3, 4].map((item) => <i className={item <= currentStep ? "active" : ""} key={item} />)}
      </div>
    </header>
  );
}

function OnboardingFooter() {
  return (
    <footer className="gtt-onboarding-footer">
      <strong>GLOBAL TRADE TREASURY</strong>
      <nav aria-label="Onboarding policies">
        <a href="#">Terms</a>
        <a href="#">Privacy</a>
        <a href="#">Compliance</a>
        <a href="#">API Documentation</a>
      </nav>
      <span>2026. Member SIPC.</span>
    </footer>
  );
}

function ActionRow({ backTo, error, navigate, primary, saving }: { backTo?: string; error?: string; navigate: Navigate; primary: string; saving: boolean }) {
  return (
    <>
      <div className="gtt-onboarding-actions">
        {backTo ? (
          <button className="gtt-secondary-action" onClick={() => navigate(backTo)} type="button">
            <ArrowLeft size={16} />
            Back
          </button>
        ) : <span />}
        <button className="gtt-primary-action" disabled={saving} type="submit">
          <span>{saving ? "Saving" : primary}</span>
          {saving ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}
        </button>
      </div>
      {error ? <div className="form-error">{error}</div> : null}
    </>
  );
}

function OnboardingIntroStep({ continueStep, error, navigate, saving }: StepProps) {
  return (
    <main className="gtt-onboarding-intro">
      <header className="gtt-register-header">
        <div className="gtt-register-brand">Global Trade Treasury</div>
        <span>Partner Onboarding</span>
      </header>
      <section className="gtt-intro-hero grid grid-cols-1 md:grid-cols-12 gap-6 mb-12">
        <div className="md:col-span-7 flex flex-col justify-center">
          <span className="gtt-section-kicker font-label-caps text-xs uppercase text-primary tracking-[0.2em] border-l-2 border-primary pl-3">
            Partner Onboarding
          </span>
          <h1 className="font-display-lg text-5xl text-primary mb-5 leading-tight tracking-tight">
            Establish Your Institutional Gateway.
          </h1>
          <p className="font-body-primary text-secondary text-lg max-w-xl mb-8">
            Complete secure verification to access Global Trade Treasury liquidity pools and trade ledgers. The KYB framework keeps each entity aligned with regulatory review requirements.
          </p>
          <div className="gtt-intro-actions flex gap-4">
            <button className="gtt-primary-action bg-primary text-on-primary px-8 py-3 font-body-strong transition-all hover:opacity-90 active:scale-[0.98]" disabled={saving} onClick={() => continueStep({ acknowledgedFramework: true })} type="button">
              <span>{saving ? "Saving" : "Resume Application"}</span>
              {saving ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />}
            </button>
            <button className="gtt-secondary-action border border-primary text-primary px-8 py-3 font-body-strong hover:bg-surface-container-low transition-all active:scale-[0.98]" type="button">View Documentation</button>
          </div>
        </div>
        <aside className="gtt-intro-image md:col-span-5 h-[400px] relative overflow-hidden hidden md:block">
          <img src={officeInhouse} alt="Institutional operations office" />
          <div className="absolute bottom-0 right-0 bg-white p-6 border-l border-t border-hairline z-10 w-3/4">
            <span className="font-label-caps text-[10px] text-secondary mb-2 uppercase tracking-widest">Current Status</span>
            <strong className="font-display-md text-3xl text-primary">Step 1 Ready</strong>
            <small className="font-metadata text-xs text-status-pending mt-1 italic">Authenticated onboarding session established</small>
          </div>
        </aside>
      </section>
      <section className="gtt-framework-section border-t border-hairline pt-12">
        <div className="gtt-section-heading flex justify-between items-end mb-8">
          <div>
            <h2 className="font-section-header text-xl text-primary uppercase tracking-tight">KYB Framework</h2>
            <p className="font-metadata text-sm text-secondary mt-1">Required disclosures for Terminal ID: 8842-X</p>
          </div>
          <span className="font-data-mono text-sm text-secondary">Completion: 25%</span>
        </div>
        <div className="gtt-framework-grid grid grid-cols-1 md:grid-cols-3 gap-0 hairline-all">
          <FrameworkCard icon={CheckCircle2} index="01" status="Status: Verified" title="Business Identity" copy="Legal entity registration, tax identification numbers, and operating jurisdiction details." />
          <FrameworkCard active icon={MoreHorizontal} index="02" status="Continue Section" title="Business Profile" copy="Commercial model, entity operations, footprint, and treasury use profile." />
          <FrameworkCard muted icon={Lock} index="03" status="Status: Locked" title="Regulatory Disclosures" copy="Ownership attestations, source of funds declarations, and final submission." />
        </div>
      </section>
      <section className="gtt-intro-lower grid grid-cols-1 md:grid-cols-12 gap-6 mt-12 py-12 border-t border-hairline">
        <div className="md:col-span-4">
          <h3 className="font-label-caps text-xs text-primary uppercase tracking-widest mb-5">Audit Log</h3>
          {["Entity profile awaiting confirmation", "Invitation credentials secured", "Onboarding session initiated"].map((item, index) => (
            <p className="font-metadata text-sm text-primary" key={item}><span className="font-data-mono text-xs text-secondary">07.{16 - index}.26</span>{item}</p>
          ))}
        </div>
        <div className="md:col-span-8 flex flex-col justify-between">
          <aside className="bg-canvas-soft p-8 border border-hairline">
            <Info size={20} />
            <h3 className="font-body-strong text-lg">Regulatory Notice</h3>
            <p className="font-body-primary text-secondary leading-relaxed text-sm">Institutional partners must complete KYB screening before treasury access is enabled. Use current documentation and confirm that all disclosures are accurate.</p>
          </aside>
        </div>
      </section>
      {error ? <div className="gtt-intro-error form-error">{error}</div> : null}
      <OnboardingFooter />
    </main>
  );
}

function FrameworkCard({ active, copy, icon: Icon, index, muted, status, title }: { active?: boolean; copy: string; icon: typeof CheckCircle2; index: string; muted?: boolean; status: string; title: string }) {
  return (
    <article className={`gtt-framework-card p-6 bg-surface-bright relative flex flex-col ${active ? "active bg-white shadow-[0_0_40px_rgba(0,0,0,0.03)] z-10" : ""} ${muted ? "muted grayscale opacity-60" : ""}`}>
      <div className="flex justify-between items-start mb-12">
        <Icon size={32} strokeWidth={1.5} />
        <span className="font-data-mono text-secondary">{index}</span>
      </div>
      <h3 className="font-display-md text-2xl text-primary mb-3">{title}</h3>
      <p className="font-body-primary text-secondary mb-6 text-sm">{copy}</p>
      <strong className="inline-block px-3 py-1 border border-primary font-metadata text-[10px] uppercase tracking-wider text-primary font-bold">{status}</strong>
    </article>
  );
}

function BusinessProfileStep({ continueStep, error, navigate, saving }: StepProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    continueStep(data);
  }

  return (
    <main className="gtt-onboarding-workspace">
      <OnboardingSidebar currentStep={2} />
      <section className="gtt-onboarding-main">
        <OnboardingTopBar currentStep={2} title="Onboarding: Business Profile" />
        <form className="gtt-onboarding-layout" onSubmit={submit}>
          <div className="gtt-form-stack">
            <FormSection index="1" title="Basic Business Info">
              <TextField label="Business Website" name="businessWebsite" placeholder="https://www.yourcompany.com" type="url" />
              <TextArea label="Business Model Description" name="businessModel" note="Provide a concise overview of commercial operations." placeholder="Digital payments platform specializing in cross-border trade settlements..." />
              <TextArea label="Products/Services Description" name="productsServices" placeholder="Describe specific financial or commercial products offered..." />
            </FormSection>
            <FormSection index="2" title="Business Registration">
              <div className="gtt-field-grid">
                <TextField wide label="Legal Business Name" name="legalBusinessName" placeholder="Full Legal Entity Name" />
                <SelectField label="Country of Formation" name="formationCountry" options={["Select Jurisdiction", "United States", "United Kingdom", "Singapore", "Germany"]} />
                <TextField label="Registration Number" name="registrationNumber" placeholder="EIN / CRN" />
                <TextField wide label="Tax ID (TIN / VAT)" name="taxId" placeholder="Tax Identification Number" />
              </div>
            </FormSection>
            <FormSection index="3" title="Entity Operations">
              <div className="gtt-field-grid">
                <CheckboxGroup label="Countries with Most Customers" name="customerCountries" options={["United States", "United Kingdom", "European Union", "Japan", "Singapore", "Brazil"]} />
                <CheckboxGroup label="Countries with Physical Presence" name="presenceCountries" options={["Same as Formation", "United States", "Singapore", "UAE (Dubai)", "Switzerland"]} />
              </div>
            </FormSection>
            <ActionRow backTo="/onboarding/step-1" error={error} navigate={navigate} primary="Save & Continue" saving={saving} />
          </div>
          <GuidancePanel />
        </form>
        <OnboardingFooter />
      </section>
    </main>
  );
}

function GuidancePanel() {
  return (
    <aside className="gtt-guidance-panel">
      <section>
        <div><Gavel size={20} /><h3>Regulatory Guidance</h3></div>
        <h4>Institutional Requirements</h4>
        <p>Institutional treasury accounts must provide verifiable registration data to satisfy Enhanced Due Diligence protocols.</p>
        <h4>Data Privacy</h4>
        <p>Documentation is encrypted and handled under the compliance standards in the master service agreement.</p>
        <a href="#"><HelpCircle size={16} /> Onboarding FAQ</a>
      </section>
      <section className="gtt-analytics-card">
        <Globe size={22} />
        <h4>Global Presence Analytics</h4>
        <p>Entity footprint is calculated from Section 3 operating jurisdictions.</p>
      </section>
    </aside>
  );
}

function BeneficialOwnershipStep({ continueStep, error, navigate, saving }: StepProps) {
  const [hasOwners, setHasOwners] = useState("yes");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    continueStep({ ...data, hasOwners });
  }

  return (
    <main className="gtt-onboarding-workspace">
      <OnboardingSidebar currentStep={3} />
      <section className="gtt-onboarding-main">
        <OnboardingTopBar currentStep={3} title="Onboarding: Beneficial Ownership" />
        <form className="gtt-onboarding-split" onSubmit={submit}>
          <div className="gtt-form-stack">
            <FormSection index="1" title="Declaration of Ownership">
              <div className="gtt-radio-card">
                <p>Does your business have any individual beneficial owners who own 25% or more of the equity?</p>
                <label><input checked={hasOwners === "yes"} name="hasOwners" onChange={() => setHasOwners("yes")} type="radio" value="yes" /> Yes, we have qualifying owners</label>
                <label><input checked={hasOwners === "no"} name="hasOwners" onChange={() => setHasOwners("no")} type="radio" value="no" /> No qualifying owners</label>
              </div>
            </FormSection>
            <div className={hasOwners === "no" ? "gtt-disabled-block" : ""}>
              <FormSection index="2" title="Beneficial Owner Details">
                <div className="gtt-owner-card">
                  <span>Primary Owner</span>
                  <div className="gtt-field-grid">
                    <TextField label="Legal Name (As Per Passport)" name="ownerName" placeholder="JORDAN LEE" />
                    <TextField label="Date of Birth" name="ownerDob" type="date" />
                    <SelectField label="Citizenship" name="ownerCitizenship" options={["United States", "United Kingdom", "Singapore", "European Union"]} />
                    <TextField label="Percent Ownership (%)" name="ownerPercent" placeholder="25" type="number" />
                    <TextField wide label="Residential Address" name="ownerAddress" placeholder="Street address, city, postal code" />
                  </div>
                </div>
                <button className="gtt-dashed-action" type="button"><Plus size={16} /> Add Another Beneficial Owner</button>
              </FormSection>
              <FormSection index="3" title="Ownership Structure">
                <div className="gtt-upload-card">
                  <UploadCloud size={38} strokeWidth={1.5} />
                  <strong>Upload Ownership Chart Document</strong>
                  <p>Required for ownership review. PDF, PNG, or JPG up to 10MB.</p>
                  <button type="button">Select Files</button>
                </div>
              </FormSection>
            </div>
            <ActionRow backTo="/onboarding/step-2" error={error} navigate={navigate} primary="Continue" saving={saving} />
          </div>
          <aside className="gtt-regulatory-panel">
            <ShieldCheck size={18} />
            <h3>Regulatory Notice</h3>
            <p>Global AML and CTF standards require identification and verification of all natural persons with significant equity or control.</p>
            <blockquote>
              Any individual who directly or indirectly owns 25% or more of the equity interests of a legal entity customer.
            </blockquote>
            <div><span>STEP 3</span><i><b /></i><span>75% COMPLETE</span></div>
          </aside>
        </form>
        <OnboardingFooter />
      </section>
    </main>
  );
}

function IntendedUseStep({ continueStep, error, navigate, saving }: StepProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    continueStep(data);
  }

  return (
    <main className="gtt-onboarding-workspace">
      <OnboardingSidebar currentStep={4} />
      <section className="gtt-onboarding-main">
        <OnboardingTopBar currentStep={4} title="Onboarding: Intended Use" />
        <form className="gtt-onboarding-split final" onSubmit={submit}>
          <div className="gtt-form-stack">
            <FormSection index="1" title="Account Purpose and Usage">
              <div className="gtt-purpose-grid">
                <PurposeOption defaultChecked icon={CreditCard} label="Payment Processing Platform" value="payments" />
                <PurposeOption icon={Building2} label="Treasury Management" value="treasury" />
                <PurposeOption icon={BarChart2} label="Institutional Trading" value="trading" />
              </div>
              <div className="gtt-field-grid">
                <SelectField label="Expected Monthly Fiat Activity (USD)" name="monthlyFiat" options={["0 to 100k", "100k to 1M", "1M to 10M", "10M+"]} />
                <SelectField label="Expected Monthly Crypto Activity (USDC)" name="monthlyCrypto" options={["0 to 100k", "100k to 1M", "1M to 10M", "10M+"]} />
              </div>
            </FormSection>
            <FormSection index="2" title="Source of Funds">
              <div className="gtt-choice-grid">
                {["Business Operating Funds", "Equity Capital", "Investor Funds", "Other Business Proceeds"].map((item, index) => (
                  <label key={item}><input defaultChecked={index === 0} name="sourceOrigin" type="radio" value={item} /> {item}</label>
                ))}
              </div>
              <TextArea label="Description of Fund Origin" name="fundOriginDescription" note="Include specific business activities or major funding events." placeholder="Provide details on revenue streams or funding rounds..." />
            </FormSection>
            <ActionRow backTo="/onboarding/step-3" error={error} navigate={navigate} primary="Submit Application" saving={saving} />
          </div>
          <aside className="gtt-regulatory-panel final">
            <ShieldCheck size={28} />
            <h3>Regulatory Context</h3>
            <p>Global Trade Treasury is required to understand intended account use, expected transaction volumes, and origin of funds before activating institutional rails.</p>
            <p><strong>Activity Profiling:</strong> Expected activity establishes a baseline that helps compliance systems flag transactions outside normal operations.</p>
            <div className="gtt-final-image">
              <img src={officeInhouse} alt="Institutional operations office" />
              <span>Status: Final Step</span>
              <strong>Securing your institutional footprint.</strong>
            </div>
          </aside>
        </form>
        <OnboardingFooter />
      </section>
    </main>
  );
}

function FormSection({ children, index, title }: { children: ReactNode; index: string; title: string }) {
  return <section className="gtt-form-section"><h2>{index}. {title}</h2>{children}</section>;
}

function TextField({ label, name, placeholder, type = "text", wide }: { label: string; name: string; placeholder?: string; type?: string; wide?: boolean }) {
  return <label className={wide ? "wide" : ""}><span>{label}</span><input name={name} placeholder={placeholder} type={type} /></label>;
}

function TextArea({ label, name, note, placeholder }: { label: string; name: string; note?: string; placeholder?: string }) {
  return <label className="wide"><span>{label}</span><textarea name={name} placeholder={placeholder} rows={4} />{note ? <small>{note}</small> : null}</label>;
}

function SelectField({ label, name, options }: { label: string; name: string; options: string[] }) {
  return <label><span>{label}</span><select name={name}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function CheckboxGroup({ label, name, options }: { label: string; name: string; options: string[] }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div>{options.map((option) => <label key={option}><input name={name} type="checkbox" value={option} /> {option}</label>)}</div>
    </fieldset>
  );
}

function PurposeOption({ defaultChecked, icon: Icon, label, value }: { defaultChecked?: boolean; icon: typeof CreditCard; label: string; value: string }) {
  return (
    <label>
      <input defaultChecked={defaultChecked} name="accountPurpose" type="radio" value={value} />
      <span><Icon size={30} strokeWidth={1.5} />{label}</span>
    </label>
  );
}

function SubmissionConfirmedScreen({ navigate, session }: { navigate: Navigate; session: Session | null }) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    apiRequest<MyOnboardingResponse>("/onboarding/me", { token })
      .then((result) => {
        if (active) setApplication(result.application);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  const submittedAt = formatSubmittedAt(application?.submittedAt ?? application?.updatedAt);

  return (
    <main className="gtt-submission-shell">
      <header className="gtt-submission-header">
        <div className="gtt-register-brand">Global Trade Treasury</div>
        <nav aria-label="Submission navigation">
          <a href="#">Markets</a>
          <a href="#">Insights</a>
          <a href="#">Regulatory</a>
        </nav>
        <div className="gtt-submission-icons">
          <Bell size={21} strokeWidth={1.8} />
          <Settings size={21} strokeWidth={1.8} />
        </div>
      </header>

      <section className="gtt-submission-main">
        <div className="gtt-submission-content">
          <section className="gtt-submission-hero">
            <span>Submission Received</span>
            <h1>Submission Confirmed.</h1>
            <p>
              Thank you for your institutional application. Your profile has been received and queued for compliance
              review by the Global Trade Treasury desk.
            </p>
          </section>

          <section className="gtt-review-pipeline">
            <h2>Receipt Pipeline</h2>
            <div className="gtt-pipeline-list">
              <PipelineStep complete meta={`Received ${submittedAt}`} title="Submission Complete" />
              <PipelineStep active meta="Queued for Compliance Desk" title="Institutional Review" />
              <PipelineStep meta="Available after operator decision" title="Final Approval" />
            </div>
          </section>

          <section className="gtt-expectations">
            <div className="gtt-expectations-title">
              <Info size={22} strokeWidth={1.8} />
              <h2>What to expect</h2>
            </div>
            <div className="gtt-expectations-grid">
              <div>
                <span>Timeline</span>
                <p>Standard institutional reviews are typically finalized within 24-48 business hours.</p>
              </div>
              <div>
                <span>Communication</span>
                <p>A Relationship Manager may reach out if supplementary records are required.</p>
              </div>
            </div>
          </section>

          <div className="gtt-submission-actions">
            <button onClick={() => navigate("/application-pending")} type="button">View Application Status</button>
            <button type="button">
              <Download size={22} strokeWidth={2} />
              Documentation Receipt (PDF)
            </button>
          </div>
        </div>

        <aside className="gtt-submission-visual">
          <img src={officeInhouse} alt="Institutional lobby" />
          <div className="gtt-system-log">
            <p>SYSTEM_LOG // STATUS: SUBMISSION_CONFIRMED</p>
            <p>APP_ID: {application?.id ? application.id.slice(-12).toUpperCase() : "PENDING"}</p>
            <p>RECEIVED: {submittedAt}</p>
            <p>GATEWAY: LONDON_TREASURY_HUB</p>
          </div>
        </aside>
      </section>

      <footer className="gtt-submission-footer">
        <div>
          <strong>GTT</strong>
          <span>2026 Global Trade Treasury. All rights reserved. Member SIPC.</span>
        </div>
        <nav aria-label="Submission policies">
          <a href="#">Terms</a>
          <a href="#">Privacy</a>
          <a href="#">Compliance</a>
          <a href="#">API Documentation</a>
        </nav>
      </footer>
    </main>
  );
}

function PipelineStep({ active, complete, meta, title }: { active?: boolean; complete?: boolean; meta: string; title: string }) {
  return (
    <div className={`gtt-pipeline-step ${active ? "active" : ""} ${complete ? "complete" : ""}`}>
      <div>{complete ? <Check size={17} strokeWidth={2.1} /> : active ? <span /> : <HourglassIcon />}</div>
      <section>
        <h3>{title}</h3>
        <p>{meta}</p>
      </section>
    </div>
  );
}

function HourglassIcon() {
  return (
    <svg aria-hidden="true" height="17" viewBox="0 0 24 24" width="17">
      <path d="M7 3h10M7 21h10M8 3c0 5 4 6 4 9s-4 4-4 9M16 3c0 5-4 6-4 9s4 4 4 9" fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="1.8" />
    </svg>
  );
}

function PendingReviewScreen({ navigate, session }: { navigate: Navigate; session: Session | null }) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    setLoading(true);
    apiRequest<MyOnboardingResponse>("/onboarding/me", { token })
      .then((result) => {
        if (!active) return;
        setApplication(result.application);
        setError(undefined);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Unable to retrieve application status.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  const status = application?.status ?? "pending_review";
  const meta = pendingStatusMeta(status);
  const submittedAt = formatSubmittedAt(application?.submittedAt ?? application?.updatedAt);
  const terminalId = application?.id ? `8842-${application.id.slice(-6).toUpperCase()}` : "8842-X-PENDING";

  return (
    <div className="gtt-pending-shell">
      <aside className="gtt-pending-sidebar">
        <div className="gtt-pending-brand">
          <div>GTT</div>
          <span>USDC Treasury</span>
        </div>
        <nav className="gtt-pending-nav" aria-label="Pending treasury navigation">
          <span>Operational Hub</span>
          <a className="active" href="#"><Building2 size={20} /> Accounts</a>
          <a aria-disabled="true" href="#"><Gavel size={20} /> Trade Ledgers</a>
          <a aria-disabled="true" href="#"><ArrowRight size={20} /> Netting</a>
          <a aria-disabled="true" href="#"><CreditCard size={20} /> Treasury</a>
          <a aria-disabled="true" href="#"><BarChart2 size={20} /> Analytics</a>
        </nav>
        <div className="gtt-pending-identity">
          <div className="gtt-pending-avatar"><User size={15} /></div>
          <div>
            <strong>Terminal ID</strong>
            <span>{terminalId}</span>
          </div>
        </div>
      </aside>

      <main className="gtt-pending-main">
        <header className="gtt-pending-topbar">
          <div>
            <h1>Global Trade Treasury</h1>
            <nav aria-label="Pending review links">
              <a href="#">Markets</a>
              <a href="#">Insights</a>
              <a href="#">Regulatory</a>
            </nav>
          </div>
          <div className="gtt-pending-tools">
            <label>
              <Search size={15} />
              <input placeholder="Search Terminal..." type="search" />
            </label>
            <Bell size={21} />
            <Settings size={21} />
          </div>
        </header>

        <section className="gtt-pending-content">
          <section className="gtt-pending-hero">
            <div>
              <div className="gtt-pending-status-badge">
                <Info size={14} />
                Application Status: {meta.label}
              </div>
              <h2>Welcome to your Treasury Terminal.</h2>
              <p>{meta.copy}</p>
              {error ? <div className="form-error">{error}</div> : null}
            </div>
            <div className="gtt-pending-activation">
              <span>Expected Activation</span>
              <strong>{meta.activation}</strong>
            </div>
          </section>

          <div className="gtt-pending-grid">
            <div className="gtt-pending-left-column">
              <section className="gtt-pending-card">
                <h3>Submission Summary</h3>
                <div className="gtt-pending-summary-list">
                  <PendingSummaryRow complete title="Business Profile" copy="Tax ID, incorporation records, and address verification" status="Complete" />
                  <PendingSummaryRow complete title="Beneficial Ownership" copy="KYB disclosures for 25%+ shareholders and controlling parties" status="Complete" />
                  <PendingSummaryRow complete title="Intended Use Case" copy="Liquidity management and cross-border settlement profile" status="Complete" />
                  <PendingSummaryRow active={status === "pending_review"} complete={status === "approved"} title="Compliance Review" copy={meta.reviewCopy} status={meta.reviewStatus} />
                </div>
              </section>

              <section className="gtt-pending-prep">
                <h3>Preparation Checklist</h3>
                <p>While review is in progress, prepare local controls for terminal integration and treasury operations.</p>
                <div>
                  <article>
                    <div><KeyRound size={20} /><Lock size={18} /></div>
                    <strong>API Key Generation</strong>
                    <p>Generate secure keys for programmatic settlement once approved.</p>
                  </article>
                  <article>
                    <div><Users size={20} /><Lock size={18} /></div>
                    <strong>Team Permissions</strong>
                    <p>Draft roles for treasury officers and internal auditors.</p>
                  </article>
                </div>
              </section>
            </div>

            <div className="gtt-pending-right-column">
              <section className="gtt-pending-timeline">
                <h3>Institutional Timeline</h3>
                <TimelineItem index="01" title="Profile Queued" copy={loading ? "Retrieving submission timestamp" : `Completed: ${submittedAt}`} />
                <TimelineItem active={status === "pending_review"} index="02" title="Risk Assessment" copy={meta.timelineCopy} />
                <TimelineItem muted={status !== "approved"} index="03" title="Final Attestation" copy={status === "approved" ? "Signature by Compliance Lead completed." : "Signature by Compliance Lead pending."} />
              </section>

              <section className="gtt-pending-docs">
                <div>
                  <h3>Documentation</h3>
                  <ArrowRight size={20} />
                </div>
                <a href="#">
                  <strong>Treasury Operations Manual</strong>
                  <span>PDF - 4.2 MB</span>
                </a>
                <a href="#">
                  <strong>Compliance & Regulatory Framework</strong>
                  <span>PDF - 1.8 MB</span>
                </a>
              </section>

              <section className="gtt-pending-help">
                <div><Headphones size={20} /><strong>Concierge Support</strong></div>
                <p>Need to expedite your review or add documents? Your dedicated relationship manager is available for secure chat.</p>
                <button type="button">Connect with Support</button>
              </section>
            </div>
          </div>

          <section className="gtt-pending-standard">
            <div>
              <span>The GTT Standard</span>
              <h3>Bilateral Settlement Integrity.</h3>
              <p>Every participant in Global Trade Treasury undergoes verification to support settlement finality and counterparty reliability across operating jurisdictions.</p>
            </div>
            <img src={applicationPendingGraphic} alt="Fictional application review schematic" />
          </section>

          {application && application.status !== "pending_review" && application.currentStep !== "pending_review" ? (
            <button className="gtt-pending-resume" onClick={() => navigate(routeForApplication(application))} type="button">
              Resume Application
              <ArrowRight size={17} />
            </button>
          ) : null}
        </section>

        <footer className="gtt-pending-footer">
          <strong>GTT</strong>
          <div>
            <nav aria-label="Pending review policies">
              <a href="#">Terms</a>
              <a href="#">Privacy</a>
              <a href="#">Compliance</a>
              <a href="#">API Documentation</a>
            </nav>
            <p>2026 Global Trade Treasury. All rights reserved. Member SIPC.</p>
          </div>
        </footer>
      </main>
    </div>
  );
}

function PendingSummaryRow({ active, complete, copy, status, title }: { active?: boolean; complete?: boolean; copy: string; status: string; title: string }) {
  return (
    <div className={`gtt-pending-summary-row ${active ? "active" : ""}`}>
      <div>{complete ? <Check size={15} /> : active ? <span /> : <Lock size={15} />}</div>
      <section>
        <strong>{title}</strong>
        <p>{copy}</p>
      </section>
      <span>{status}</span>
    </div>
  );
}

function TimelineItem({ active, copy, index, muted, title }: { active?: boolean; copy: string; index: string; muted?: boolean; title: string }) {
  return (
    <div className={`gtt-pending-timeline-item ${active ? "active" : ""} ${muted ? "muted" : ""}`}>
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </div>
  );
}

function WelcomeLandingScreen({ navigate, session }: { navigate: Navigate; session: Session | null }) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    apiRequest<MyOnboardingResponse>("/onboarding/me", { token })
      .then((result) => {
        if (!active) return;
        if (result.application.status !== "approved") {
          navigate(routeForApplication(result.application));
          return;
        }
        setApplication(result.application);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate, session?.access_token]);

  const email = application?.email ?? session?.user.email ?? "approved-user@gtt.example";
  const terminalId = application?.id ? `8842-${application.id.slice(-6).toUpperCase()}` : "8842-X";

  async function logout() {
    setProfileMenuOpen(false);
    await supabase?.auth.signOut();
    navigate("/sign-in");
  }

  return (
    <div className="gtt-welcome-shell">
      <aside className="gtt-welcome-sidebar">
        <div className="gtt-welcome-brand">
          <h1>GTT Treasure</h1>
          <p>Terminal ID: {terminalId}</p>
        </div>
        <nav className="gtt-welcome-nav" aria-label="Treasury dashboard navigation">
          <a className="active" href="#"><Building2 size={20} /> Accounts</a>
          <a href="#"><Gavel size={20} /> Trade Ledgers</a>
          <a href="#"><ArrowRight size={20} /> Netting</a>
          <a href="#"><Wallet size={20} /> Treasury</a>
          <a href="#"><BarChart2 size={20} /> Analytics</a>
        </nav>
        <div className="gtt-welcome-profile">
          <button type="button"><Plus size={16} /> New Transaction</button>
          <div className="gtt-welcome-profile-menu">
            <button
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="gtt-welcome-avatar"
              onClick={() => setProfileMenuOpen((open) => !open)}
              type="button"
            >
              <User size={18} />
            </button>
            <section>
              <strong>{email.split("@")[0]}</strong>
              <span>Chief Treasurer</span>
            </section>
            {profileMenuOpen ? (
              <div className="gtt-welcome-avatar-menu" role="menu">
                <button onClick={logout} role="menuitem" type="button">Logout</button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="gtt-welcome-main">
        <header className="gtt-welcome-topbar">
          <div>
            <strong>GTT</strong>
            <nav aria-label="Welcome links">
              <a className="active" href="#">Markets</a>
              <a href="#">Insights</a>
              <a href="#">Regulatory</a>
            </nav>
          </div>
          <div className="gtt-welcome-tools">
            <label>
              <Search size={15} />
              <input placeholder="Search Ledgers..." type="search" />
            </label>
            <Bell size={21} />
            <Settings size={21} />
          </div>
        </header>

        <section className="gtt-welcome-content">
          <section className="gtt-welcome-masthead">
            <span>Dashboard / Overview</span>
            <h2>Welcome back, President.</h2>
            <i />
          </section>

          <section className="gtt-welcome-summary">
            <WelcomeMetric title="Total Treasury Balance" value="1,240,500.00" unit="USDC" meta="+2.4% vs Last Period" icon={TrendingUp} />
            <WelcomeMetric title="Pending Netting" value="45,200.00" unit="USDC" meta="Settlement in 4h 12m" icon={Clock} />
            <WelcomeMetric title="Active Accounts" value="04" unit="Entities" meta="All systems operational" icon={CheckCircle2} />
          </section>

          <section className="gtt-welcome-grid">
            <div className="gtt-welcome-left">
              <div className="gtt-welcome-section-heading">
                <h3>Digital Asset Accounts</h3>
                <a href="#">View Ledger Report</a>
              </div>
              <div className="gtt-welcome-table-wrap">
                <table className="gtt-welcome-table">
                  <thead>
                    <tr>
                      <th>Account Name</th>
                      <th>Status</th>
                      <th>Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <AccountRow balance="840,000.00 USDC" code="0x71C...49A1" name="Operating Account" />
                    <AccountRow balance="315,200.00 USDC" code="0x3A2...9B3C" name="Payout Account" />
                    <AccountRow balance="85,300.00 USDC" code="0xEE4...82D1" name="Tax Reserve" />
                  </tbody>
                </table>
              </div>

              <div className="gtt-welcome-activity">
                <div className="gtt-welcome-section-heading">
                  <h3>Recent Activity</h3>
                  <button type="button">Filter</button>
                </div>
                <ActivityItem active icon={ShieldCheck} title="Onboarding Completed" copy="Your institutional profile has been approved by the compliance board. Full treasury access granted." meta="2 Hours Ago" />
                <ActivityItem icon={Download} title="Deposit Initiated" copy="Transfer of 12,500.00 USDC to Operating Account is currently processing." meta="Yesterday, 14:32" />
              </div>
            </div>

            <aside className="gtt-welcome-right">
              <section className="gtt-welcome-actions">
                <h4>Quick Actions</h4>
                <button className="primary" type="button"><span>New Transaction</span><ArrowRight size={18} /></button>
                <button type="button"><span>Link Bank Account</span><Building2 size={18} /></button>
                <button type="button"><span>Generate Statement</span><FileText size={18} /></button>
              </section>

              <section className="gtt-welcome-trust">
                <h4>Institutional Trust</h4>
                <div>
                  <CheckCircle2 size={34} />
                  <section>
                    <strong>Status: Approved</strong>
                    <span>KYC/AML Review: 100%</span>
                  </section>
                </div>
                <p>Compliance profile re-evaluates every 365 days. Next review is scheduled by the operator desk.</p>
              </section>

              <section className="gtt-welcome-outlook">
                <h4>Market Outlook</h4>
                <p>Regulatory frameworks are shifting toward unified digital asset standards. Align netting protocols with current treasury directives.</p>
                <a href="#">Read Whitepaper</a>
              </section>
            </aside>
          </section>
        </section>

        <footer className="gtt-welcome-footer">
          <div>
            <strong>Global Trade Treasury</strong>
            <p>2026 Global Trade Treasury. All rights reserved. Member SIPC.</p>
          </div>
          <nav aria-label="Welcome policies">
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
            <a href="#">Compliance</a>
            <a href="#">API Documentation</a>
          </nav>
        </footer>
      </main>
    </div>
  );
}

function WelcomeMetric({ icon: Icon, meta, title, unit, value }: { icon: typeof TrendingUp; meta: string; title: string; unit: string; value: string }) {
  return (
    <article className="gtt-welcome-metric">
      <span>{title}</span>
      <div>
        <strong>{value} <em>{unit}</em></strong>
        <p><Icon size={15} /> {meta}</p>
      </div>
    </article>
  );
}

function AccountRow({ balance, code, name }: { balance: string; code: string; name: string }) {
  return (
    <tr>
      <td><strong>{name}</strong><span>{code}</span></td>
      <td><mark>Active</mark></td>
      <td>{balance}</td>
      <td><button type="button">Deposit</button><button type="button">Withdraw</button></td>
    </tr>
  );
}

function ActivityItem({ active, copy, icon: Icon, meta, title }: { active?: boolean; copy: string; icon: typeof ShieldCheck; meta: string; title: string }) {
  return (
    <article className={`gtt-welcome-activity-item ${active ? "active" : ""}`}>
      <div><Icon size={20} /></div>
      <section>
        <strong>{title}</strong>
        <p>{copy}</p>
        <span>{meta}</span>
      </section>
    </article>
  );
}

async function nextOnboardingRoute(token: string): Promise<string> {
  const result = await apiRequest<MyOnboardingResponse>("/onboarding/me", { token });
  return routeForApplication(result.application);
}

function routeForApplication(application: OnboardingApplication): string {
  if (application.status === "approved") return "/welcome";
  if (application.status === "rejected") return "/application-pending";
  if (application.status === "pending_review" || application.currentStep === "pending_review") return "/application-pending";
  const step = application.currentStep.match(/^step_(\d)$/)?.[1] ?? "1";
  return `/onboarding/step-${step}`;
}

function pendingStatusMeta(status: OnboardingStatus): {
  activation: string;
  copy: string;
  label: string;
  reviewCopy: string;
  reviewStatus: string;
  timelineCopy: string;
} {
  if (status === "approved") {
    return {
      activation: "Enabled",
      copy: "Your institutional application has received final approval. Treasury access can proceed under the configured operating controls.",
      label: "Approved",
      reviewCopy: "Final institutional verification completed",
      reviewStatus: "Approved",
      timelineCopy: "Compliance risk assessment has been completed."
    };
  }
  if (status === "rejected") {
    return {
      activation: "Action Required",
      copy: "Your application requires remediation before treasury access can be enabled. Contact support for next steps.",
      label: "Action Required",
      reviewCopy: "Application requires operator follow-up",
      reviewStatus: "Review Required",
      timelineCopy: "Compliance desk requires additional resolution."
    };
  }
  if (status === "submitted") {
    return {
      activation: "24-48 Hours",
      copy: "Your submission has been received and is being queued for institutional compliance review.",
      label: "Submitted",
      reviewCopy: "Manual institutional verification queued",
      reviewStatus: "Queued",
      timelineCopy: "Compliance queue assignment is pending."
    };
  }
  if (status === "draft") {
    return {
      activation: "Not Submitted",
      copy: "Your onboarding draft is still open. Complete the remaining steps to start institutional verification.",
      label: "Draft",
      reviewCopy: "Submission has not entered review",
      reviewStatus: "Draft",
      timelineCopy: "Risk assessment starts after final submission."
    };
  }
  return {
    activation: "24-48 Hours",
    copy: "We are currently verifying your business profile and compliance credentials. This institutional-grade vetting ensures the integrity of the USDC liquidity pool.",
    label: "In Review",
    reviewCopy: "Manual institutional verification in progress",
    reviewStatus: "In Review",
    timelineCopy: "Current phase: analyzing jurisdictional risk profile and ownership structure."
  };
}

function formatSubmittedAt(value?: string): string {
  if (!value) return "Timestamp pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZoneName: "short",
    year: "numeric"
  }).format(date);
}

async function apiRequest<T = unknown>(
  path: string,
  options: { body?: unknown; method?: "GET" | "POST" | "PATCH"; token?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const response = await fetch(apiUrl(path), {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed with status ${response.status}`);
  }
  return body as T;
}

function apiUrl(path: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}
