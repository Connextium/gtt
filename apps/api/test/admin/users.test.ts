import assert from "node:assert/strict";
import test from "node:test";
import { createInitialState, type ApiState, type RoleCode } from "../../src/data.js";
import { handleApiRequest } from "../../src/http/router.js";

test("auth me returns role priority redirect and permissions", async () => {
  const state = createInitialState();

  const result = await handleApiRequest(state, {
    method: "GET",
    pathname: "/auth/me",
    headers: { "x-dev-auth-email": "treasury@gtt.example" }
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as { redirectTo: string }).redirectTo, "/internal/operations/ledger/chart-of-accounts");
  assert.deepEqual((result.body as { user: { roles: string[] } }).user.roles, ["treasury_operator"]);
});

const rolesForTestUser = (state: ApiState, userId: string): RoleCode[] =>
  state.userRoleAssignments
    .filter((assignment) => assignment.userId === userId)
    .map((assignment) => state.roles.find((role) => role.id === assignment.roleId)?.roleCode)
    .filter((roleCode): roleCode is RoleCode => Boolean(roleCode));

test("disabled users do not receive an operations redirect", async () => {
  const state = createInitialState();
  await handleApiRequest(state, {
    method: "PATCH",
    pathname: "/admin/users/user_treasury/status",
    body: { status: "disabled" }
  });

  const result = await handleApiRequest(state, {
    method: "GET",
    pathname: "/auth/me",
    headers: { "x-dev-auth-email": "treasury@gtt.example" }
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as { redirectTo?: string }).redirectTo, undefined);
  assert.deepEqual((result.body as { permissions: string[] }).permissions, []);
});

test("internal user invitation creates setup invitation and is idempotent", async () => {
  const state = createInitialState();

  const first = await handleApiRequest(state, {
    method: "POST",
    pathname: "/admin/users/invitations",
    body: {
      email: "new.operator@gtt.example",
      displayName: "New Operator",
      roleCode: "platform_operator",
      idempotencyKey: "invite-new-operator"
    }
  });
  const second = await handleApiRequest(state, {
    method: "POST",
    pathname: "/admin/users/invitations",
    body: {
      email: "new.operator@gtt.example",
      displayName: "New Operator",
      roleCode: "platform_operator",
      idempotencyKey: "invite-new-operator"
    }
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((second.body as { duplicate: boolean }).duplicate, true);
  assert.equal(state.internalUserInvitations.length, 1);
  assert.equal(state.internalAccessSecrets.length, 1);
  assert.match((first.body as { initializationUrl: string }).initializationUrl, /\/internal\/access\/init/);
  const provisionedUser = state.appUsers.find((user) => user.email === "new.operator@gtt.example");
  assert.equal(provisionedUser?.status, "invited");
  assert.equal(provisionedUser?.displayName, "New Operator");
  assert.deepEqual(provisionedUser ? rolesForTestUser(state, provisionedUser.id) : [], ["platform_operator"]);
});

test("internal invitation rejects business user role", async () => {
  const state = createInitialState();

  const result = await handleApiRequest(state, {
    method: "POST",
    pathname: "/admin/users/invitations",
    body: {
      email: "client-role@gtt.example",
      displayName: "Client Role",
      roleCode: "business_user",
      idempotencyKey: "invite-client-role"
    }
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "invalid_internal_role" });
});

test("admin can resend invitation email for invited internal user", async () => {
  const state = createInitialState();
  await handleApiRequest(state, {
    method: "POST",
    pathname: "/admin/users/invitations",
    body: {
      email: "resend.operator@gtt.example",
      displayName: "Resend Operator",
      roleCode: "platform_operator",
      idempotencyKey: "invite-resend-operator"
    }
  });
  const user = state.appUsers.find((item) => item.email === "resend.operator@gtt.example");
  assert.ok(user);
  const originalSecretHash = state.internalAccessSecrets.find((item) => item.userId === user.id)?.setupTokenHash;

  const resend = await handleApiRequest(state, {
    method: "POST",
    pathname: `/admin/users/${user.id}/invitation/resend`,
    body: {
      internalAccessBaseUrl: "http://localhost:5173/internal/access/init"
    }
  });

  assert.equal(resend.status, 200);
  assert.match((resend.body as { initializationUrl: string }).initializationUrl, /\/internal\/access\/init/);
  assert.notEqual(state.internalAccessSecrets.find((item) => item.userId === user.id)?.setupTokenHash, originalSecretHash);
  assert.equal(state.internalUserInvitations.find((item) => item.email === "resend.operator@gtt.example")?.status, "sent");

  const setupToken = (resend.body as { setupToken: string }).setupToken;
  await handleApiRequest(state, {
    method: "POST",
    pathname: "/internal-access/initialize",
    body: {
      email: "resend.operator@gtt.example",
      setupToken,
      password: "SecureRoot!2026"
    }
  });
  const afterActivation = await handleApiRequest(state, {
    method: "POST",
    pathname: `/admin/users/${user.id}/invitation/resend`
  });
  assert.equal(afterActivation.status, 400);
  assert.deepEqual(afterActivation.body, { error: "internal_user_not_invited" });
});

test("admin can update internal user profile details", async () => {
  const state = createInitialState();
  await handleApiRequest(state, {
    method: "POST",
    pathname: "/admin/users/invitations",
    body: {
      email: "editable.operator@gtt.example",
      displayName: "Editable Operator",
      roleCode: "platform_operator",
      idempotencyKey: "invite-editable-operator"
    }
  });
  const user = state.appUsers.find((item) => item.email === "editable.operator@gtt.example");
  assert.ok(user);

  const result = await handleApiRequest(state, {
    method: "PATCH",
    pathname: `/admin/users/${user.id}`,
    body: {
      displayName: "Edited Operator",
      email: "edited.operator@gtt.example",
      status: "disabled",
      roles: ["auditor"]
    }
  });

  assert.equal(result.status, 200);
  assert.equal((result.body as { user: { displayName: string } }).user.displayName, "Edited Operator");
  assert.equal(state.appUsers.find((item) => item.id === user.id)?.email, "edited.operator@gtt.example");
  assert.equal(state.appUsers.find((item) => item.id === user.id)?.status, "disabled");
  assert.deepEqual(rolesForTestUser(state, user.id), ["auditor"]);
  assert.equal(state.internalUserInvitations.find((item) => item.idempotencyKey === "invite-editable-operator")?.email, "edited.operator@gtt.example");
});

test("last active platform admin cannot be disabled", async () => {
  const state = createInitialState();

  const result = await handleApiRequest(state, {
    method: "PATCH",
    pathname: "/admin/users/user_platform_admin/status",
    body: { status: "disabled" }
  });

  assert.equal(result.status, 400);
  assert.deepEqual(result.body, { error: "last_active_platform_admin_required" });
});

test("bootstrap endpoint provisions first super admin with setup link", async () => {
  const previous = process.env.GTT_BOOTSTRAP_TOKEN;
  process.env.GTT_BOOTSTRAP_TOKEN = "test-bootstrap-token";
  try {
    const state = createInitialState();
    const result = await handleApiRequest(state, {
      method: "POST",
      pathname: "/admin/bootstrap/super-admin",
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      body: {
        email: "root@gtt.example",
        displayName: "Root Admin",
        internalAccessBaseUrl: "http://localhost:5173/internal/access/init"
      }
    });

    assert.equal(result.status, 201);
    assert.equal((result.body as { identity: { roles: string[] } }).identity.roles.includes("super_admin"), true);
    assert.match((result.body as { initializationUrl: string }).initializationUrl, /\/internal\/access\/init/);
    assert.equal(state.internalAccessSecrets.length, 1);
    assert.equal(state.internalAccessSecrets[0]?.setupTokenHash === (result.body as { setupToken: string }).setupToken, false);
    assert.equal(state.appUsers.some((user) => user.email === "root@gtt.example"), false);
  } finally {
    if (previous === undefined) delete process.env.GTT_BOOTSTRAP_TOKEN;
    else process.env.GTT_BOOTSTRAP_TOKEN = previous;
  }
});

test("bootstrap endpoint rejects second super admin", async () => {
  const previous = process.env.GTT_BOOTSTRAP_TOKEN;
  process.env.GTT_BOOTSTRAP_TOKEN = "test-bootstrap-token";
  try {
    const state = createInitialState();
    await handleApiRequest(state, {
      method: "POST",
      pathname: "/admin/bootstrap/super-admin",
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      body: { email: "root@gtt.example" }
    });
    const second = await handleApiRequest(state, {
      method: "POST",
      pathname: "/admin/bootstrap/super-admin",
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      body: { email: "root2@gtt.example" }
    });

    assert.equal(second.status, 400);
    assert.deepEqual(second.body, { error: "super_admin_already_provisioned" });
  } finally {
    if (previous === undefined) delete process.env.GTT_BOOTSTRAP_TOKEN;
    else process.env.GTT_BOOTSTRAP_TOKEN = previous;
  }
});

test("internal access initialization activates invited internal user and login redirects", async () => {
  const previous = process.env.GTT_BOOTSTRAP_TOKEN;
  process.env.GTT_BOOTSTRAP_TOKEN = "test-bootstrap-token";
  try {
    const state = createInitialState();
    const bootstrap = await handleApiRequest(state, {
      method: "POST",
      pathname: "/admin/bootstrap/super-admin",
      headers: { "x-bootstrap-token": "test-bootstrap-token" },
      body: { email: "root@gtt.example" }
    });
    const setupToken = (bootstrap.body as { setupToken: string }).setupToken;

    const initialized = await handleApiRequest(state, {
      method: "POST",
      pathname: "/internal-access/initialize",
      body: {
        email: "root@gtt.example",
        setupToken,
        password: "SecureRoot!2026"
      }
    });
    const login = await handleApiRequest(state, {
      method: "POST",
      pathname: "/internal-access/login",
      body: {
        email: "root@gtt.example",
        password: "SecureRoot!2026"
      }
    });

    assert.equal(initialized.status, 200);
    assert.equal(state.appUsers.some((user) => user.email === "root@gtt.example" && user.status === "active"), true);
    const rootUser = state.appUsers.find((user) => user.email === "root@gtt.example");
    assert.match(rootUser?.id ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(rootUser?.authUserId ?? "", /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(state.internalUserInvitations.find((item) => item.email === "root@gtt.example")?.status, "accepted");
    assert.equal(login.status, 200);
    assert.equal((login.body as { redirectTo: string }).redirectTo, "/internal/operations/commandcentre");
  } finally {
    if (previous === undefined) delete process.env.GTT_BOOTSTRAP_TOKEN;
    else process.env.GTT_BOOTSTRAP_TOKEN = previous;
  }
});
