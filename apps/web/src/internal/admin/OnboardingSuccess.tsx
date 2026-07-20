import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Database,
  HelpCircle,
  Landmark,
  LayoutDashboard,
  Plus,
  Settings,
  Shield,
  ShieldCheck,
  UserCircle,
  Users
} from "lucide-react";
import { useState } from "react";
import internalHouseImageUrl from "../../assets-internal/internal-house.jpg";
import { getRoleDefinition, type RoleCode } from "../../identity.js";
import InternalAdminFooter from "./InternalAdminFooter.js";

export default function OnboardingSuccess({
  onNavigate
}: {
  onNavigate: (path: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const state = window.history.state || {};
  const displayName = state.displayName || "Dominic Thorne";
  const email = state.email || "d.thorne@globaltrade.admin";
  const roleCode = (state.roleCode as RoleCode) || "treasury_operator";
  const idempotencyKey = state.idempotencyKey || "TRX_AUTH_882910_CONF";
  const token = state.token || "9f4e2a-11bc-9981-d001-f2a83";
  const emailDelivery = state.emailDelivery as { sent?: boolean; provider?: string; status?: string; detail?: string } | undefined;
  const roleName = getRoleDefinition(roleCode)?.name || "Treasury Operator";
  const activationLink = state.activationLink || `https://auth.treasury.platform/v1/activate?tkn=${token}`;

  const copyToClipboard = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const getClearanceLevel = (role: RoleCode) => {
    switch (role) {
      case "super_admin":
        return "L1 - Global Administration";
      case "platform_admin":
        return "L2 - Platform Administrator";
      case "treasury_operator":
        return "L3 - Restricted Execution";
      case "platform_operator":
        return "L3 - Operations Specialist";
      case "auditor":
        return "L4 - Auditing & Read-Only";
      default:
        return "L5 - Business Account";
    }
  };

  return (
    <div className="internal-success-screen">
      <header className="internal-success-topbar">
        <div>
          <span>INTERNAL ADMIN CONSOLE</span>
        </div>
        <nav aria-label="Internal admin navigation">
          <button onClick={() => onNavigate("/internal/operations/commandcentre")} type="button">
            Dashboard
          </button>
          <button onClick={() => onNavigate("/internal/operations/ledger/chart-of-accounts")} type="button">
            DAA Registry
          </button>
          <button className="active" onClick={() => onNavigate("/internal/operations/admin/users")} type="button">
            User Management
          </button>
          <button onClick={() => onNavigate("/internal/operations/audit")} type="button">
            Treasury Audit
          </button>
        </nav>
        <div className="internal-success-topbar-actions">
          <button title="Settings" type="button"><Settings size={18} /></button>
          <button title="Help" type="button"><HelpCircle size={18} /></button>
          <button title="Account" type="button"><UserCircle size={18} /></button>
        </div>
      </header>

      <div className="internal-success-layout">
        <aside className="internal-success-sidebar">
          <div className="internal-success-sidebar-head">
            <span>SYSTEM ADMIN</span>
            <small>Global Access</small>
          </div>
          <button className="internal-success-primary-action" type="button">
            <Plus size={16} />
            NEW DAA ENTRY
          </button>
          <nav aria-label="System administration">
            <button onClick={() => onNavigate("/internal/operations/commandcentre")} type="button">
              <LayoutDashboard size={18} />
              Dashboard
            </button>
            <button onClick={() => onNavigate("/internal/operations/ledger/chart-of-accounts")} type="button">
              <Database size={18} />
              DAA Registry
            </button>
            <button onClick={() => onNavigate("/internal/operations/audit")} type="button">
              <ShieldCheck size={18} />
              Compliance
            </button>
            <button onClick={() => onNavigate("/internal/operations/audit")} type="button">
              <Landmark size={18} />
              Treasury Audit
            </button>
            <button className="active" onClick={() => onNavigate("/internal/operations/admin/users")} type="button">
              <Users size={18} />
              User Management
            </button>
          </nav>
        </aside>

        <main className="internal-success-main">
          <section className="internal-success-content">
            <button
              className="internal-success-back"
              onClick={() => onNavigate("/internal/operations/admin/users")}
              type="button"
            >
              <ArrowLeft size={16} />
              Back to Directory
            </button>

            <div className="internal-success-heading">
              <span><CheckCircle2 size={18} /> Provisioning Completed</span>
              <h1>Internal User Successfully Onboarded</h1>
              <p>
                Identity provisioning has been completed. The user profile is now registered in the Global
                Trade Treasury registry and awaits activation via secure credentials.
              </p>
            </div>

            <section className="internal-success-summary" aria-label="User summary">
              <InfoItem label="Full Name" value={displayName} />
              <InfoItem label="Institutional Email" value={email} />
              <InfoItem label="Assigned Role" value={roleName} />
              <div>
                <span>Clearance Level</span>
                <strong className="internal-success-clearance">
                  <Shield size={16} />
                  {getClearanceLevel(roleCode)}
                </strong>
              </div>
            </section>

            <section className="internal-success-invitation" aria-label="Activation invitation">
              <span>One-Time Activation Link</span>
              <div>
                <code>{activationLink}</code>
                <button onClick={() => copyToClipboard(activationLink)} title="Copy link" type="button">
                  <Copy size={18} />
                </button>
              </div>
              {copied && <small className="internal-success-copy-state">Copied to clipboard</small>}
              <p>Invitation Lifecycle: This credential set will expire in 48 hours if not initialized.</p>
              {emailDelivery && (
                <p>
                  Email Delivery: {emailDelivery.sent ? "Sent" : "Not sent"} via {emailDelivery.provider ?? "unknown"} ({emailDelivery.status ?? "unknown"}).
                  {emailDelivery.detail ? ` ${emailDelivery.detail}` : ""}
                </p>
              )}
            </section>

            <section className="internal-success-trace" aria-label="Provisioning traceability">
              <div>
                <span>Correlation ID</span>
                <code>7721-AC-990-2B</code>
              </div>
              <div>
                <span>Idempotency Key</span>
                <code>{idempotencyKey}</code>
              </div>
            </section>

            <div className="internal-success-actions">
              <button onClick={() => onNavigate("/internal/operations/admin/users/invite")} type="button">
                Provision Another User
              </button>
              <button onClick={() => onNavigate("/internal/operations/admin/users")} type="button">
                Return to User Management
              </button>
            </div>
          </section>

          <section className="internal-success-visual" aria-label="Internal operations visual">
            <img src={internalHouseImageUrl} alt="" />
            <div>
              <span>ACCESS TOKEN ISSUED</span>
              <strong>{roleName}</strong>
              <small>Activation required before first console session.</small>
            </div>
          </section>
        </main>
      </div>
      <InternalAdminFooter label="Onboarding success legal links" />
    </div>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
