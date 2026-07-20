export type UserType = "business_user" | "internal_user";
export type UserStatus = "invited" | "active" | "disabled";
export type RoleCode = "business_user" | "super_admin" | "platform_admin" | "platform_operator" | "treasury_operator" | "auditor";

export interface AppUser {
  id: string;
  authUserId: string;
  tenantId: string;
  email: string;
  displayName: string;
  userType: UserType;
  status: UserStatus;
  roles: RoleCode[];
  lastInvitedAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface InternalUserInvitation {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  roleCode: Exclude<RoleCode, "business_user">;
  status: "sent" | "accepted" | "expired" | "cancelled";
  idempotencyKey: string;
  invitedByUserId: string;
  invitedAt: string;
  expiresAt: string;
}

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  owner: string;
  permissions: string[];
  landing: string;
}

export const rolePriority: RoleCode[] = [
  "super_admin",
  "platform_admin",
  "platform_operator",
  "treasury_operator",
  "auditor",
  "business_user"
];

export const roleDefinitions: RoleDefinition[] = [
  {
    code: "super_admin",
    name: "Super Admin",
    owner: "Infrastructure",
    permissions: ["users:bootstrap", "users:invite", "users:write", "api_keys:write", "tenant:write", "tenant:read"],
    landing: "/internal/operations/commandcentre"
  },
  {
    code: "platform_admin",
    name: "Platform Admin",
    owner: "Platform Admin",
    permissions: ["users:invite", "users:write", "api_keys:write", "tenant:read"],
    landing: "/internal/operations/commandcentre"
  },
  {
    code: "platform_operator",
    name: "Platform Operator",
    owner: "Platform Admin",
    permissions: ["clients:write", "adas:write", "onboarding:review"],
    landing: "/internal/operations/business-clients"
  },
  {
    code: "treasury_operator",
    name: "Treasury Operator",
    owner: "Platform Admin",
    permissions: ["ledger:read", "ledger:write", "statements:read"],
    landing: "/internal/operations/ledger/chart-of-accounts"
  },
  {
    code: "auditor",
    name: "Auditor",
    owner: "Platform Admin",
    permissions: ["audit:read", "events:read", "statements:read"],
    landing: "/internal/operations/audit"
  },
  {
    code: "business_user",
    name: "Business User",
    owner: "Business Client",
    permissions: ["onboarding:own"],
    landing: "/onboarding/step-1"
  }
];

export const initialUsers: AppUser[] = [
  {
    id: "user_admin",
    authUserId: "auth_admin",
    tenantId: "tenant_demo",
    email: "admin@gtt.example",
    displayName: "Mira Tan",
    userType: "internal_user",
    status: "active",
    roles: ["platform_admin"],
    lastInvitedAt: "2026-07-12T10:00:00.000Z",
    createdAt: "2026-07-12T10:00:00.000Z"
  },
  {
    id: "user_ops",
    authUserId: "auth_ops",
    tenantId: "tenant_demo",
    email: "ops@gtt.example",
    displayName: "Noah Pierce",
    userType: "internal_user",
    status: "active",
    roles: ["platform_operator"],
    lastInvitedAt: "2026-07-13T11:30:00.000Z",
    createdAt: "2026-07-13T11:30:00.000Z"
  },
  {
    id: "user_treasury",
    authUserId: "auth_treasury",
    tenantId: "tenant_demo",
    email: "treasury@gtt.example",
    displayName: "Priya Shah",
    userType: "internal_user",
    status: "active",
    roles: ["treasury_operator"],
    lastInvitedAt: "2026-07-14T09:45:00.000Z",
    createdAt: "2026-07-14T09:45:00.000Z"
  },
  {
    id: "user_auditor",
    authUserId: "auth_auditor",
    tenantId: "tenant_demo",
    email: "auditor@gtt.example",
    displayName: "Ellis Grant",
    userType: "internal_user",
    status: "active",
    roles: ["auditor"],
    lastInvitedAt: "2026-07-15T16:10:00.000Z",
    createdAt: "2026-07-15T16:10:00.000Z"
  },
  {
    id: "user_disabled",
    authUserId: "auth_disabled",
    tenantId: "tenant_demo",
    email: "disabled@gtt.example",
    displayName: "Former Operator",
    userType: "internal_user",
    status: "disabled",
    roles: ["platform_operator"],
    createdAt: "2026-07-11T13:20:00.000Z"
  },
  {
    id: "user_business",
    authUserId: "auth_business",
    tenantId: "tenant_demo",
    email: "client@example.com",
    displayName: "Client Applicant",
    userType: "business_user",
    status: "active",
    roles: ["business_user"],
    createdAt: "2026-07-16T08:00:00.000Z"
  }
];

export const getRoleDefinition = (role: RoleCode): RoleDefinition => {
  return roleDefinitions.find((item) => item.code === role)!;
};

export const defaultRedirectForRoles = (roles: RoleCode[], status: UserStatus): string | undefined => {
  if (status === "disabled") return undefined;
  const selected = rolePriority.find((role) => roles.includes(role));
  return selected ? getRoleDefinition(selected).landing : undefined;
};

export const canAccessOperations = (user: AppUser | undefined): boolean => {
  return Boolean(user && user.status === "active" && user.userType === "internal_user");
};
