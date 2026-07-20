import type { ApiState, InternalAccessSecret, InternalUserInvitation, RoleCode, RoleRecord, UserRoleAssignment } from "../data.js";
import { postgresUrlFromEnv } from "./connection.js";
import { getPostgresPool, withPostgresTransaction, type PostgresClient } from "./transaction.js";

const roleIds: Record<RoleCode, string> = {
  business_user: "00000000-0000-4000-8000-000000000004",
  platform_admin: "00000000-0000-4000-8000-000000000005",
  platform_operator: "00000000-0000-4000-8000-000000000001",
  treasury_operator: "00000000-0000-4000-8000-000000000002",
  auditor: "00000000-0000-4000-8000-000000000003",
  super_admin: "00000000-0000-4000-8000-000000000006"
};

const identityPaths = new Set([
  "/admin/bootstrap/super-admin",
  "/admin/users/invitations",
  "/internal-access/initialize"
]);

export const shouldPersistInternalIdentity = (pathname: string): boolean =>
  identityPaths.has(pathname) ||
  /^\/admin\/users\/[^/]+(\/(roles|status|invitation\/resend))?$/.test(pathname);

export const shouldRefreshInternalIdentity = (pathname: string): boolean =>
  shouldPersistInternalIdentity(pathname) ||
  pathname === "/internal-access/login" ||
  pathname === "/admin/users" ||
  pathname.startsWith("/admin/users/");

export const refreshInternalIdentityStateFromTables = async (state: ApiState): Promise<boolean> => {
  if (postgresUrlFromEnv()) {
    await refreshInternalIdentityStateWithPostgres(state);
    return true;
  }
  return false;
};

export const listInternalUsersFromIdentityTables = async (): Promise<Array<ApiState["appUsers"][number] & { roles: RoleCode[] }> | undefined> => {
  if (postgresUrlFromEnv()) return listInternalUsersWithPostgres();
  return undefined;
};

export const persistInternalIdentityTables = async (state: ApiState, pathname: string): Promise<void> => {
  if (!shouldPersistInternalIdentity(pathname)) return;
  if (postgresUrlFromEnv()) {
    await persistWithPostgres(state);
    return;
  }
  throw new Error("direct_database_url_required");
};

const listInternalUsersWithPostgres = async (): Promise<Array<ApiState["appUsers"][number] & { roles: RoleCode[] }>> => {
  const pool = getPostgresPool();
  if (!pool) return [];

  await repairInvitationOnlyInternalUsersWithPostgres(pool);

  const result = await pool.query<{
    id: string;
    platform_tenant_id: string;
    auth_user_id: string | null;
    email: string;
    display_name: string;
    user_type: ApiState["appUsers"][number]["userType"];
    status: ApiState["appUsers"][number]["status"];
    created_at: Date | string;
    updated_at: Date | string;
    roles: RoleCode[] | null;
  }>(`
    select
      users.id,
      users.platform_tenant_id,
      users.auth_user_id,
      users.email,
      users.display_name,
      users.user_type,
      users.status,
      users.created_at,
      users.updated_at,
      coalesce(array_agg(roles.role_code order by roles.role_code) filter (where roles.role_code is not null), '{}') as roles
    from app_users users
    left join user_role_assignments assignments on assignments.user_id = users.id
    left join roles on roles.id = assignments.role_id
    where users.user_type = 'internal_user'
    group by users.id
    order by users.created_at desc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.platform_tenant_id,
    authUserId: row.auth_user_id ?? "",
    email: row.email,
    displayName: row.display_name,
    userType: row.user_type,
    status: row.status,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    roles: (row.roles ?? []).filter(isRoleCode)
  }));
};

const repairInvitationOnlyInternalUsersWithPostgres = async (client: Pick<PostgresClient, "query">): Promise<void> => {
  await client.query(`
    with ranked_invitations as (
      select
        invitations.id as invitation_id,
        invitations.platform_tenant_id,
        invitations.supabase_user_id,
        lower(invitations.email) as email,
        invitations.display_name,
        invitations.role_code,
        invitations.invited_by_user_id,
        coalesce(invitations.invited_at, invitations.created_at) as assigned_at,
        invitations.created_at,
        invitations.updated_at
      from internal_user_invitations invitations
      where invitations.status = 'sent'
        and invitations.role_code <> 'business_user'
        and not exists (
          select 1
          from app_users users
          where lower(users.email) = lower(invitations.email)
            and users.user_type = 'internal_user'
        )
    ),
    candidates as (
      select distinct on (email) *
      from ranked_invitations
      order by email, created_at desc
    ),
    inserted_users as (
      insert into app_users (
        id,
        platform_tenant_id,
        auth_user_id,
        email,
        display_name,
        user_type,
        status,
        created_at,
        updated_at
      )
      select
        gen_random_uuid(),
        candidates.platform_tenant_id,
        candidates.supabase_user_id,
        candidates.email,
        candidates.display_name,
        'internal_user',
        'invited',
        candidates.created_at,
        candidates.updated_at
      from candidates
      on conflict (email) do nothing
      returning id, email
    ),
    inserted_assignments as (
      insert into user_role_assignments (user_id, role_id, assigned_by_user_id, assigned_at)
      select
        inserted_users.id,
        roles.id,
        case
          when exists (select 1 from app_users inviters where inviters.id = candidates.invited_by_user_id)
            then candidates.invited_by_user_id
          else null
        end,
        candidates.assigned_at
      from inserted_users
      join candidates on candidates.email = inserted_users.email
      join roles on roles.role_code = candidates.role_code
      on conflict (user_id, role_id) do nothing
      returning user_id
    ),
    secret_candidates as (
      select matching_secrets.id as secret_id, inserted_users.id as user_id
      from inserted_users
      join candidates on candidates.email = inserted_users.email
      join lateral (
        select secrets.id
        from internal_access_secrets secrets
        where secrets.user_id is null
          and (
            secrets.invitation_id = candidates.invitation_id
            or (secrets.invitation_id is null and secrets.email = inserted_users.email)
          )
        order by secrets.created_at desc
        limit 1
      ) matching_secrets on true
    )
    update internal_access_secrets secrets
       set user_id = secret_candidates.user_id,
           updated_at = now()
      from secret_candidates
     where secrets.id = secret_candidates.secret_id
  `);
};

const refreshInternalIdentityStateWithPostgres = async (state: ApiState): Promise<void> => {
  const pool = getPostgresPool();
  if (!pool) return;

  const [roles, users, assignments, invitations, secrets] = await Promise.all([
    pool.query<RoleRow>("select id, role_code, role_name from roles order by role_code"),
    pool.query<AppUserRow>(`
      select id, platform_tenant_id, auth_user_id, email, display_name, user_type, status, created_at, updated_at
      from app_users
      order by created_at desc
    `),
    pool.query<AssignmentRow>(`
      select user_id, role_id, assigned_by_user_id, assigned_at
      from user_role_assignments
    `),
    pool.query<InvitationRow>(`
      select id, platform_tenant_id, email, display_name, role_code, status, supabase_user_id, idempotency_key, invited_by_user_id, invited_at, accepted_at, expires_at, created_at, updated_at
      from internal_user_invitations
      order by created_at desc
    `),
    pool.query<SecretRow>(`
      select user_id, invitation_id, email, setup_token_hash, password_hash, initialized_at, created_at, updated_at
      from internal_access_secrets
    `)
  ]);

  state.roles = roles.rows.map(roleFromRow);
  state.appUsers = users.rows.map(appUserFromRow);
  state.userRoleAssignments = assignments.rows.map(assignmentFromRow);
  state.internalUserInvitations = invitations.rows.map(invitationFromRow);
  state.internalAccessSecrets = secrets.rows.map(secretFromRow);
};

const persistWithPostgres = async (state: ApiState): Promise<void> => {
  await withPostgresTransaction(async (client) => {
    await ensureRoleCodeConstraintAllowsSuperAdminForTest(client);
    for (const tenantId of tenantIdsForPersistence(state)) {
      await client.query(
        `insert into platform_tenants (id, tenant_name)
         values ($1, 'Demo Tenant')
         on conflict (id) do nothing`,
        [tenantId]
      );
    }
    for (const role of state.roles.filter((item) => roleIds[item.roleCode])) {
      await client.query(
        `insert into roles (id, role_code, role_name)
         values ($1, $2, $3)
         on conflict (role_code) do update set role_name = excluded.role_name`,
        [roleIds[role.roleCode], role.roleCode, role.roleName]
      );
    }
    for (const user of state.appUsers.filter(isPersistableUuidUser)) {
      await client.query(
        `insert into app_users (id, platform_tenant_id, auth_user_id, email, display_name, user_type, status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do update set
           auth_user_id = excluded.auth_user_id,
           email = excluded.email,
           display_name = excluded.display_name,
           user_type = excluded.user_type,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        [user.id, user.tenantId, user.authUserId, user.email, user.displayName, user.userType, user.status, user.createdAt, user.updatedAt]
      );
    }
    const persistedUserIds = state.appUsers.filter(isPersistableUuidUser).map((user) => user.id);
    if (persistedUserIds.length) {
      await client.query("delete from user_role_assignments where user_id = any($1::uuid[])", [persistedUserIds]);
    }
    for (const assignment of state.userRoleAssignments.filter((item) => isUuid(item.userId))) {
      const roleCode = state.roles.find((role) => role.id === assignment.roleId)?.roleCode;
      const roleId = assignment.roleId.startsWith("role_") ? roleIds[roleCode ?? "business_user"] : assignment.roleId;
      await client.query(
        `insert into user_role_assignments (user_id, role_id, assigned_by_user_id, assigned_at)
         values ($1, $2, $3, $4)
         on conflict (user_id, role_id) do update set assigned_by_user_id = excluded.assigned_by_user_id, assigned_at = excluded.assigned_at`,
        [assignment.userId, roleId, isUuid(assignment.assignedByUserId) ? assignment.assignedByUserId : null, assignment.assignedAt]
      );
    }
    for (const invitation of state.internalUserInvitations) await upsertInvitation(client, invitation);
    for (const secret of state.internalAccessSecrets) await upsertSecret(client, secret);
  });
};

export const ensureRoleCodeConstraintAllowsSuperAdminForTest = async (client: Pick<PostgresClient, "query">): Promise<void> => {
  await client.query(`
    do $$
    begin
      if exists (
        select 1 from pg_constraint where conname = 'roles_role_code_check'
      ) then
        alter table roles drop constraint roles_role_code_check;
      end if;
    end;
    $$;
  `);
  await client.query(`
    alter table roles
      add constraint roles_role_code_check
      check (role_code in ('business_user', 'super_admin', 'platform_admin', 'platform_operator', 'treasury_operator', 'auditor'))
  `);
};

const upsertInvitation = async (client: Pick<PostgresClient, "query">, invitation: InternalUserInvitation): Promise<void> => {
  const row = invitationRow(invitation);
  await client.query(
    `insert into internal_user_invitations
      (id, platform_tenant_id, email, display_name, role_code, status, supabase_user_id, idempotency_key, invited_by_user_id, invited_at, accepted_at, expires_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (idempotency_key) do update set
       email = excluded.email,
       display_name = excluded.display_name,
       role_code = excluded.role_code,
       status = excluded.status,
       supabase_user_id = excluded.supabase_user_id,
       invited_at = excluded.invited_at,
       accepted_at = excluded.accepted_at,
       expires_at = excluded.expires_at,
       updated_at = excluded.updated_at`,
    [
      row.id,
      row.platform_tenant_id,
      row.email,
      row.display_name,
      row.role_code,
      row.status,
      row.supabase_user_id,
      row.idempotency_key,
      row.invited_by_user_id,
      row.invited_at,
      row.accepted_at,
      row.expires_at,
      row.created_at,
      row.updated_at
    ]
  );
};

const upsertSecret = async (client: Pick<PostgresClient, "query">, secret: InternalAccessSecret): Promise<void> => {
  const row = secretRow(secret);
  if (!row.invitation_id && !row.user_id) return;
  const existing = await client.query<{ id: string }>(
    `select id from internal_access_secrets
      where ($1::uuid is not null and invitation_id = $1::uuid)
         or ($2::uuid is not null and user_id = $2::uuid)
      limit 1`,
    [row.invitation_id, row.user_id]
  );
  if (existing.rows[0]?.id) {
    await client.query(
      `update internal_access_secrets
          set user_id = $2,
              invitation_id = $3,
              email = $4,
              setup_token_hash = $5,
              password_hash = $6,
              initialized_at = $7,
              updated_at = $8
        where id = $1`,
      [existing.rows[0].id, row.user_id, row.invitation_id, row.email, row.setup_token_hash, row.password_hash, row.initialized_at, row.updated_at]
    );
    return;
  }
  await client.query(
    `insert into internal_access_secrets
      (user_id, invitation_id, email, setup_token_hash, password_hash, initialized_at, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [row.user_id, row.invitation_id, row.email, row.setup_token_hash, row.password_hash, row.initialized_at, row.created_at, row.updated_at]
  );
};

const invitationRow = (invitation: InternalUserInvitation) => ({
  id: invitation.id,
  platform_tenant_id: invitation.tenantId,
  email: invitation.email,
  display_name: invitation.displayName,
  role_code: invitation.roleCode,
  status: invitation.status,
  supabase_user_id: isUuid(invitation.supabaseUserId) ? invitation.supabaseUserId : null,
  idempotency_key: invitation.idempotencyKey,
  invited_by_user_id: isUuid(invitation.invitedByUserId) ? invitation.invitedByUserId : null,
  invited_at: invitation.invitedAt,
  accepted_at: invitation.acceptedAt ?? null,
  expires_at: invitation.expiresAt,
  created_at: invitation.createdAt,
  updated_at: invitation.updatedAt
});

const secretRow = (secret: InternalAccessSecret) => ({
  user_id: isUuid(secret.userId) ? secret.userId : null,
  invitation_id: isUuid(secret.invitationId) ? secret.invitationId : null,
  email: secret.email ?? null,
  setup_token_hash: secret.setupTokenHash ?? null,
  password_hash: secret.passwordHash ?? null,
  initialized_at: secret.initializedAt ?? null,
  created_at: secret.createdAt,
  updated_at: secret.updatedAt
});

interface RoleRow {
  id: string;
  role_code: RoleCode;
  role_name: string;
}

interface AppUserRow {
  id: string;
  platform_tenant_id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string;
  user_type: ApiState["appUsers"][number]["userType"];
  status: ApiState["appUsers"][number]["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface AssignmentRow {
  user_id: string;
  role_id: string;
  assigned_by_user_id: string | null;
  assigned_at: Date | string;
}

interface InvitationRow {
  id: string;
  platform_tenant_id: string;
  email: string;
  display_name: string;
  role_code: Exclude<RoleCode, "business_user">;
  status: InternalUserInvitation["status"];
  supabase_user_id: string | null;
  idempotency_key: string;
  invited_by_user_id: string | null;
  invited_at: Date | string | null;
  accepted_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SecretRow {
  user_id: string | null;
  invitation_id: string | null;
  email: string | null;
  setup_token_hash: string | null;
  password_hash: string | null;
  initialized_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const roleFromRow = (row: RoleRow): RoleRecord => ({
  id: row.id,
  roleCode: row.role_code,
  roleName: row.role_name
});

const appUserFromRow = (row: AppUserRow): ApiState["appUsers"][number] => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  authUserId: row.auth_user_id ?? "",
  email: row.email,
  displayName: row.display_name,
  userType: row.user_type,
  status: row.status,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const assignmentFromRow = (row: AssignmentRow): UserRoleAssignment => ({
  userId: row.user_id,
  roleId: row.role_id,
  assignedByUserId: row.assigned_by_user_id ?? "system",
  assignedAt: toIsoString(row.assigned_at)
});

const invitationFromRow = (row: InvitationRow): InternalUserInvitation => ({
  id: row.id,
  tenantId: row.platform_tenant_id,
  email: row.email,
  displayName: row.display_name,
  roleCode: row.role_code,
  status: row.status,
  supabaseUserId: row.supabase_user_id ?? undefined,
  idempotencyKey: row.idempotency_key,
  invitedByUserId: row.invited_by_user_id ?? "system",
  invitedAt: toIsoString(row.invited_at ?? row.created_at),
  acceptedAt: row.accepted_at ? toIsoString(row.accepted_at) : undefined,
  expiresAt: toIsoString(row.expires_at ?? row.updated_at),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const secretFromRow = (row: SecretRow): InternalAccessSecret => ({
  userId: row.user_id ?? undefined,
  invitationId: row.invitation_id ?? undefined,
  email: row.email ?? undefined,
  setupTokenHash: row.setup_token_hash ?? undefined,
  passwordHash: row.password_hash ?? undefined,
  initializedAt: row.initialized_at ? toIsoString(row.initialized_at) : undefined,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

const isPersistableUuidUser = (user: ApiState["appUsers"][number]): boolean =>
  isUuid(user.id) && isUuid(user.tenantId) && isUuid(user.authUserId);

const tenantIdsForPersistence = (state: ApiState): string[] => {
  const tenantIds = new Set<string>();
  for (const invitation of state.internalUserInvitations) {
    if (isUuid(invitation.tenantId)) tenantIds.add(invitation.tenantId);
  }
  for (const user of state.appUsers) {
    if (isUuid(user.tenantId)) tenantIds.add(user.tenantId);
  }
  if (!tenantIds.size) tenantIds.add(process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001");
  return [...tenantIds];
};

const isUuid = (value?: string | null): value is string =>
  Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));

const isRoleCode = (value: unknown): value is RoleCode =>
  typeof value === "string" && ["business_user", "super_admin", "platform_admin", "platform_operator", "treasury_operator", "auditor"].includes(value);

const toIsoString = (value: Date | string): string => value instanceof Date ? value.toISOString() : value;
