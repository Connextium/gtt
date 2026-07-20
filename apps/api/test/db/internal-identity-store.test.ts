import assert from "node:assert/strict";
import test from "node:test";
import { ensureRoleCodeConstraintAllowsSuperAdminForTest, listInternalUsersFromIdentityTables, refreshInternalIdentityStateFromTables } from "../../src/db/internal-identity-store.js";
import { setPostgresPoolForTest } from "../../src/db/transaction.js";
import { createInitialState } from "../../src/data.js";

test("internal identity persistence updates role constraint to allow super admin", async () => {
  const sql: string[] = [];
  const client = {
    query: async (text: string) => {
      sql.push(text);
      return { rows: [] };
    }
  };

  await ensureRoleCodeConstraintAllowsSuperAdminForTest(client);

  assert.equal(sql.some((statement) => statement.includes("drop constraint roles_role_code_check")), true);
  assert.equal(sql.some((statement) => statement.includes("'super_admin'")), true);
});

test("database identity refresh clears stale in-memory provisioned users after database reset", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://unit-test";
  const state = createInitialState();
  state.appUsers.push({
    id: "00000000-0000-4000-8000-000000000201",
    tenantId: "00000000-0000-4000-8000-000000000001",
    authUserId: "00000000-0000-4000-8000-000000000202",
    email: "stale.admin@gtt.example",
    displayName: "Stale Admin",
    userType: "internal_user",
    status: "active",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z"
  });
  state.internalUserInvitations.push({
    id: "00000000-0000-4000-8000-000000000203",
    tenantId: "00000000-0000-4000-8000-000000000001",
    email: "stale.admin@gtt.example",
    displayName: "Stale Admin",
    roleCode: "platform_admin",
    status: "sent",
    idempotencyKey: "stale-invite",
    invitedByUserId: "00000000-0000-4000-8000-000000000201",
    invitedAt: "2026-07-20T10:00:00.000Z",
    expiresAt: "2026-07-21T10:00:00.000Z",
    createdAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-20T10:00:00.000Z"
  });
  setPostgresPoolForTest({
    query: async (text: string) => {
      if (text.includes("from roles")) {
        return { rows: [{ id: "00000000-0000-4000-8000-000000000005", role_code: "platform_admin", role_name: "Platform Admin" }] };
      }
      return { rows: [] };
    }
  } as never);

  try {
    await refreshInternalIdentityStateFromTables(state);
    assert.equal(state.appUsers.some((user) => user.email === "stale.admin@gtt.example"), false);
    assert.equal(state.internalUserInvitations.some((invite) => invite.idempotencyKey === "stale-invite"), false);
    assert.equal(state.userRoleAssignments.length, 0);
    assert.equal(state.internalAccessSecrets.length, 0);
    assert.deepEqual(state.roles.map((role) => role.roleCode), ["platform_admin"]);
  } finally {
    setPostgresPoolForTest(undefined);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("internal user list is read from identity tables when postgres is configured", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://unit-test";
  const sql: string[] = [];
  setPostgresPoolForTest({
    query: async (text: string) => {
      sql.push(text);
      if (!text.includes("from app_users users")) return { rows: [] };
      return {
        rows: [
          {
            id: "00000000-0000-4000-8000-000000000101",
            platform_tenant_id: "00000000-0000-4000-8000-000000000001",
            auth_user_id: "00000000-0000-4000-8000-000000000102",
            email: "root@gtt.example",
            display_name: "Root Admin",
            user_type: "internal_user",
            status: "active",
            created_at: new Date("2026-07-20T10:00:00.000Z"),
            updated_at: new Date("2026-07-20T10:00:00.000Z"),
            roles: ["super_admin"]
          }
        ]
      };
    }
  } as never);

  try {
    const users = await listInternalUsersFromIdentityTables();
    assert.equal(users?.length, 1);
    assert.equal(users?.[0]?.email, "root@gtt.example");
    assert.deepEqual(users?.[0]?.roles, ["super_admin"]);
    assert.equal(users?.[0]?.createdAt, "2026-07-20T10:00:00.000Z");
    assert.equal(sql.some((statement) => statement.includes("from internal_user_invitations invitations")), true);
    assert.equal(sql.some((statement) => statement.includes("where users.user_type = 'internal_user'")), true);
  } finally {
    setPostgresPoolForTest(undefined);
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
