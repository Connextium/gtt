import { UserPlus, Users } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { PanelHeader, StatusBadge, SummaryLine } from "../panel.js";
import {
  defaultRedirectForRoles,
  getRoleDefinition,
  roleDefinitions,
  type AppUser,
  type InternalUserInvitation,
  type RoleCode
} from "../../identity.js";
import AdminUsers from "./UserManagement.js";
import InviteUser from "./ProvisionUser.js";
import OnboardingSuccess from "./OnboardingSuccess.js";

export { AdminUsers, InviteUser, OnboardingSuccess };

export const FoundationLanding = ({
  users,
  invitations,
  navigate
}: {
  users: AppUser[];
  invitations: InternalUserInvitation[];
  navigate: (path: string) => void;
}) => (
  <section className="dashboard-grid identity-grid">
    <div className="panel">
      <PanelHeader title="Identity readiness" meta="Sprint 1-2" />
      <div className="identity-kpi-grid">
        <SummaryLine label="Active internal users" value={String(users.filter((user) => user.userType === "internal_user" && user.status === "active").length)} />
        <SummaryLine label="Pending invitations" value={String(invitations.filter((invite) => invite.status === "sent").length)} />
        <SummaryLine label="Assignable roles" value={String(roleDefinitions.filter((role) => role.code !== "business_user").length)} />
        <SummaryLine label="Business boundary" value="Public self-registration only" />
      </div>
      <div className="panel-actions">
        <button className="action-button primary" onClick={() => navigate("/internal/operations/admin/users/invite")} type="button">
          <UserPlus size={16} />
          Invite user
        </button>
        <button className="action-button" onClick={() => navigate("/internal/operations/admin/users")} type="button">
          <Users size={16} />
          Manage users
        </button>
      </div>
    </div>
    <RoleCatalog compact />
  </section>
);



export const UserDetail = ({
  user,
  users,
  onRolesChange,
  onStatusChange
}: {
  user?: AppUser;
  users: AppUser[];
  onRolesChange: (userId: string, roles: RoleCode[]) => void;
  onStatusChange: (userId: string, status: AppUser["status"]) => void;
}) => {
  const [roles, setRoles] = useState<RoleCode[]>(user?.roles ?? []);
  const activeAdmins = users.filter((item) => item.status === "active" && item.roles.includes("platform_admin")).length;
  if (!user) return <section className="panel"><PanelHeader title="User not found" meta="Admin" /></section>;
  const disableBlocked = user.status === "active" && user.roles.includes("platform_admin") && activeAdmins <= 1;

  const toggleRole = (role: RoleCode) => {
    setRoles((current) => current.includes(role) ? current.filter((item) => item !== role) : [...current, role]);
  };

  return (
    <section className="dashboard-grid identity-grid">
      <div className="panel">
        <PanelHeader title={user.displayName} meta={user.email} />
        <div className="detail-grid">
          <SummaryLine label="Tenant" value={user.tenantId} />
          <SummaryLine label="User type" value={user.userType} />
          <SummaryLine label="Status" value={user.status} />
          <SummaryLine label="Created" value={formatDate(user.createdAt)} />
        </div>
        <div className="role-checklist">
          {roleDefinitions.map((role) => (
            <label key={role.code}>
              <input checked={roles.includes(role.code)} disabled={user.status === "disabled"} onChange={() => toggleRole(role.code)} type="checkbox" />
              <span>{role.name}</span>
            </label>
          ))}
        </div>
        <div className="panel-actions">
          <button className="action-button primary" disabled={user.status === "disabled" || roles.length === 0} onClick={() => onRolesChange(user.id, roles)} type="button">Save roles</button>
          <button className="action-button" disabled={disableBlocked} onClick={() => onStatusChange(user.id, user.status === "disabled" ? "active" : "disabled")} type="button">
            {user.status === "disabled" ? "Reactivate" : "Disable"}
          </button>
        </div>
        {disableBlocked && <div className="form-notice">At least one active Platform Admin must remain in the tenant.</div>}
      </div>
      <div className="panel">
        <PanelHeader title="Audit trail" meta="Recent" />
        <div className="summary-stack">
          <SummaryLine label="Profile created" value={formatDate(user.createdAt)} />
          <SummaryLine label="Role owner" value="Platform Admin" />
          <SummaryLine label="Default landing" value={defaultRedirectForRoles(user.roles, user.status) ?? "No redirect"} />
        </div>
      </div>
    </section>
  );
};

export const RoleCatalog = ({ compact = false }: { compact?: boolean }) => (
  <section className={compact ? "panel compact-panel" : "panel"}>
    <PanelHeader title="Role catalog" meta={`${roleDefinitions.length} roles`} />
    <div className="role-catalog">
      {roleDefinitions.map((role) => (
        <article key={role.code}>
          <div>
            <strong>{role.name}</strong>
            <StatusBadge label={role.owner} tone={role.code === "business_user" ? "neutral" : "ready"} />
          </div>
          <span>{role.landing}</span>
          <p>{role.permissions.join(", ")}</p>
        </article>
      ))}
    </div>
  </section>
);

export const ActorLanding = ({ actor }: { actor: Exclude<RoleCode, "business_user" | "super_admin"> }) => {
  const role = getRoleDefinition(actor);
  return (
    <section className="panel">
      <PanelHeader title={role.name} meta={role.owner} />
      <div className="identity-kpi-grid">
        <SummaryLine label="Default landing" value={role.landing} />
        <SummaryLine label="Access mode" value={actor === "auditor" ? "Read-only" : "Operational"} />
        <SummaryLine label="Permissions" value={String(role.permissions.length)} />
        <SummaryLine label="Tenant" value="tenant_demo" />
      </div>
      <div className="role-catalog">
        {role.permissions.map((permission) => (
          <article key={permission}>
            <div><strong>{permission}</strong><StatusBadge label={actor === "auditor" ? "Read" : "Enabled"} tone="ready" /></div>
            <span>{role.name}</span>
          </article>
        ))}
      </div>
    </section>
  );
};

const SelectFilter = ({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }) => (
  <label>
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {values.map((item) => <option key={item} value={item}>{item}</option>)}
    </select>
  </label>
);

const formatDate = (value: string): string => new Date(value).toISOString().slice(0, 10);
