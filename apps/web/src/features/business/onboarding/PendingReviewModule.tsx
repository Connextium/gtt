import type { Session } from "@supabase/supabase-js";
import { AlertCircle, ArrowLeft, ArrowRight, Bell, Building2, Check, CreditCard, FileText, Gavel, Headphones, Info, KeyRound, Lock, Search, Settings, Shield, UploadCloud, Users } from "lucide-react";
import { useEffect, useState } from "react";
import applicationPendingGraphic from "../../../assets/application-pending-graphic.svg";
import rfiScreenA from "../../../assets/rfi-screen-a.png";
import { BusinessAvatarMenu } from "../shared/BusinessAvatarMenu.js";
import { apiRequest } from "../shared/apiClient.js";
import type { MyOnboardingResponse, OnboardingApplication, OnboardingRfiTask, OnboardingStatus } from "./types.js";

export function PendingReviewModule({
  navigate,
  onLogout,
  routeForApplication,
  session
}: {
  navigate: (path: string) => void;
  onLogout: () => Promise<void> | void;
  routeForApplication: (application: OnboardingApplication) => string;
  session: Session | null;
}) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [rfiTasks, setRfiTasks] = useState<OnboardingRfiTask[]>([]);
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
        setRfiTasks(result.rfiTasks ?? []);
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
          <a aria-disabled="true" href="#"><FileText size={20} /> Analytics</a>
        </nav>
        <div className="gtt-pending-identity">
          <BusinessAvatarMenu direction="up" email={application?.email ?? session?.user.email} onLogout={() => void onLogout()} />
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
                  <PendingSummaryRow complete copy="Tax ID, incorporation records, and address verification" status="Complete" title="Business Profile" />
                  <PendingSummaryRow complete copy="KYB disclosures for 25%+ shareholders and controlling parties" status="Complete" title="Beneficial Ownership" />
                  <PendingSummaryRow complete copy="Liquidity management and cross-border settlement profile" status="Complete" title="Intended Use Case" />
                  <PendingSummaryRow active={status === "pending_review"} complete={status === "approved"} copy={meta.reviewCopy} status={meta.reviewStatus} title="Compliance Review" />
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

              {status === "needs_information" ? (
                <ClientRfiStatusCard onOpen={() => navigate("/rfi-response")} rfiTasks={rfiTasks} />
              ) : null}
            </div>

            <div className="gtt-pending-right-column">
              <section className="gtt-pending-timeline">
                <h3>Institutional Timeline</h3>
                <TimelineItem copy={loading ? "Retrieving submission timestamp" : `Completed: ${submittedAt}`} index="01" title="Profile Queued" />
                <TimelineItem active={status === "pending_review"} copy={meta.timelineCopy} index="02" title="Risk Assessment" />
                <TimelineItem copy={status === "approved" ? "Signature by Compliance Lead completed." : "Signature by Compliance Lead pending."} index="03" muted={status !== "approved"} title="Final Attestation" />
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
      </main>
    </div>
  );
}

export function RfiResponseModule({
  navigate,
  onLogout,
  session
}: {
  navigate: (path: string) => void;
  onLogout: () => Promise<void> | void;
  session: Session | null;
}) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [rfiTasks, setRfiTasks] = useState<OnboardingRfiTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [rfiResponse, setRfiResponse] = useState("");
  const [rfiDocumentType, setRfiDocumentType] = useState("Certificate of Incorporation");
  const [rfiSubmitting, setRfiSubmitting] = useState(false);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let active = true;
    setLoading(true);
    apiRequest<MyOnboardingResponse>("/onboarding/me", { token })
      .then((result) => {
        if (!active) return;
        setApplication(result.application);
        setRfiTasks(result.rfiTasks ?? []);
        setError(undefined);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "Unable to retrieve RFI request.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.access_token]);

  async function submitRfiResponse() {
    const token = session?.access_token;
    if (!token || !rfiResponse.trim()) return;
    setRfiSubmitting(true);
    setError(undefined);
    try {
      const result = await apiRequest<MyOnboardingResponse>("/onboarding/me/rfi-response", {
        method: "POST",
        token,
        body: { documentType: rfiDocumentType, response: rfiResponse.trim(), submittedAt: new Date().toISOString() }
      });
      setApplication(result.application);
      setRfiTasks(result.rfiTasks ?? []);
      setRfiResponse("");
      navigate("/application-pending");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to submit requested information.");
    } finally {
      setRfiSubmitting(false);
    }
  }

  const terminalId = application?.id ? `8842-${application.id.slice(-6).toUpperCase()}` : "8842-X-RFI";

  return (
    <div className="gtt-pending-shell gtt-rfi-response-page">
      <aside className="gtt-pending-sidebar">
        <div className="gtt-pending-brand">
          <div>GTT</div>
          <span>USDC Treasury</span>
        </div>
        <nav className="gtt-pending-nav" aria-label="RFI response navigation">
          <span>Operational Hub</span>
          <a className="active" href="#"><FileText size={20} /> RFI Workspace</a>
          <a aria-disabled="true" href="#"><Building2 size={20} /> Accounts</a>
          <a aria-disabled="true" href="#"><Gavel size={20} /> Trade Ledgers</a>
          <a aria-disabled="true" href="#"><CreditCard size={20} /> Treasury</a>
        </nav>
        <div className="gtt-pending-identity">
          <BusinessAvatarMenu direction="up" email={application?.email ?? session?.user.email} onLogout={() => void onLogout()} />
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
            <nav aria-label="RFI response links">
              <a href="#">Markets</a>
              <a href="#">Insights</a>
              <a href="#">Regulatory</a>
            </nav>
          </div>
          <div className="gtt-pending-tools">
            <button className="gtt-rfi-back" onClick={() => navigate("/application-pending")} type="button"><ArrowLeft size={15} /> Application Status</button>
            <Bell size={21} />
            <Settings size={21} />
          </div>
        </header>

        <section className="gtt-pending-content">
          <section className="gtt-rfi-response-header">
            <div>
              <span>Compliance Workspace</span>
              <h2>Onboarding: Request for Information</h2>
              <p>{loading ? "Loading active compliance request." : "Respond to the open RFI so your application can return to review."}</p>
              {error ? <div className="form-error">{error}</div> : null}
            </div>
            <button disabled type="button">Information Required</button>
          </section>

          <div className="gtt-rfi-response-grid">
            <ClientRfiResponseWorkspace
              documentType={rfiDocumentType}
              onDocumentTypeChange={setRfiDocumentType}
              onResponseChange={setRfiResponse}
              onSubmit={submitRfiResponse}
              response={rfiResponse}
              rfiTasks={rfiTasks}
              submitting={rfiSubmitting}
            />
            <aside className="gtt-rfi-response-aside">
              <ClientRfiTimeline application={application} rfiTasks={rfiTasks} />
              <section className="gtt-rfi-global-standards">
                <h3>Global Standards</h3>
                <img src={rfiScreenA} alt="RFI response compliance workspace" />
                <p>Transparency is the foundation of institutional trust. All requests are handled through controlled compliance review.</p>
              </section>
            </aside>
          </div>
        </section>
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

function ClientRfiStatusCard({ onOpen, rfiTasks }: { onOpen: () => void; rfiTasks: OnboardingRfiTask[] }) {
  const openTasks = rfiTasks.filter((task) => task.status === "open");
  const task = openTasks[0] ?? fallbackRfiTask();
  return (
    <section className="gtt-client-rfi-status-card">
      <header>
        <div>
          <span>Request for Information</span>
          <h3>{rfiTitle(task)}</h3>
        </div>
        <code>{rfiDisplayId(task, 0)}</code>
      </header>
      <p>{task.note ?? "The compliance desk has requested additional information before approval can continue."}</p>
      <div className="gtt-client-rfi-fields">
        {task.requestedFields.length ? task.requestedFields.slice(0, 3).map((field) => <small key={field}>{field}</small>) : <small>General clarification</small>}
      </div>
      <button onClick={onOpen} type="button">
        Open
        <ArrowRight size={15} />
      </button>
    </section>
  );
}

function ClientRfiResponseWorkspace({
  documentType,
  onDocumentTypeChange,
  onResponseChange,
  onSubmit,
  response,
  rfiTasks,
  submitting
}: {
  documentType: string;
  onDocumentTypeChange: (value: string) => void;
  onResponseChange: (value: string) => void;
  onSubmit: () => void;
  response: string;
  rfiTasks: OnboardingRfiTask[];
  submitting: boolean;
}) {
  const openTasks = rfiTasks.filter((task) => task.status === "open");
  const latestOpen = openTasks[0];
  const reviewTasks = rfiTasks.filter((task) => task.status === "responded" || task.status === "closed");
  return (
    <div className="gtt-client-rfi-workspace">
      <section className="gtt-client-rfi-active">
        <h3><FileText size={17} /> Active Requests</h3>
        {(openTasks.length ? openTasks : [fallbackRfiTask()]).map((task, index) => (
          <article className={task.status === "open" ? "open" : ""} key={task.id}>
            <header>
              <code>{rfiDisplayId(task, index)}</code>
              <span>{formatRfiStatus(task.status)}</span>
            </header>
            <h4>{rfiTitle(task)}</h4>
            <blockquote>{task.note ?? "Please provide the requested compliance clarification or supporting document."}</blockquote>
            <div className="gtt-client-rfi-fields">
              {task.requestedFields.length ? task.requestedFields.map((field) => <small key={field}>{field}</small>) : <small>General clarification</small>}
            </div>
          </article>
        ))}
        {reviewTasks.map((task, index) => (
          <article className="review" key={task.id}>
            <header>
              <code>{rfiDisplayId(task, index + openTasks.length)}</code>
              <span>In Review</span>
            </header>
            <h4>{rfiTitle(task)}</h4>
            <blockquote>{task.note ?? "Your submitted response is waiting for compliance review."}</blockquote>
          </article>
        ))}
      </section>

      <section className="gtt-client-rfi-upload">
        <h3><Shield size={17} /> Secure Upload Portal</h3>
        <div>
          <div className="gtt-client-rfi-dropzone">
            <UploadCloud size={30} />
            <strong>Drop missing documents here</strong>
            <span>PDF, PNG, JPG up to 50MB</span>
          </div>
          <div className="gtt-client-rfi-form">
            <label>
              <span>Document Type</span>
              <select onChange={(event) => onDocumentTypeChange(event.target.value)} value={documentType}>
                <option>Certificate of Incorporation</option>
                <option>Tax ID</option>
                <option>Proof of Address</option>
                <option>Ownership Chart</option>
                <option>Other Evidence</option>
              </select>
            </label>
            <label>
              <span>Notes for Officer</span>
              <textarea onChange={(event) => onResponseChange(event.target.value)} placeholder={latestOpen?.note ? `Respond to: ${latestOpen.note}` : "Add additional context..."} rows={5} value={response} />
            </label>
            <button disabled={submitting || !response.trim()} onClick={onSubmit} type="button">
              {submitting ? "Submitting..." : "Submit Response"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ClientRfiTimeline({ application, rfiTasks }: { application?: OnboardingApplication; rfiTasks: OnboardingRfiTask[] }) {
  const latest = rfiTasks[0];
  return (
    <section className="gtt-client-rfi-timeline">
      <h3>Compliance Timeline</h3>
      <div>
        <ClientRfiTimelineItem active copy={latest?.requesterEmail ? `Officer: ${latest.requesterEmail}` : "Officer: Compliance Desk"} icon={AlertCircle} meta={latest ? formatSubmittedAt(latest.createdAt) : "Today"} title="RFI Issued by Compliance Team" />
        <ClientRfiTimelineItem copy="Action by business terminal" icon={Check} meta={application?.submittedAt ? formatSubmittedAt(application.submittedAt) : "Submitted"} title="Business application submitted" />
        <ClientRfiTimelineItem copy="Status: Draft created" icon={FileText} meta={application?.createdAt ? formatSubmittedAt(application.createdAt) : "Created"} title="Onboarding application initiated" />
      </div>
    </section>
  );
}

function ClientRfiTimelineItem({ active, copy, icon: Icon, meta, title }: { active?: boolean; copy: string; icon: typeof AlertCircle; meta: string; title: string }) {
  return (
    <article className={active ? "active" : ""}>
      <div><Icon size={14} /></div>
      <section>
        <time>{meta}</time>
        <strong>{title}</strong>
        <span>{copy}</span>
      </section>
    </article>
  );
}

const fallbackRfiTask = (): OnboardingRfiTask => ({
  id: "rfi-fallback",
  status: "open",
  requestedFields: ["Document Missing", "Beneficial Ownership"],
  note: "The compliance desk has requested additional information before approval can continue.",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
});

const rfiDisplayId = (task: OnboardingRfiTask, index: number): string => `RFI-${task.id.slice(-6).toUpperCase()}-${String(index + 1).padStart(2, "0")}`;
const rfiTitle = (task: OnboardingRfiTask): string => task.requestedFields.find((field) => field.toLowerCase().includes("section"))?.replace(/^Target Section:\s*/i, "") ?? "Beneficial Ownership Disclosure";
const formatRfiStatus = (status: string): string => status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

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
  if (status === "needs_information") {
    return {
      activation: "Client Action",
      copy: "The compliance desk has requested more information before approval can continue. Review your email or secure support thread for the requested evidence.",
      label: "Information Requested",
      reviewCopy: "Compliance review is waiting on additional client evidence",
      reviewStatus: "RFI Open",
      timelineCopy: "Current phase: request for information issued by the compliance desk."
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
