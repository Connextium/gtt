import {
  Activity,
  ArrowLeft,
  ArrowRightLeft,
  Badge,
  Bell,
  ChevronDown,
  Database,
  Info,
  Key,
  Landmark,
  Mail,
  Settings,
  Shield,
  ShieldCheck,
  User,
  UserPlus,
  Wallet
} from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import type { RoleCode } from "../../identity.js";
import InternalAdminFooter from "./InternalAdminFooter.js";

export interface InternalProvisionInviteResult {
  duplicate: boolean;
  initializationUrl?: string;
  setupToken?: string;
  emailDelivery?: {
    sent: boolean;
    provider: string;
    status: string;
    detail?: string;
    initializationUrl?: string;
  };
}

export default function ProvisionUser({
  onNavigate,
  onInvite
}: {
  onNavigate: (path: string) => void;
  onInvite: (input: {
    email: string;
    displayName: string;
    roleCode: Exclude<RoleCode, "business_user" | "super_admin">;
    idempotencyKey: string;
  }) => Promise<InternalProvisionInviteResult>;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleCode, setRoleCode] = useState<Exclude<RoleCode, "business_user" | "super_admin">>("platform_operator");
  const [idempotencyKey] = useState(() => `invite-${Date.now()}`);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [ledgerChecked, setLedgerChecked] = useState(true);
  const [apiKeyChecked, setApiKeyChecked] = useState(false);
  const [approvalChecked, setApprovalChecked] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!fullName.trim() || !email.trim()) {
      setError("Full name and email are required.");
      return;
    }

    setSubmitting(true);
    setError("");
    let result: InternalProvisionInviteResult;
    try {
      result = await onInvite({
        email,
        displayName: fullName,
        roleCode,
        idempotencyKey
      });
    } catch (error) {
      setSubmitting(false);
      setError(error instanceof Error ? error.message : "Unable to provision internal user.");
      return;
    }

    if (result.duplicate) {
      setSubmitting(false);
      setError("Duplicate invitation with this idempotency key.");
      return;
    }

    window.history.pushState(
      {
        email,
        displayName: fullName,
        roleCode,
        idempotencyKey,
        token: result.setupToken,
        activationLink: result.initializationUrl ?? result.emailDelivery?.initializationUrl,
        emailDelivery: result.emailDelivery
      },
      "",
      "/internal/operations/admin/users/invite/success"
    );
    onNavigate("/internal/operations/admin/users/invite/success");
  };

  return (
    <div className="internal-provision-screen">
      <aside className="internal-provision-sidebar">
        <div className="internal-provision-sidebar-brand">
          <span>Global Trade Treasury</span>
          <small>Terminal ID: 8842-X</small>
        </div>
        <nav className="internal-provision-nav" aria-label="Provision user navigation">
          <button onClick={() => onNavigate("/internal/operations/commandcentre")} type="button"><Landmark size={20} />Accounts</button>
          <button type="button"><Badge size={20} />Trade Ledgers</button>
          <button type="button"><ArrowRightLeft size={20} />Netting</button>
          <button type="button"><Wallet size={20} />Treasury</button>
          <button className="active" onClick={() => onNavigate("/internal/operations/admin/users")} type="button"><Activity size={20} />Analytics</button>
        </nav>
        <div className="internal-provision-user">
          <div><User size={20} /></div>
          <span><strong>Admin Shell</strong><small>Super User</small></span>
        </div>
      </aside>

      <main className="internal-provision-main">
        <header className="internal-provision-topbar">
          <div>
            <button onClick={() => onNavigate("/internal/operations/admin/users")} title="Back to user management" type="button">
              <ArrowLeft size={20} />
            </button>
            <h1>Identity & Access Management</h1>
          </div>
          <div>
            <input placeholder="Search Directory..." />
            <button title="Notifications" type="button"><Bell size={18} /></button>
            <button title="Settings" type="button"><Settings size={18} /></button>
          </div>
        </header>

        <div className="internal-provision-content">
          <section className="internal-provision-card">
            <header className="internal-provision-card-head">
              <div>
                <span>Administrative Action</span>
                <h2>Provision New User</h2>
                <p>Onboard a new institutional operator or platform administrator. Access keys and invitation links will be generated upon completion of this form.</p>
              </div>
              <div><UserPlus size={48} /></div>
            </header>

            <form className="internal-provision-form" onSubmit={handleSubmit}>
              <SectionTitle index="01" title="Identity Details" />
              <label>
                Full Name
                <input
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="e.g. Julian Montgomery"
                  required
                  type="text"
                  value={fullName}
                />
              </label>
              <label>
                Institutional Email
                <input
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="j.montgomery@globaltrade.com"
                  required
                  type="email"
                  value={email}
                />
              </label>

              <SectionTitle index="02" title="Institutional Role" />
              <label className="wide">
                Role Assignment
                <span className="internal-provision-select">
                  <select
                    onChange={(event) => setRoleCode(event.target.value as Exclude<RoleCode, "business_user" | "super_admin">)}
                    value={roleCode}
                  >
                    <option value="platform_admin">Platform Admin</option>
                    <option value="platform_operator">Platform Operator</option>
                    <option value="treasury_operator">Treasury Operator</option>
                    <option value="auditor">Auditor</option>
                  </select>
                  <ChevronDown size={20} />
                </span>
                <small>Roles define baseline access. Scopes below provide granular task-based permissions.</small>
              </label>

              <SectionTitle index="03" title="Permission Scopes" />
              <div className="internal-provision-scopes">
                <PermissionScope
                  checked={ledgerChecked}
                  description="Ability to view and commit transactions to the global trade ledgers."
                  icon={Database}
                  label="Ledger Read/Write"
                  onChange={setLedgerChecked}
                />
                <PermissionScope
                  checked={apiKeyChecked}
                  description="Required for developers and automated treasury integration systems."
                  icon={Key}
                  label="API Key Management"
                  onChange={setApiKeyChecked}
                />
                <PermissionScope
                  checked={approvalChecked}
                  description="Authorized to review and approve new client onboarding applications."
                  icon={ShieldCheck}
                  label="Client Approval"
                  onChange={setApprovalChecked}
                />
              </div>

              {error && <div className="internal-provision-error">{error}</div>}

              <footer className="internal-provision-actions">
                <div><Info size={18} /><span>All actions are logged for regulatory compliance.</span></div>
                <div>
                  <button onClick={() => onNavigate("/internal/operations/admin/users")} type="button">Save Draft</button>
                  <button disabled={submitting} type="submit">
                    {submitting ? "Provisioning..." : "Generate Invitation & Provision Access"}
                  </button>
                </div>
              </footer>
            </form>
          </section>

          <section className="internal-provision-info-grid">
            <InfoCard icon={Shield} title="Audit Logging">
              Provisioning a user creates an immutable record in the System Operations Ledger. This includes the timestamp, authorizing admin, and the specific permission set granted.
            </InfoCard>
            <InfoCard icon={Mail} title="Invitation Lifecycle">
              Invitations expire after 48 hours. Users must complete a mandatory two-factor authentication setup during their initial login to activate their institutional account.
            </InfoCard>
          </section>
        </div>

        <InternalAdminFooter label="Provision user legal links" />
      </main>
    </div>
  );
}

const SectionTitle = ({ index, title }: { index: string; title: string }) => (
  <h3 className="internal-provision-section-title">{index}. {title}</h3>
);

const PermissionScope = ({
  checked,
  description,
  icon: Icon,
  label,
  onChange
}: {
  checked: boolean;
  description: string;
  icon: typeof Database;
  label: string;
  onChange: (checked: boolean) => void;
}) => (
  <label className={`internal-provision-scope ${checked ? "selected" : ""}`}>
    <span>
      <Icon size={20} />
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </span>
    <strong>{label}</strong>
    <small>{description}</small>
  </label>
);

const InfoCard = ({
  children,
  icon: Icon,
  title
}: {
  children: string;
  icon: typeof Shield;
  title: string;
}) => (
  <article>
    <h4><Icon size={16} />{title}</h4>
    <p>{children}</p>
  </article>
);
