import { type Session } from "@supabase/supabase-js";
import { Check, Download, Info } from "lucide-react";
import { useEffect, useState } from "react";
import officeInhouse from "../../../assets/office-inhouse.jpg";
import { type MyOnboardingResponse, type OnboardingApplication } from "./types.js";
import { apiRequest } from "../shared/apiClient.js";
import { BusinessAvatarMenu } from "../shared/BusinessAvatarMenu.js";

type Navigate = (path: string) => void;

type SubmissionConfirmedModuleProps = {
  navigate: Navigate;
  onLogout: () => void;
  session: Session | null;
};

export function SubmissionConfirmedModule({ navigate, onLogout, session }: SubmissionConfirmedModuleProps) {
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
          <BusinessAvatarMenu email={application?.email ?? session?.user.email} onLogout={onLogout} />
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
