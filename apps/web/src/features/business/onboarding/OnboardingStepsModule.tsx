import { type Session } from "@supabase/supabase-js";
import {
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Building2,
  CheckCircle2,
  CreditCard,
  Gavel,
  Globe,
  HelpCircle,
  Info,
  KeyRound,
  Loader2,
  Lock,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  UploadCloud
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import officeInhouse from "../../../assets/office-inhouse.jpg";
import { type MyOnboardingResponse, type OnboardingApplication, type OnboardingDraftPayload, type OnboardingStepKey } from "./types.js";
import { draftArray, draftString, formToPayload, loadOnboardingDraft, saveOnboardingDraft } from "./draftUtils.js";
import { apiRequest } from "../shared/apiClient.js";
import { BusinessAvatarMenu } from "../shared/BusinessAvatarMenu.js";

type Navigate = (path: string) => void;

type StepProps = {
  continueStep: (payload?: Record<string, unknown>) => void;
  error?: string;
  navigate: Navigate;
  onLogout: () => void;
  saving: boolean;
  userEmail?: string;
};

type OnboardingStepsModuleProps = {
  path: string;
  navigate: Navigate;
  session: Session | null;
  onLogout: () => void;
  routeForApplication: (application: OnboardingApplication) => string;
  onboardingStepNumber: (step: OnboardingStepKey) => number;
};

const stepLabels = ["Business Identity", "Business Profile", "Beneficial Ownership", "Intended Use"];

export function OnboardingStepsModule({
  path,
  navigate,
  onLogout,
  onboardingStepNumber,
  routeForApplication,
  session
}: OnboardingStepsModuleProps) {
  const step = useMemo(() => path.split("/").at(-1) ?? "step-1", [path]);
  const stepNumber = Number(step.replace("step-", ""));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    apiRequest<MyOnboardingResponse>("/onboarding/me", { token })
      .then((result) => {
        if (!active) return;
        const route = routeForApplication(result.application);
        const requestedStep = Number.isFinite(stepNumber) ? stepNumber : 1;
        const latestAllowedStep = onboardingStepNumber(result.application.currentStep);
        if (route === "/application-pending" || route === "/welcome") {
          navigate(route);
          return;
        }
        if (requestedStep > latestAllowedStep) {
          navigate(route);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [navigate, onboardingStepNumber, routeForApplication, session?.access_token, stepNumber]);

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
      const nextStepNumber = stepNumber + 1;
      await apiRequest(`/onboarding/me/steps/step_${nextStepNumber}`, {
        method: "PATCH",
        token,
        body: {
          payload: {
            ...payload,
            completedStepKey: `step_${stepNumber}`,
            completedFrom: step,
            nextStep: `step_${nextStepNumber}`,
            savedAt: new Date().toISOString()
          }
        }
      });
      navigate(`/onboarding/step-${nextStepNumber}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save onboarding step.");
    } finally {
      setSaving(false);
    }
  }

  const props = { error, navigate, saving, continueStep, onLogout, userEmail: session?.user.email };
  if (stepNumber === 2) return <BusinessProfileStep {...props} />;
  if (stepNumber === 3) return <BeneficialOwnershipStep {...props} />;
  if (stepNumber === 4) return <IntendedUseStep {...props} />;
  return <OnboardingIntroStep {...props} />;
}

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

function OnboardingTopBar({ currentStep, onLogout, title, userEmail }: { currentStep: number; onLogout: () => void; title: string; userEmail?: string }) {
  return (
    <header className="gtt-onboarding-topbar">
      <div>
        <span>Step {currentStep} of 4</span>
        <h1>{title}</h1>
      </div>
      <div className="gtt-onboarding-topbar-actions">
        <div className="gtt-step-progress" aria-label={`Step ${currentStep} of 4`}>
          {[1, 2, 3, 4].map((item) => <i className={item <= currentStep ? "active" : ""} key={item} />)}
        </div>
        <BusinessAvatarMenu email={userEmail} onLogout={onLogout} />
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

function OnboardingIntroStep({ continueStep, error, onLogout, saving, userEmail }: StepProps) {
  return (
    <main className="gtt-onboarding-intro">
      <header className="gtt-register-header">
        <div className="gtt-register-brand">Global Trade Treasury</div>
        <div className="gtt-business-header-actions">
          <span>Partner Onboarding</span>
          <BusinessAvatarMenu email={userEmail} onLogout={onLogout} />
        </div>
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

function BusinessProfileStep({ continueStep, error, navigate, onLogout, saving, userEmail }: StepProps) {
  const draft = loadOnboardingDraft("step_2");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = formToPayload(event.currentTarget);
    saveOnboardingDraft("step_2", data);
    continueStep(data);
  }

  return (
    <main className="gtt-onboarding-workspace">
      <OnboardingSidebar currentStep={2} />
      <section className="gtt-onboarding-main">
        <OnboardingTopBar currentStep={2} onLogout={onLogout} title="Onboarding: Business Profile" userEmail={userEmail} />
        <form className="gtt-onboarding-layout" onChange={(event) => saveOnboardingDraft("step_2", formToPayload(event.currentTarget))} onSubmit={submit}>
          <div className="gtt-form-stack">
            <FormSection index="1" title="Basic Business Info">
              <TextField defaultValue={draftString(draft, "businessWebsite")} label="Business Website" name="businessWebsite" placeholder="https://www.yourcompany.com" type="url" />
              <TextArea defaultValue={draftString(draft, "businessModel")} label="Business Model Description" name="businessModel" note="Provide a concise overview of commercial operations." placeholder="Digital payments platform specializing in cross-border trade settlements..." />
              <TextArea defaultValue={draftString(draft, "productsServices")} label="Products/Services Description" name="productsServices" placeholder="Describe specific financial or commercial products offered..." />
            </FormSection>
            <FormSection index="2" title="Business Registration">
              <div className="gtt-field-grid">
                <TextField defaultValue={draftString(draft, "legalBusinessName")} wide label="Legal Business Name" name="legalBusinessName" placeholder="Full Legal Entity Name" />
                <SelectField defaultValue={draftString(draft, "formationCountry")} label="Country of Formation" name="formationCountry" options={["Select Jurisdiction", "United States", "United Kingdom", "Singapore", "Germany"]} />
                <TextField defaultValue={draftString(draft, "registrationNumber")} label="Registration Number" name="registrationNumber" placeholder="EIN / CRN" />
                <TextField defaultValue={draftString(draft, "taxId")} wide label="Tax ID (TIN / VAT)" name="taxId" placeholder="Tax Identification Number" />
              </div>
            </FormSection>
            <FormSection index="3" title="Entity Operations">
              <div className="gtt-field-grid">
                <CheckboxGroup defaultValues={draftArray(draft, "customerCountries")} label="Countries with Most Customers" name="customerCountries" options={["United States", "United Kingdom", "European Union", "Japan", "Singapore", "Brazil"]} />
                <CheckboxGroup defaultValues={draftArray(draft, "presenceCountries")} label="Countries with Physical Presence" name="presenceCountries" options={["Same as Formation", "United States", "Singapore", "UAE (Dubai)", "Switzerland"]} />
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

function BeneficialOwnershipStep({ continueStep, error, navigate, onLogout, saving, userEmail }: StepProps) {
  const draft = loadOnboardingDraft("step_3");
  const [hasOwners, setHasOwners] = useState(draftString(draft, "hasOwners", "yes"));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = formToPayload(event.currentTarget);
    saveOnboardingDraft("step_3", { ...data, hasOwners });
    continueStep({ ...data, hasOwners });
  }

  return (
    <main className="gtt-onboarding-workspace">
      <OnboardingSidebar currentStep={3} />
      <section className="gtt-onboarding-main">
        <OnboardingTopBar currentStep={3} onLogout={onLogout} title="Onboarding: Beneficial Ownership" userEmail={userEmail} />
        <form className="gtt-onboarding-split" onChange={(event) => saveOnboardingDraft("step_3", { ...formToPayload(event.currentTarget), hasOwners })} onSubmit={submit}>
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
                    <TextField defaultValue={draftString(draft, "ownerName")} label="Legal Name (As Per Passport)" name="ownerName" placeholder="JORDAN LEE" />
                    <TextField defaultValue={draftString(draft, "ownerDob")} label="Date of Birth" name="ownerDob" type="date" />
                    <SelectField defaultValue={draftString(draft, "ownerCitizenship")} label="Citizenship" name="ownerCitizenship" options={["United States", "United Kingdom", "Singapore", "European Union"]} />
                    <TextField defaultValue={draftString(draft, "ownerPercent")} label="Percent Ownership (%)" name="ownerPercent" placeholder="25" type="number" />
                    <TextField defaultValue={draftString(draft, "ownerAddress")} wide label="Residential Address" name="ownerAddress" placeholder="Street address, city, postal code" />
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

function IntendedUseStep({ continueStep, error, navigate, onLogout, saving, userEmail }: StepProps) {
  const draft = loadOnboardingDraft("step_4");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = formToPayload(event.currentTarget);
    saveOnboardingDraft("step_4", data);
    continueStep(data);
  }

  return (
    <main className="gtt-onboarding-workspace">
      <OnboardingSidebar currentStep={4} />
      <section className="gtt-onboarding-main">
        <OnboardingTopBar currentStep={4} onLogout={onLogout} title="Onboarding: Intended Use" userEmail={userEmail} />
        <form className="gtt-onboarding-split final" onChange={(event) => saveOnboardingDraft("step_4", formToPayload(event.currentTarget))} onSubmit={submit}>
          <div className="gtt-form-stack">
            <FormSection index="1" title="Account Purpose and Usage">
              <div className="gtt-purpose-grid">
                <PurposeOption defaultChecked={!draftString(draft, "accountPurpose") || draftString(draft, "accountPurpose") === "payments"} icon={CreditCard} label="Payment Processing Platform" value="payments" />
                <PurposeOption defaultChecked={draftString(draft, "accountPurpose") === "treasury"} icon={Building2} label="Treasury Management" value="treasury" />
                <PurposeOption defaultChecked={draftString(draft, "accountPurpose") === "trading"} icon={BarChart2} label="Institutional Trading" value="trading" />
              </div>
              <div className="gtt-field-grid">
                <SelectField defaultValue={draftString(draft, "monthlyFiat")} label="Expected Monthly Fiat Activity (USD)" name="monthlyFiat" options={["0 to 100k", "100k to 1M", "1M to 10M", "10M+"]} />
                <SelectField defaultValue={draftString(draft, "monthlyCrypto")} label="Expected Monthly Crypto Activity (USDC)" name="monthlyCrypto" options={["0 to 100k", "100k to 1M", "1M to 10M", "10M+"]} />
              </div>
            </FormSection>
            <FormSection index="2" title="Source of Funds">
              <div className="gtt-choice-grid">
                {["Business Operating Funds", "Equity Capital", "Investor Funds", "Other Business Proceeds"].map((item, index) => (
                  <label key={item}><input defaultChecked={draftString(draft, "sourceOrigin") ? draftString(draft, "sourceOrigin") === item : index === 0} name="sourceOrigin" type="radio" value={item} /> {item}</label>
                ))}
              </div>
              <TextArea defaultValue={draftString(draft, "fundOriginDescription")} label="Description of Fund Origin" name="fundOriginDescription" note="Include specific business activities or major funding events." placeholder="Provide details on revenue streams or funding rounds..." />
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

function TextField({ defaultValue, label, name, placeholder, type = "text", wide }: { defaultValue?: string; label: string; name: string; placeholder?: string; type?: string; wide?: boolean }) {
  return <label className={wide ? "wide" : ""}><span>{label}</span><input defaultValue={defaultValue} name={name} placeholder={placeholder} type={type} /></label>;
}

function TextArea({ defaultValue, label, name, note, placeholder }: { defaultValue?: string; label: string; name: string; note?: string; placeholder?: string }) {
  return <label className="wide"><span>{label}</span><textarea defaultValue={defaultValue} name={name} placeholder={placeholder} rows={4} />{note ? <small>{note}</small> : null}</label>;
}

function SelectField({ defaultValue, label, name, options }: { defaultValue?: string; label: string; name: string; options: string[] }) {
  return <label><span>{label}</span><select defaultValue={defaultValue} name={name}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function CheckboxGroup({ defaultValues = [], label, name, options }: { defaultValues?: string[]; label: string; name: string; options: string[] }) {
  return (
    <fieldset>
      <legend>{label}</legend>
      <div>{options.map((option) => <label key={option}><input defaultChecked={defaultValues.includes(option)} name={name} type="checkbox" value={option} /> {option}</label>)}</div>
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

