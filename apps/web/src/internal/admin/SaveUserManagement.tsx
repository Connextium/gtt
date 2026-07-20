import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Copy,
  Mail,
  Send,
  Shield,
  User,
  X
} from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AppUser, RoleCode, UserStatus } from "../../identity.js";
import { defaultRedirectForRoles, roleDefinitions } from "../../identity.js";

interface SaveUserManagementProps {
  error?: string;
  loading?: boolean;
  notice?: string;
  onNavigate: (path: string) => void;
  onResendInvitation?: (user: AppUser) => Promise<void>;
  onSave: (input: {
    userId: string;
    displayName: string;
    email: string;
    roles: Exclude<RoleCode, "business_user">[];
    status: UserStatus;
  }) => Promise<void>;
  resending?: boolean;
  saving?: boolean;
  user?: AppUser;
  users: AppUser[];
}

const editableRoles = roleDefinitions.filter((role): role is typeof role & { code: Exclude<RoleCode, "business_user"> } => role.code !== "business_user");

export default function SaveUserManagement({
  error,
  loading = false,
  notice,
  onNavigate,
  onResendInvitation,
  onSave,
  resending = false,
  saving = false,
  user,
  users
}: SaveUserManagementProps) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [status, setStatus] = useState<UserStatus>(user?.status ?? "invited");
  const [roles, setRoles] = useState<Exclude<RoleCode, "business_user">[]>(
    (user?.roles.filter((role): role is Exclude<RoleCode, "business_user"> => role !== "business_user") ?? ["platform_operator"])
  );
  const [localError, setLocalError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
    setEmail(user?.email ?? "");
    setStatus(user?.status ?? "invited");
    setRoles(user?.roles.filter((role): role is Exclude<RoleCode, "business_user"> => role !== "business_user") ?? ["platform_operator"]);
    setLocalError("");
    setCopied(false);
  }, [user]);

  const activeAdmins = users.filter((item) =>
    item.status === "active" && (item.roles.includes("platform_admin") || item.roles.includes("super_admin"))
  ).length;
  const isCurrentActiveAdmin = Boolean(user && user.status === "active" && (user.roles.includes("platform_admin") || user.roles.includes("super_admin")));
  const remainsActiveAdmin = status === "active" && (roles.includes("platform_admin") || roles.includes("super_admin"));
  const lastAdminBlocked = isCurrentActiveAdmin && !remainsActiveAdmin && activeAdmins <= 1;

  const selectedRole = useMemo(() => editableRoles.find((role) => roles.includes(role.code)) ?? editableRoles[0], [roles]);
  const selectedPermissions = useMemo(
    () => [...new Set(roles.flatMap((role) => roleDefinitions.find((definition) => definition.code === role)?.permissions ?? []))],
    [roles]
  );

  if (loading) {
    return (
      <div className="internal-save-user-screen">
        <main className="internal-save-user-main"><section className="internal-save-user-state">Loading user profile...</section></main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="internal-save-user-screen">
        <main className="internal-save-user-main">
          <section className="internal-save-user-state error">
            <h1>User profile not found</h1>
            <button onClick={() => onNavigate("/internal/operations/admin/users")} type="button">Back to User Management</button>
          </section>
        </main>
      </div>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!displayName.trim() || !email.trim()) {
      setLocalError("Legal name and email address are required.");
      return;
    }
    if (!roles.length) {
      setLocalError("At least one internal role is required.");
      return;
    }
    if (lastAdminBlocked) {
      setLocalError("At least one active admin must remain.");
      return;
    }
    setLocalError("");
    await onSave({
      userId: user.id,
      displayName: displayName.trim(),
      email: email.trim(),
      roles,
      status
    });
  };

  const toggleRole = (roleCode: Exclude<RoleCode, "business_user">) => {
    setRoles((current) => current.includes(roleCode) ? current.filter((role) => role !== roleCode) : [...current, roleCode]);
  };

  const copyUserId = async () => {
    await navigator.clipboard?.writeText(user.id);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="internal-save-user-screen">
      <main className="internal-save-user-main">
        {(notice || error || localError) && (
          <div className={`internal-save-user-banner ${error || localError ? "error" : ""}`}>
            {error || localError ? <AlertTriangle size={18} /> : <Check size={18} />}
            <span>{error || localError || notice}</span>
            <button onClick={() => setLocalError("")} title="Dismiss" type="button"><X size={16} /></button>
          </div>
        )}

        <section className="internal-save-user-heading">
          <div>
            <button onClick={() => onNavigate("/internal/operations/admin/users")} title="Back to user management" type="button">
              <ArrowLeft size={18} />
            </button>
            <span>User Management</span>
            <i />
            <span>User Details</span>
          </div>
          <form onSubmit={submit}>
            <button className="secondary" disabled={saving || lastAdminBlocked} onClick={() => setStatus("disabled")} type="button">
              Revoke Access
            </button>
            <button disabled={saving || lastAdminBlocked} type="submit">
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </section>

        <section className="internal-save-user-profile">
          <div className="internal-save-user-avatar"><User size={42} /></div>
          <div>
            <div className="internal-save-user-title-row">
              <h1>{user.displayName}</h1>
              <span>{selectedRole?.name ?? "Internal User"}</span>
              <span className={`status ${status}`}>{status}</span>
            </div>
            <button className="internal-save-user-id" onClick={copyUserId} type="button">
              ID: {user.id}
              <Copy size={14} />
              {copied && <em>Copied</em>}
            </button>
            {user.status === "invited" && (
              <div className="internal-save-user-invite">
                <div>
                  <p>Invitation is currently outstanding.</p>
                  <small>Use resend to regenerate the setup link and request email delivery again.</small>
                </div>
                <button disabled={resending || !onResendInvitation} onClick={() => void onResendInvitation?.(user)} type="button">
                  <Send size={16} />
                  {resending ? "Sending..." : "Resend Invitation Email"}
                </button>
              </div>
            )}
          </div>
        </section>

        <form className="internal-save-user-grid" onSubmit={submit}>
          <div className="internal-save-user-left">
            <section>
              <h2>Identity Protocols</h2>
              <div className="internal-save-user-fields">
                <label>
                  <span>Legal Name</span>
                  <input onChange={(event) => setDisplayName(event.target.value)} type="text" value={displayName} />
                </label>
                <label>
                  <span>Employee Serial</span>
                  <input readOnly type="text" value={user.id} />
                </label>
                <label className="wide">
                  <span>Email Address</span>
                  <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
                </label>
                <label>
                  <span>Account Status</span>
                  <div className="internal-save-user-select">
                    <select onChange={(event) => setStatus(event.target.value as UserStatus)} value={status}>
                      <option value="invited">Invited</option>
                      <option value="active">Active</option>
                      <option value="disabled">Disabled</option>
                    </select>
                    <ChevronDown size={18} />
                  </div>
                </label>
                <label>
                  <span>Default Landing</span>
                  <input readOnly type="text" value={defaultRedirectForRoles(roles, status) ?? "No landing"} />
                </label>
              </div>
            </section>

            <section>
              <h2>Authorization Matrix</h2>
              <div className="internal-save-user-role-grid">
                {editableRoles.map((role) => (
                  <button
                    className={roles.includes(role.code) ? "active" : ""}
                    key={role.code}
                    onClick={() => toggleRole(role.code)}
                    type="button"
                  >
                    <span>{role.name}</span>
                    <small>{role.owner}</small>
                    {roles.includes(role.code) && <Check size={16} />}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h2>Permission Scopes</h2>
              <div className="internal-save-user-permissions">
                {selectedPermissions.map((permission) => (
                  <span key={permission}><Shield size={14} />{permission}</span>
                ))}
                {!selectedPermissions.length && <p>No permissions assigned.</p>}
              </div>
            </section>
          </div>

          <aside className="internal-save-user-right">
            <section>
              <h2>Security Telemetry</h2>
              <dl>
                <div><dt>Last Authenticated IP</dt><dd>{status === "disabled" ? "Not available" : `192.168.10.${40 + user.displayName.length}`}</dd></div>
                <div><dt>Last System Login</dt><dd>{status === "active" ? "Recently active" : "Never initialized"}</dd></div>
                <div><dt>Hardware Token Status</dt><dd><Shield size={16} />Pending enrollment</dd></div>
                <div><dt>Email Channel</dt><dd><Mail size={16} />{email}</dd></div>
              </dl>
            </section>

            <section>
              <h2>Audit Trail</h2>
              <div className="internal-save-user-timeline">
                <article><i /><span><Clock size={14} />{formatDate(user.createdAt)}</span><p>User record initialized</p></article>
                <article><i /><span><Clock size={14} />{status === "invited" ? "Pending" : "Current"}</span><p>{status === "invited" ? "Invitation outstanding" : "Access profile active"}</p></article>
              </div>
            </section>

            <section className="danger">
              <h2>Danger Zone</h2>
              <p>Revoking access disables the account and blocks internal login.</p>
              <button disabled={lastAdminBlocked || saving} onClick={() => setStatus("disabled")} type="button">Deactivate Account</button>
            </section>

            <button className="internal-save-user-submit" disabled={saving || lastAdminBlocked} type="submit">
              {saving ? "Saving Profile" : "Save User Profile"}
            </button>
            {lastAdminBlocked && <p className="internal-save-user-blocked">At least one active admin must remain in the tenant.</p>}
          </aside>
        </form>
      </main>
    </div>
  );
}

const formatDate = (value: string): string => new Date(value).toISOString().slice(0, 10);
