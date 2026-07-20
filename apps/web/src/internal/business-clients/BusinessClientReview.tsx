import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  Eye,
  FileText,
  Filter,
  History,
  Mail,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AppUser } from "../../identity.js";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type OnboardingStatus = "draft" | "submitted" | "pending_review" | "needs_information" | "approved" | "rejected";

interface ReviewApplication {
  id: string;
  tenantId: string;
  authUserId: string;
  email: string;
  currentStep: string;
  status: OnboardingStatus;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ReviewBusinessClient {
  id: string;
  tenantId: string;
  legalName: string;
  country: string;
  onboardingStatus: string;
  createdAt: string;
}

interface ReviewAction {
  id: string;
  action: "approved" | "rejected" | "requested_information";
  note?: string;
  requestedFields: string[];
  actorEmail?: string;
  createdAt: string;
}

interface ReviewRecord {
  application: ReviewApplication;
  businessClient?: ReviewBusinessClient;
  stepPayloads: Record<string, Record<string, unknown>>;
  reviewActions: ReviewAction[];
}

export const BusinessClientReview = ({
  currentUser,
  navigate,
  path
}: {
  currentUser?: AppUser;
  navigate: (path: string) => void;
  path: string;
}) => {
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [acting, setActing] = useState(false);
  const selectedId = decodeURIComponent(path.split("/").pop() ?? "");
  const isDetail = /^\/internal\/operations\/business-clients\/[^/]+$/.test(path);
  const selected = isDetail ? records.find((record) => record.application.id === selectedId) : undefined;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiFetch<{ applications: ReviewRecord[] }>("/admin/business-onboarding/applications");
      setRecords(payload.applications ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "business_onboarding_load_failed");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const decide = async (record: ReviewRecord, action: "approve" | "reject" | "request-info", body: Record<string, unknown> = {}) => {
    setActing(true);
    setError("");
    setNotice("");
    try {
      const result = await apiFetch<{ application?: ReviewRecord }>(`/admin/business-onboarding/applications/${encodeURIComponent(record.application.id)}/${action}`, {
        method: "POST",
        body: {
          actorEmail: currentUser?.email,
          ...body
        }
      });
      if (result.application) {
        setRecords((current) => mergeReviewRecord(current, result.application!));
      }
      setNotice(action === "request-info" ? "Request for information recorded." : `Application ${action === "approve" ? "approved" : "rejected"}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "business_onboarding_action_failed");
    } finally {
      setActing(false);
    }
  };

  if (isDetail) {
    return (
      <BusinessClientDetailView
        acting={acting}
        error={error}
        loading={loading}
        navigate={navigate}
        notice={notice}
        onApprove={(record) => decide(record, "approve", { note: "Approved from internal business client detail." })}
        onReject={(record, note) => decide(record, "reject", { note })}
        onRequestInfo={(record, note, requestedFields) => decide(record, "request-info", { note, requestedFields })}
        record={selected}
      />
    );
  }

  return (
    <BusinessClientQueueView
      error={error}
      loading={loading}
      navigate={navigate}
      records={records}
    />
  );
};

const BusinessClientQueueView = ({
  error,
  loading,
  navigate,
  records
}: {
  error: string;
  loading: boolean;
  navigate: (path: string) => void;
  records: ReviewRecord[];
}) => {
  const pendingCount = records.filter((record) => ["submitted", "pending_review", "needs_information"].includes(record.application.status)).length;
  const rfiCount = records.filter((record) => record.application.status === "needs_information").length;
  const approvedCount = records.filter((record) => record.application.status === "approved").length;

  return (
    <div className="business-client-review">
      <section className="business-client-review-metrics">
        <Metric label="Pending Applications" value={loading ? "..." : String(pendingCount)} meta="Awaiting compliance review" />
        <Metric label="Open RFIs" value={loading ? "..." : String(rfiCount)} meta="Waiting on client response" />
        <Metric label="Approved Total" value={loading ? "..." : String(approvedCount)} meta="Ready for treasury enablement" />
      </section>

      <section className="business-client-review-alerts">
        <div>
          <h2>Active Alerts</h2>
          <span>Review Queue</span>
        </div>
        <div>
          <AlertPill tone="risk" label="Entity Risk" text="High-volume clients require beneficial-owner review." />
          <AlertPill tone="info" label="Documentation" text="RFIs are tracked on each application detail." />
          <AlertPill tone="risk" label="Sanctions" text="Screening results must be recorded before approval." />
        </div>
      </section>

      <section className="business-client-review-table-section">
        <div className="business-client-review-section-title">
          <h1>Business Client Onboarding Queue</h1>
          <button type="button"><Filter size={15} /> Filter View</button>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="business-client-review-table-wrap">
          <table className="business-client-review-table">
            <thead>
              <tr>
                <th>Business Name</th>
                <th>Country</th>
                <th>Application Type</th>
                <th>Status</th>
                <th>Risk</th>
                <th>Last Action</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const profile = businessProfile(record);
                return (
                  <tr key={record.application.id} onClick={() => navigate(`/internal/operations/business-clients/${encodeURIComponent(record.application.id)}`)}>
                    <td><span>{profile.legalName}</span><small>{record.application.email}</small></td>
                    <td>{profile.country}</td>
                    <td>{profile.applicationType}</td>
                    <td><StatusPill status={record.application.status} /></td>
                    <td>{riskTier(record)}</td>
                    <td>{formatDate(record.application.updatedAt)}</td>
                    <td>
                      <button title="View detail" type="button"><Eye size={15} /></button>
                      <button title="Request information" type="button"><Mail size={15} /></button>
                      <button title="Approval review" type="button"><CheckCircle size={15} /></button>
                    </td>
                  </tr>
                );
              })}
              {!loading && !records.length ? (
                <tr><td colSpan={7}>No business onboarding applications found.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

const BusinessClientDetailView = ({
  acting,
  error,
  loading,
  navigate,
  notice,
  onApprove,
  onReject,
  onRequestInfo,
  record
}: {
  acting: boolean;
  error: string;
  loading: boolean;
  navigate: (path: string) => void;
  notice: string;
  onApprove: (record: ReviewRecord) => void;
  onReject: (record: ReviewRecord, note: string) => void;
  onRequestInfo: (record: ReviewRecord, note: string, requestedFields: string[]) => void;
  record?: ReviewRecord;
}) => {
  const [rfiOpen, setRfiOpen] = useState(false);
  const [rfiNote, setRfiNote] = useState("Please provide the requested documents or clarifications for compliance review.");
  const [rejectNote, setRejectNote] = useState("Application does not meet current onboarding requirements.");
  const [requestedFields, setRequestedFields] = useState("Ownership chart, Source of funds evidence");
  const profile = useMemo(() => record ? businessProfile(record) : undefined, [record]);

  if (loading && !record) return <div className="business-client-review"><section className="business-client-review-empty">Loading business client detail...</section></div>;
  if (!record || !profile) {
    return (
      <div className="business-client-review">
        <section className="business-client-review-empty">
          <h1>Business client application not found</h1>
          <button onClick={() => navigate("/internal/operations/business-clients")} type="button">Back to applications</button>
        </section>
      </div>
    );
  }

  return (
    <div className="business-client-review detail">
      <header className="business-client-review-detail-header">
        <div>
          <div className="business-client-review-id-line">
            <StatusPill status={record.application.status} />
            <span>APP-ID: {record.application.id.slice(-12).toUpperCase()}</span>
          </div>
          <h1>{profile.legalName}</h1>
          <div className="business-client-review-meta-line">
            <span>Correlation: {record.businessClient?.id ?? "Pending client record"}</span>
            <span>Submitted: {formatDate(record.application.submittedAt ?? record.application.updatedAt)}</span>
          </div>
        </div>
        <div>
          <button disabled={acting} onClick={() => onReject(record, rejectNote)} type="button"><XCircle size={16} /> Reject</button>
          <button disabled={acting} onClick={() => setRfiOpen((open) => !open)} type="button"><Mail size={16} /> Request Info</button>
          <button disabled={acting || record.application.status === "approved"} onClick={() => onApprove(record)} type="button"><CheckCircle size={16} /> Approve</button>
        </div>
      </header>

      {notice ? <div className="business-client-review-notice">{notice}</div> : null}
      {error ? <div className="form-error">{error}</div> : null}

      {rfiOpen ? (
        <section className="business-client-review-rfi">
          <h2>Request for Information</h2>
          <label>
            Requested fields
            <input value={requestedFields} onChange={(event) => setRequestedFields(event.target.value)} />
          </label>
          <label>
            Message
            <textarea value={rfiNote} onChange={(event) => setRfiNote(event.target.value)} rows={3} />
          </label>
          <button
            disabled={acting}
            onClick={() => {
              onRequestInfo(record, rfiNote, requestedFields.split(",").map((item) => item.trim()).filter(Boolean));
              setRfiOpen(false);
            }}
            type="button"
          >
            Send RFI
          </button>
        </section>
      ) : null}

      <div className="business-client-review-detail-grid">
        <div className="business-client-review-detail-main">
          <DetailSection title="Business Profile">
            <Field label="Legal Name" value={profile.legalName} />
            <Field label="Country of Incorporation" value={profile.country} />
            <Field label="Entity Type" value={profile.entityType} />
            <Field label="Website" value={profile.website} />
          </DetailSection>
          <DetailSection title="Registration Details">
            <Field label="Tax ID / VAT" value={profile.taxId} mono />
            <Field label="Registration Number" value={profile.registrationNumber} mono />
            <Field label="Formation Country" value={profile.country} mono />
          </DetailSection>
          <DetailSection title="Beneficial Ownership">
            <div className="business-client-review-owner-table">
              <div><span>Owner Name</span><span>Citizenship</span><span>Ownership</span></div>
              <div><span>{profile.ownerName}</span><span>{profile.ownerCitizenship}</span><span>{profile.ownerPercent}</span></div>
            </div>
          </DetailSection>
          <DetailSection title="Intended Use & Operations">
            <Field label="Business Model" value={profile.businessModel} />
            <Field label="Source of Funds" value={profile.sourceOrigin} />
            <Field label="Monthly Fiat Activity" value={profile.monthlyFiat} />
            <Field label="Monthly Crypto Activity" value={profile.monthlyCrypto} />
          </DetailSection>
        </div>

        <aside className="business-client-review-right-rail">
          <section>
            <h2>Risk & Screening</h2>
            <div className="business-client-review-risk">
              <div><span>Risk Tier</span><p>{riskTier(record)}</p></div>
              <AlertTriangle size={22} />
            </div>
            <Field label="Sanctions Match" value="No confirmed match recorded" />
            <Field label="Last Screening" value={formatDate(record.application.updatedAt)} />
            <button type="button">Re-run Screening</button>
          </section>
          <section>
            <h2>Evidence Documents</h2>
            <EvidenceItem title="Business Registration" status={profile.registrationNumber ? "Captured" : "Missing"} />
            <EvidenceItem title="Tax ID" status={profile.taxId ? "Captured" : "Missing"} />
            <EvidenceItem title="Ownership Chart" status={profile.ownerName ? "Captured" : "Pending"} />
          </section>
          <section>
            <h2>Audit Trail</h2>
            <AuditItem title="Submitted for review" meta={formatDate(record.application.submittedAt ?? record.application.updatedAt)} />
            {record.reviewActions.map((action) => (
              <AuditItem key={action.id} title={labelForAction(action.action)} meta={`${formatDate(action.createdAt)}${action.actorEmail ? ` by ${action.actorEmail}` : ""}`} />
            ))}
          </section>
        </aside>
      </div>

      <footer className="business-client-review-actionbar">
        <button onClick={() => navigate("/internal/operations/business-clients")} type="button"><ArrowLeft size={15} /> Back to Applications</button>
        <div>
          <label>
            Rejection note
            <input value={rejectNote} onChange={(event) => setRejectNote(event.target.value)} />
          </label>
        </div>
      </footer>
    </div>
  );
};

const mergeReviewRecord = (records: ReviewRecord[], updated: ReviewRecord): ReviewRecord[] => {
  const index = records.findIndex((record) => record.application.id === updated.application.id);
  if (index < 0) return [updated, ...records];
  return records.map((record) => record.application.id === updated.application.id ? updated : record);
};

const Metric = ({ label, meta, value }: { label: string; meta: string; value: string }) => (
  <article><span>{label}</span><div><p>{value}</p><small>{meta}</small></div></article>
);

const AlertPill = ({ label, text, tone }: { label: string; text: string; tone: "info" | "risk" }) => (
  <article className={tone}><i /><span>{label}</span><p>{text}</p></article>
);

const DetailSection = ({ children, title }: { children: ReactNode; title: string }) => (
  <section className="business-client-review-detail-section"><h2>{title}</h2><div>{children}</div></section>
);

const Field = ({ label, mono, value }: { label: string; mono?: boolean; value?: string }) => (
  <div className={mono ? "mono" : ""}><span>{label}</span><p>{value || "Not provided"}</p></div>
);

const EvidenceItem = ({ status, title }: { status: string; title: string }) => (
  <div className="business-client-review-evidence"><FileText size={17} /><div><p>{title}</p><span>{status}</span></div><CheckCircle size={17} /></div>
);

const AuditItem = ({ meta, title }: { meta: string; title: string }) => (
  <div className="business-client-review-audit"><History size={15} /><div><p>{title}</p><span>{meta}</span></div></div>
);

const StatusPill = ({ status }: { status: OnboardingStatus }) => <span className={`business-client-review-status ${status}`}>{statusLabel(status)}</span>;

const businessProfile = (record: ReviewRecord) => {
  const step2 = record.stepPayloads.step_2 ?? {};
  const step3 = record.stepPayloads.step_3 ?? {};
  const step4 = record.stepPayloads.step_4 ?? {};
  return {
    legalName: text(step2.legalBusinessName) ?? text(step2.legalName) ?? record.businessClient?.legalName ?? record.application.email.split("@")[0],
    country: text(step2.formationCountry) ?? record.businessClient?.country ?? "Not provided",
    entityType: text(step2.entityType) ?? "Institutional Business",
    website: text(step2.businessWebsite) ?? "Not provided",
    taxId: text(step2.taxId),
    registrationNumber: text(step2.registrationNumber),
    ownerName: text(step3.ownerName) ?? "Not provided",
    ownerCitizenship: text(step3.ownerCitizenship) ?? "Not provided",
    ownerPercent: text(step3.ownerPercent) ? `${text(step3.ownerPercent)}%` : "Not provided",
    businessModel: text(step2.businessModel) ?? "Not provided",
    sourceOrigin: text(step4.sourceOrigin) ?? "Not provided",
    monthlyFiat: text(step4.monthlyFiat) ?? "Not provided",
    monthlyCrypto: text(step4.monthlyCrypto) ?? "Not provided",
    applicationType: text(step4.accountPurpose) ?? "Institutional Business"
  };
};

const riskTier = (record: ReviewRecord): string => {
  const profile = businessProfile(record);
  if (profile.country.toLowerCase().includes("select")) return "Tier 2";
  if (record.application.status === "needs_information") return "Tier 3";
  return "Tier 1";
};

const labelForAction = (action: ReviewAction["action"]): string => {
  if (action === "approved") return "Application approved";
  if (action === "rejected") return "Application rejected";
  return "Request for information sent";
};

const statusLabel = (status: OnboardingStatus): string => {
  const labels: Record<OnboardingStatus, string> = {
    approved: "Approved",
    draft: "Draft",
    needs_information: "RFI",
    pending_review: "In Review",
    rejected: "Rejected",
    submitted: "Submitted"
  };
  return labels[status];
};

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;

const formatDate = (value?: string): string => {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(date);
};

async function apiFetch<T = unknown>(path: string, options: { body?: unknown; method?: "GET" | "POST" } = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      "content-type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : `request_failed:${response.status}`;
    throw new Error(error);
  }
  return body as T;
}
