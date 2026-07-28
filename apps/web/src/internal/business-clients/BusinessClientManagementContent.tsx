import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  CheckCircle2,
  Contact,
  Download,
  Eye,
  FileText,
  Filter,
  History,
  Map,
  ShieldCheck,
  Users,
  X
} from "lucide-react";
import { jsPDF } from "jspdf";
import { useEffect, useState } from "react";
import approvalSuccessImage from "../../assets-internal/businessclient-sucess.jpg";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type View = "queue" | "detail" | "approved";
type ApplicationStatus = "draft" | "submitted" | "pending_review" | "needs_information" | "approved" | "rejected";
type StatusFilter = "all" | ApplicationStatus;
type RfiPriority = "Standard" | "Urgent" | "Critical";

interface BusinessClient { id: string; legalName: string; country: string; onboardingStatus: string; circleClientEntityId?: string; circleApplicationId?: string; }
interface OnboardingApplication { id: string; email: string; currentStep: string; status: ApplicationStatus; submittedAt?: string; createdAt: string; updatedAt: string; }
interface ReviewAction { id: string; action: "approved" | "rejected" | "requested_information"; note?: string; actorEmail?: string; createdAt: string; requestedFields?: string[]; }
interface RfiTask { id: string; status: string; requestedFields: string[]; note?: string; requesterEmail?: string; createdAt: string; updatedAt: string; resolvedAt?: string; }
interface StatusEvent { id: string; previousStatus?: string; nextStatus: string; source: string; actorEmail?: string; providerEventId?: string; createdAt: string; }
interface CircleKybEvidence { id: string; operationType: string; providerStatus: string; providerApplicationId?: string; providerClientEntityId?: string; providerEventId?: string; correlationId: string; createdAt: string; }
interface ReviewApplication { application: OnboardingApplication; businessClient?: BusinessClient; stepPayloads: Record<string, Record<string, unknown>>; reviewActions: ReviewAction[]; rfiTasks?: RfiTask[]; statusEvents?: StatusEvent[]; circleKybEvidence?: CircleKybEvidence[]; }
interface RfiDraft { requestType: string; targetSection: string; instructions: string; priority: RfiPriority; assigneeEmail: string; dueAt: string; }

const statusFilterOptions: { label: string; value: StatusFilter }[] = [
  { label: "All statuses", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Submitted", value: "submitted" },
  { label: "Pending review", value: "pending_review" },
  { label: "Needs information", value: "needs_information" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" }
];

const defaultRfiDraft: RfiDraft = {
  requestType: "Document Missing",
  targetSection: "Beneficial Ownership",
  instructions: "",
  priority: "Standard",
  assigneeEmail: "",
  dueAt: ""
};

export function BusinessClientManagementContent({
  navigate,
  path = "/internal/operations/business-clients"
}: {
  navigate?: (path: string) => void;
  path?: string;
}) {
  const [applications, setApplications] = useState<ReviewApplication[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<ReviewApplication>();
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<View>("queue");
  const [saving, setSaving] = useState(false);
  const [rfiOpen, setRfiOpen] = useState(false);

  const loadApplications = async () => {
    setLoadStatus("loading");
    setLoadError("");
    try {
      const response = await apiFetch<{ applications?: ReviewApplication[] }>("/admin/business-onboarding/applications");
      setApplications(response.applications ?? []);
      setLoadStatus("ready");
    } catch (error) {
      setApplications([]);
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "business_onboarding_fetch_failed");
    }
  };

  useEffect(() => { void loadApplications(); }, []);

  useEffect(() => {
    const routeId = businessClientRouteId(path);
    if (!routeId) {
      setSelected(undefined);
      setView("queue");
      return;
    }
    const match = applications.find((item) => item.application.id === routeId || item.businessClient?.id === routeId);
    if (match) {
      setSelected(match);
      setView("detail");
    } else if (loadStatus === "ready") {
      setSelected(undefined);
      setView("detail");
      setLoadError(`business_client_application_not_found:${routeId}`);
    }
  }, [applications, loadStatus, path]);

  const selectApplication = (item: ReviewApplication) => {
    setSelected(item);
    setView("detail");
    navigate?.(`/internal/operations/business-clients/${encodeURIComponent(item.application.id)}`);
  };

  const backToQueue = () => {
    setSelected(undefined);
    setView("queue");
    navigate?.("/internal/operations/business-clients");
  };

  const decide = async (action: "approve" | "request-info", body: Record<string, unknown> = {}) => {
    if (!selected) return;
    setSaving(true);
    setLoadError("");
    try {
      const result = await apiFetch<{ application: ReviewApplication }>(
        `/admin/business-onboarding/applications/${encodeURIComponent(selected.application.id)}/${action}`,
        { body: { actorEmail: "internal-operator", ...body }, method: "POST" }
      );
      const updated = result.application;
      setSelected(updated);
      setApplications((current) => current.map((item) => item.application.id === updated.application.id ? updated : item));
      setView(action === "approve" ? "approved" : "detail");
      if (action === "request-info") setRfiOpen(false);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "business_onboarding_decision_failed");
    } finally { setSaving(false); }
  };

  if (view === "detail" && !selected) return <section className="business-client-content"><p className="business-client-error">{loadStatus === "loading" ? "Loading business client application..." : loadError || "Business client application not found."}</p><button onClick={backToQueue} type="button">Back to applications</button></section>;
  if (view === "detail" && selected) return <>
    <ApplicationDetail application={selected} error={loadError} onApprove={() => void decide("approve")} onBack={backToQueue} onRequestInfo={() => setRfiOpen(true)} saving={saving} />
    <RfiTaskDrawer application={selected} isOpen={rfiOpen} onClose={() => setRfiOpen(false)} onSubmit={(payload) => void decide("request-info", payload)} saving={saving} />
  </>;
  if (view === "approved" && selected) return <ApprovalSuccess application={selected} onBack={backToQueue} />;

  const pending = applications.filter((item) => !["approved", "rejected"].includes(item.application.status));
  const awaitingInformation = applications.filter((item) => item.application.status === "needs_information");
  const approvedThisWeek = applications.filter((item) => item.application.status === "approved" && isWithinPastWeek(item.application.updatedAt));
  const filteredApplications = statusFilter === "all"
    ? applications
    : applications.filter((item) => item.application.status === statusFilter);

  return <section className="business-client-content" aria-label="Business client onboarding queue">
    <div className="business-client-metrics"><Metric label="Pending applications" value={String(pending.length).padStart(2, "0")} detail="Awaiting operator review" /><Metric label="Open RFIs" value={String(awaitingInformation.length).padStart(2, "0")} detail="Awaiting response" /><Metric label="Approved this week" value={String(approvedThisWeek.length).padStart(2, "0")} detail="Database record" detailClass="positive" /></div>
    <section className="business-client-alerts" aria-labelledby="business-client-alerts-title"><header><h1 id="business-client-alerts-title">Active alerts</h1><span>{awaitingInformation.length ? "Action needed" : "Clear"}</span></header><div className="business-client-alert-list">{awaitingInformation.length ? awaitingInformation.map((item) => <div className="business-client-alert pending" key={item.application.id}><strong>Information requested</strong><p>{clientName(item)} requires an update.</p><button onClick={() => selectApplication(item)} type="button">Review</button></div>) : <p className="business-client-empty">No outstanding information requests.</p>}</div></section>
    <section className="business-client-queue" aria-labelledby="business-client-queue-title"><header><h2 id="business-client-queue-title">Business client onboarding queue</h2><div className="business-client-status-filter"><button aria-expanded={filterOpen} aria-haspopup="menu" onClick={() => setFilterOpen((open) => !open)} title="Filter by status" type="button"><Filter size={16} strokeWidth={1.5} /><span>{statusFilter === "all" ? "Status" : formatStatus(statusFilter)}</span></button>{filterOpen ? <div className="business-client-status-filter-menu" role="menu">{statusFilterOptions.map((option) => <button className={statusFilter === option.value ? "active" : ""} key={option.value} onClick={() => { setStatusFilter(option.value); setFilterOpen(false); }} role="menuitem" type="button">{option.label}</button>)}</div> : null}</div></header>{loadStatus === "error" ? <p className="business-client-error">Could not load onboarding applications: {loadError}</p> : null}<div className="business-client-table-wrap"><table className="business-client-table"><thead><tr><th>Business name</th><th>Country</th><th>Application type</th><th>Status</th><th>Current step</th><th>Last action</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{loadStatus === "loading" ? <tr><td colSpan={7} className="business-client-loading">Loading onboarding applications...</td></tr> : null}{loadStatus === "ready" && !applications.length ? <tr><td colSpan={7} className="business-client-loading">No onboarding applications are stored in the database.</td></tr> : null}{loadStatus === "ready" && applications.length > 0 && filteredApplications.length === 0 ? <tr><td colSpan={7} className="business-client-loading">No onboarding applications match this status.</td></tr> : null}{filteredApplications.map((item) => <tr key={item.application.id} onClick={() => selectApplication(item)} className="selectable"><td><strong>{clientName(item)}</strong><code>ID: {shortId(item.application.id)}</code></td><td>{item.businessClient?.country ?? value(item.stepPayloads.step_2?.formationCountry)}</td><td>Business onboarding</td><td><span className={`business-client-status ${isInReview(item.application.status) ? "active" : ""}`}>{formatStatus(item.application.status)}</span></td><td>{formatStatus(item.application.currentStep)}</td><td><code>{formatDate(item.application.updatedAt)}</code></td><td className="business-client-row-actions"><button aria-label={`Review ${clientName(item)}`} onClick={(event) => { event.stopPropagation(); selectApplication(item); }} type="button"><Eye size={17} /></button><button aria-label={`Contact ${clientName(item)}`} onClick={(event) => event.stopPropagation()} type="button"><Contact size={17} /></button></td></tr>)}</tbody></table></div><footer><p>Showing {filteredApplications.length} of {applications.length} database application{applications.length === 1 ? "" : "s"}</p><div><button disabled type="button">Previous</button><button disabled type="button">Next</button></div></footer></section>
  </section>;
}

function ApplicationDetail({ application: item, error, onApprove, onBack, onRequestInfo, saving }: { application: ReviewApplication; error: string; onApprove: () => void; onBack: () => void; onRequestInfo: () => void; saving: boolean }) {
  const profile = item.stepPayloads.step_2 ?? {};
  const operations = item.stepPayloads.step_4 ?? {};
  const reviewActions = item.reviewActions.length ? item.reviewActions : [{ id: item.application.id, action: "requested_information" as const, createdAt: item.application.createdAt, note: "Application created" }];
  const rfiTasks = item.rfiTasks ?? [];
  const statusEvents = item.statusEvents ?? [];
  const kybEvidence = item.circleKybEvidence ?? [];
  const documentState = item.stepPayloads.step_3 ? "Submitted" : "Not submitted";
  return <section className="business-client-content business-client-detail" aria-label="Business client application review"><header className="business-client-detail-header"><div><div className="business-client-header-meta"><span className={`business-client-status ${isInReview(item.application.status) ? "active" : ""}`}>{formatStatus(item.application.status)}</span><code>APP-ID: {shortId(item.application.id)}</code></div><h1>{clientName(item)}</h1><p><strong>Business email:</strong> {item.application.email} <strong>Submitted:</strong> {formatDate(item.application.submittedAt ?? item.application.createdAt)}</p></div><div><button className="danger" disabled type="button">Restrict client</button><button disabled type="button">Close application</button></div></header>{error ? <p className="business-client-error">Decision could not be saved: {error}</p> : null}<div className="business-client-detail-grid"><div className="business-client-detail-sections"><InfoSection icon={Building2} title="Business profile"><DataList items={[["Legal name", clientName(item)], ["Country of incorporation", item.businessClient?.country ?? value(profile.formationCountry)], ["Onboarding status", formatStatus(item.application.status)], ["Business email", item.application.email]]} /></InfoSection><InfoSection icon={FileText} title="Registration details"><DataList mono items={[["Tax ID / VAT", value(profile.taxId)], ["Registration number", value(profile.registrationNumber)], ["Application ID", item.application.id], ["Created", formatDate(item.application.createdAt)]]} /></InfoSection><InfoSection icon={Users} title="Beneficial ownership (UBO)"><div className="business-client-ownership"><div><span>Owner name</span><span>Citizenship</span><span>Ownership %</span></div><div><strong>{value(profile.beneficialOwnerName)}</strong><span>{value(profile.beneficialOwnerCountry)}</span><code>{value(profile.beneficialOwnerPercentage)}</code></div></div></InfoSection><InfoSection icon={Map} title="Intended use & operations"><div className="business-client-operation"><div><span>Country of operation</span><p className="business-client-country-tags"><b>{item.businessClient?.country ?? value(profile.formationCountry)}</b></p></div><div><span>Business model</span><p>{value(profile.businessModel)}</p></div></div><div className="business-client-volume"><Metric label="Expected monthly fiat activity" value={value(operations.monthlyFiat)} /><Metric label="Expected monthly crypto activity" value={value(operations.monthlyCrypto)} /></div></InfoSection></div><aside className="business-client-detail-aside"><section className="business-client-risk"><h2>Review status</h2><div><span>Application status</span><strong>{formatStatus(item.application.status)}</strong><AlertTriangle size={23} /></div><p><span>Current step</span><strong>{formatStatus(item.application.currentStep)}</strong></p><small>Last updated: {formatDate(item.application.updatedAt)}</small><button disabled type="button">Re-run screening</button></section><AsidePanel title="Circle KYB evidence">{kybEvidence.length ? kybEvidence.map((evidence) => <EvidenceLine key={evidence.id} title={formatStatus(evidence.operationType)} status={formatStatus(evidence.providerStatus)} meta={evidence.providerApplicationId ?? evidence.providerEventId ?? evidence.correlationId} />) : <p className="business-client-empty">No Circle KYB evidence recorded yet.</p>}{item.businessClient?.circleClientEntityId ? <DataList mono items={[["Circle entity", item.businessClient.circleClientEntityId], ["Circle application", item.businessClient.circleApplicationId ?? "Not mapped"]]} /> : null}</AsidePanel>{rfiTasks.length ? <AsidePanel title="Open information requests">{rfiTasks.map((task) => <EvidenceLine key={task.id} title={formatStatus(task.status)} status={task.requestedFields.join(", ") || "General clarification"} meta={task.note ?? formatDateTime(task.createdAt)} />)}</AsidePanel> : null}<AsidePanel title="Evidence documents"><Document icon={item.stepPayloads.step_2 ? CheckCircle2 : AlertCircle} name="Business identity" state={item.stepPayloads.step_2 ? "Saved" : "Not provided"} muted={!item.stepPayloads.step_2} /><Document icon={item.stepPayloads.step_3 ? CheckCircle2 : AlertCircle} name="Beneficial ownership" state={documentState} muted={!item.stepPayloads.step_3} /><Document icon={item.stepPayloads.step_4 ? History : AlertCircle} name="Operations profile" state={item.stepPayloads.step_4 ? "Saved" : "Not provided"} muted={!item.stepPayloads.step_4} /></AsidePanel><AsidePanel title="Audit trail"><ol className="business-client-audit">{reviewActions.map((action) => <li key={action.id}><strong>{formatAction(action.action, action.note)}</strong><span>{formatDateTime(action.createdAt)}{action.actorEmail ? ` by ${action.actorEmail}` : ""}{action.requestedFields?.length ? ` · ${action.requestedFields.join(", ")}` : ""}</span></li>)}{statusEvents.map((event) => <li key={event.id}><strong>{formatStatus(event.previousStatus ? `${event.previousStatus} to ${event.nextStatus}` : event.nextStatus)}</strong><span>{formatStatus(event.source)} · {formatDateTime(event.createdAt)}{event.providerEventId ? ` · ${event.providerEventId}` : ""}</span></li>)}</ol></AsidePanel></aside></div><footer className="business-client-review-actions"><button onClick={onBack} type="button"><ArrowLeft size={16} /> Back to applications</button><div><button disabled={saving || item.application.status === "approved"} onClick={onRequestInfo} type="button">Request clarification</button><button className="primary" disabled={saving || item.application.status === "approved"} onClick={onApprove} type="button">{saving ? "Saving..." : "Approve application"}</button></div></footer></section>;
}

function RfiTaskDrawer({ application, isOpen, onClose, onSubmit, saving }: { application: ReviewApplication; isOpen: boolean; onClose: () => void; onSubmit: (payload: Record<string, unknown>) => void; saving: boolean }) {
  const [draft, setDraft] = useState<RfiDraft>(defaultRfiDraft);

  useEffect(() => {
    if (isOpen) setDraft(defaultRfiDraft);
  }, [isOpen, application.application.id]);

  if (!isOpen) return null;

  const updateDraft = (key: keyof RfiDraft, fieldValue: string) => {
    setDraft((current) => ({ ...current, [key]: fieldValue }));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const note = draft.instructions.trim();
    if (!note) return;
    onSubmit({
      assigneeEmail: draft.assigneeEmail.trim() || undefined,
      dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : undefined,
      note,
      requestedFields: [
        `Request Type: ${draft.requestType}`,
        `Target Section: ${draft.targetSection}`,
        `Priority: ${draft.priority}`
      ]
    });
  };

  return <div className="business-client-rfi-overlay" role="presentation"><form aria-label="Generate request for information" className="business-client-rfi-drawer" onSubmit={submit}><header><div><h2>Generate Request for Information</h2><p><span>Client:</span> {clientName(application)} <span>App-ID:</span> {shortId(application.application.id)}</p></div><button aria-label="Close RFI drawer" onClick={onClose} type="button"><X size={20} strokeWidth={1.5} /></button></header><div className="business-client-rfi-body"><label><span>Request Type</span><select onChange={(event) => updateDraft("requestType", event.target.value)} value={draft.requestType}><option>Document Missing</option><option>Data Clarification</option><option>Identity Verification</option><option>Other</option></select></label><label><span>Target Section</span><select onChange={(event) => updateDraft("targetSection", event.target.value)} value={draft.targetSection}><option>Business Profile</option><option>Beneficial Ownership</option><option>Intended Use</option><option>Registration Details</option></select></label><label className="wide"><span>Specific Instructions</span><textarea onChange={(event) => updateDraft("instructions", event.target.value)} placeholder="Enter detailed compliance notes or specific requirements for the client..." rows={5} value={draft.instructions} /></label><div className="business-client-rfi-priority" role="radiogroup" aria-label="Priority level"><span>Priority Level</span>{(["Standard", "Urgent", "Critical"] as RfiPriority[]).map((priority) => <label key={priority}><input checked={draft.priority === priority} name="rfi-priority" onChange={() => updateDraft("priority", priority)} type="radio" />{priority}</label>)}</div><label><span>Assignee Email</span><input onChange={(event) => updateDraft("assigneeEmail", event.target.value)} placeholder="compliance@gtt.example" type="email" value={draft.assigneeEmail} /></label><label><span>Due Date</span><input onChange={(event) => updateDraft("dueAt", event.target.value)} type="datetime-local" value={draft.dueAt} /></label></div><footer><button className="primary" disabled={saving || !draft.instructions.trim()} type="submit">{saving ? "Sending..." : "Send Request"}</button><button disabled={saving} onClick={onClose} type="button">Cancel</button></footer></form></div>;
}

function ApprovalSuccess({ application: item, onBack }: { application: ReviewApplication; onBack: () => void }) {
  const approvedAction = item.reviewActions.find((action) => action.action === "approved");
  return <section className="business-client-content business-client-success" aria-label="Application approval finalized"><div className="business-client-success-main"><section className="business-client-approved-banner"><ShieldCheck size={80} /><div><span><CheckCircle2 size={26} /> Approval finalized</span><h1>Application Approved Successfully</h1><p>The onboarding application for {clientName(item)} has been approved and its business-client record is available for account provisioning.</p></div></section><div className="business-client-success-cards"><section><span>Entity details</span><h2>{clientName(item)}</h2><p><b>{formatStatus(item.application.status)}</b> {item.businessClient?.country ?? value(item.stepPayloads.step_2?.formationCountry)}</p><code>{item.businessClient?.id ?? item.application.id}</code></section><section><span>System operations</span><h2>ADA initialization</h2><p>Business client record <Check size={16} /></p><p>Onboarding approval <Check size={16} /></p><p>Digital asset account <em>Ready for provisioning</em></p></section></div><div className="business-client-success-actions"><button className="primary" type="button">Provision digital asset account</button><button onClick={onBack} type="button">View client profile</button></div></div><aside><AsidePanel title="Audit evidence"><DataList mono items={[["Application ID", item.application.id], ["Approved at", formatDateTime(approvedAction?.createdAt ?? item.application.updatedAt)], ["Approving operator", approvedAction?.actorEmail ?? "Internal operator"], ["Client record", item.businessClient?.id ?? "Created on approval"]]} /><button className="business-client-certificate-download" onClick={() => downloadApprovalCertificate(item, approvedAction)} type="button"><Download size={15} /> Download Approval Certificate (PDF)</button></AsidePanel><figure className="business-client-success-image"><img alt="Business client approval confirmation" src={approvalSuccessImage} /></figure></aside></section>;
}

async function apiFetch<T>(path: string, init: { body?: Record<string, unknown>; method?: "POST" } = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, { method: init.method ?? "GET", headers: { authorization: `Bearer ${gttApiKey}`, ...(init.body ? { "content-type": "application/json" } : {}) }, ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `business_onboarding_request_failed:${response.status}`);
  return payload;
}

const value = (input: unknown): string => typeof input === "string" && input.trim() ? input : "Not provided";
const clientName = (item: ReviewApplication): string => item.businessClient?.legalName ?? (value(item.stepPayloads.step_2?.legalBusinessName) !== "Not provided" ? value(item.stepPayloads.step_2?.legalBusinessName) : item.application.email);
const shortId = (id: string): string => id.replace("business_onboarding_application_", "").slice(0, 16);
const formatStatus = (status: string): string => status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (date?: string): string => date ? new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(date)) : "Not provided";
const formatDateTime = (date?: string): string => date ? new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date)) : "Not provided";
const formatAction = (action: ReviewAction["action"], note?: string): string => note || formatStatus(action);
const isInReview = (status: ApplicationStatus): boolean => ["submitted", "pending_review", "needs_information"].includes(status);
const isWithinPastWeek = (date: string): boolean => new Date(date).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000;
const businessClientRouteId = (path: string): string | undefined => {
  const match = path.match(/^\/internal\/operations\/business-clients\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
};

function downloadApprovalCertificate(application: ReviewApplication, approvedAction?: ReviewAction): void {
  const pdf = new jsPDF({ format: "a4", unit: "mm" });
  const approvedAt = approvedAction?.createdAt ?? application.application.updatedAt;
  const country = application.businessClient?.country ?? value(application.stepPayloads.step_2?.formationCountry);
  const title = "BUSINESS CLIENT APPROVAL CERTIFICATE";

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text("GLOBAL TRADE TREASURY", 20, 22);
  pdf.setDrawColor(27, 27, 27);
  pdf.line(20, 27, 190, 27);
  pdf.setFontSize(22);
  pdf.text(title, 20, 44);
  pdf.setFontSize(11);
  pdf.text("This certificate confirms the approval of the following business onboarding application.", 20, 55);

  const rows: [string, string][] = [
    ["Legal entity", clientName(application)],
    ["Country", country],
    ["Application ID", application.application.id],
    ["Business client ID", application.businessClient?.id ?? "Created on approval"],
    ["Approved at", formatDateTime(approvedAt)],
    ["Approving operator", approvedAction?.actorEmail ?? "Internal operator"],
    ["Status", formatStatus(application.application.status)]
  ];
  let y = 72;
  for (const [label, rowValue] of rows) {
    pdf.setFontSize(9);
    pdf.text(label.toUpperCase(), 20, y);
    pdf.setFontSize(11);
    const lines = pdf.splitTextToSize(rowValue, 112);
    pdf.text(lines, 72, y);
    y += Math.max(12, lines.length * 5 + 5);
  }

  pdf.line(20, y + 5, 190, y + 5);
  pdf.setFontSize(9);
  pdf.text("This document was generated from the Global Trade Treasury onboarding record.", 20, y + 15);
  pdf.save(`approval-certificate-${fileSafeName(clientName(application))}.pdf`);
}

const fileSafeName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "business-client";

function Metric({ label, value, detail, detailClass = "" }: { label: string; value: string; detail?: string; detailClass?: string }) { return <article className="business-client-metric"><span>{label}</span><div><strong>{value}</strong>{detail ? <small className={detailClass}>{detail}</small> : null}</div></article>; }
function InfoSection({ icon: Icon, title, children }: { icon: typeof Building2; title: string; children: React.ReactNode }) { return <section className="business-client-info"><h2><Icon size={16} /> {title}</h2>{children}</section>; }
function DataList({ items, mono = false }: { items: [string, string][]; mono?: boolean }) { return <div className={`business-client-data-list ${mono ? "mono" : ""}`}>{items.map(([label, itemValue]) => <div key={label}><span>{label}</span><strong>{itemValue}</strong></div>)}</div>; }
function AsidePanel({ title, children }: { title: string; children: React.ReactNode }) { return <section className="business-client-aside-panel"><h2>{title}</h2>{children}</section>; }
function Document({ icon: Icon, name, state, muted = false }: { icon: typeof CheckCircle2; name: string; state: string; muted?: boolean }) { return <div className={`business-client-document ${muted ? "muted" : ""}`}><FileText size={19} /><div><strong>{name}</strong><span>{state}</span></div><Icon size={18} /></div>; }
function EvidenceLine({ meta, status, title }: { meta: string; status: string; title: string }) { return <div className="business-client-document"><ShieldCheck size={19} /><div><strong>{title}</strong><span>{meta}</span></div><code>{status}</code></div>; }
