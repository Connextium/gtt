import { ListFilter, Mail, MoreVertical, Plus, Search, TrendingUp } from "lucide-react";
import { useState } from "react";
import type { AppUser, RoleCode } from "../../identity.js";
import InternalAdminFooter from "./InternalAdminFooter.js";

interface UserManagementProps {
  error?: string;
  loading?: boolean;
  notice?: string;
  onResendInvitation?: (user: AppUser) => Promise<void>;
  resendingUserId?: string;
  users: AppUser[];
  navigate: (path: string) => void;
}

export default function UserManagement(props: UserManagementProps) {
  return (
    <div className="internal-users-screen">
      <main className="internal-users-main">
        <InternalUsersContent {...props} />
      </main>
      <InternalAdminFooter label="Internal user management legal links" />
    </div>
  );
}

export const InternalUsersContent = ({
  error,
  loading = false,
  notice,
  onResendInvitation,
  resendingUserId,
  users,
  navigate
}: UserManagementProps) => {
  const [searchQuery, setSearchQuery] = useState("");

  const internalUsers = users.filter((user) => user.userType === "internal_user");
  const filteredUsers = internalUsers.filter((user) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      user.displayName.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query) ||
      user.id.toLowerCase().includes(query) ||
      user.roles.some((role) => role.toLowerCase().includes(query))
    );
  });

  const activeCount = internalUsers.filter((user) => user.status === "active").length;
  const adminCount = internalUsers.filter((user) => user.roles.includes("super_admin") || user.roles.includes("platform_admin")).length;
  const operatorCount = internalUsers.filter((user) => user.roles.includes("platform_operator") || user.roles.includes("treasury_operator")).length;
  const auditorCount = internalUsers.filter((user) => user.roles.includes("auditor")).length;
  const totalCount = internalUsers.length;

  return (
    <>
      <section className="internal-users-hero">
        <div>
          <h1>Internal Users</h1>
          <p>Manage platform access, role assignments, and security protocols for internal treasury personnel.</p>
        </div>
        <button onClick={() => navigate("/internal/operations/admin/users/invite")} type="button">
          <Plus size={16} />
          Add New Internal User
        </button>
      </section>

      <section className="internal-users-metrics" aria-label="Internal user metrics">
        <MetricCard label="Total Active Users" value={String(activeCount)} progress={totalCount ? (activeCount / totalCount) * 100 : 0} />
        <RoleDistribution admin={adminCount} operator={operatorCount} auditor={auditorCount} />
        <article>
          <span>Avg. Login Frequency</span>
          <strong>1.4h</strong>
          <p><TrendingUp size={15} />+12% vs last week</p>
        </article>
      </section>

      <section className="internal-users-table-card">
        <div className="internal-users-table-toolbar">
          <label>
            <Search size={17} />
            <input
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by name, role, or ID..."
              type="search"
              value={searchQuery}
            />
          </label>
          <button type="button"><ListFilter size={16} />Filter</button>
        </div>
        {notice && <div className="internal-users-table-notice">{notice}</div>}

        <div className="internal-users-table-wrap">
          <table>
            <thead>
              <tr>
                <th>User Name / ID</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Used IP</th>
                <th>Created At</th>
                <th>Last Login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td className="internal-users-state-cell" colSpan={7}>Loading internal users from database...</td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td className="internal-users-state-cell error" colSpan={7}>Unable to retrieve internal users: {error}</td>
                </tr>
              )}
              {!loading && !error && filteredUsers.length === 0 && (
                <tr>
                  <td className="internal-users-state-cell" colSpan={7}>No internal users found in the database.</td>
                </tr>
              )}
              {!loading && !error && filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="internal-users-identity">
                      <div>{getInitials(user.displayName)}</div>
                      <span>
                        <strong>{user.displayName}</strong>
                        <small>{user.id} · {user.email}</small>
                      </span>
                    </div>
                  </td>
                  <td><span className="internal-users-role">{getRoleBadge(user.roles)}</span></td>
                  <td>
                    <span className={`internal-users-status ${user.status}`}>
                      <i />
                      {user.status}
                    </span>
                  </td>
                  <td>{user.status === "disabled" ? "—" : `192.168.1.${100 + user.displayName.length}`}</td>
                  <td>{formatDate(user.createdAt)}</td>
                  <td>{user.status === "active" ? "Recently active" : "—"}</td>
                  <td>
                    <div className="internal-users-row-actions">
                      {user.status === "invited" && onResendInvitation && (
                        <button
                          className="internal-users-row-action"
                          disabled={resendingUserId === user.id}
                          onClick={() => void onResendInvitation(user)}
                          title="Resend invitation email"
                          type="button"
                        >
                          <Mail size={17} />
                        </button>
                      )}
                      <button
                        className="internal-users-row-action"
                        onClick={() => navigate(`/internal/operations/admin/users/${user.id}`)}
                        title="Open user detail"
                        type="button"
                      >
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="internal-users-table-footer">
          <span>Showing {filteredUsers.length} of {totalCount} entries</span>
          <div>
            <button disabled type="button">Prev</button>
            <button type="button">Next</button>
          </div>
        </footer>
      </section>
    </>
  );
};

const MetricCard = ({ label, value, progress }: { label: string; value: string; progress: number }) => (
  <article>
    <span>{label}</span>
    <strong>{value}</strong>
    <div className="internal-users-progress"><i style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} /></div>
  </article>
);

const RoleDistribution = ({ admin, operator, auditor }: { admin: number; operator: number; auditor: number }) => {
  const max = Math.max(admin, operator, auditor, 1);
  return (
    <article>
      <span>Role Distribution</span>
      <div className="internal-users-bars">
        <i style={{ height: `${Math.max(12, (admin / max) * 100)}%` }} />
        <i style={{ height: `${Math.max(12, (operator / max) * 100)}%` }} />
        <i style={{ height: `${Math.max(12, (auditor / max) * 100)}%` }} />
      </div>
      <div className="internal-users-bar-labels"><span>ADM</span><span>OPR</span><span>AUD</span></div>
    </article>
  );
};

const getInitials = (name: string): string =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

const getRoleBadge = (roles: RoleCode[]): string => {
  if (roles.includes("super_admin")) return "Super Admin";
  if (roles.includes("platform_admin")) return "Admin";
  if (roles.includes("platform_operator")) return "Operator";
  if (roles.includes("treasury_operator")) return "Treasury";
  if (roles.includes("auditor")) return "Auditor";
  return "User";
};

const formatDate = (value: string): string => new Date(value).toISOString().slice(0, 10);
