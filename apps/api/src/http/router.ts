import { createHash, randomBytes, randomUUID } from "node:crypto";
import { publicApiKey, type ApiScope } from "../auth/index.js";
import { invokeCircle, verifyCircleWebhook } from "../modules/circle/index.js";
import {
  handleGetOrCreateMyOnboarding,
  handleSaveMyOnboardingStep,
  handleSelfRegistrationInvitation,
  handleSubmitMyOnboarding
} from "../modules/client-onboarding/index.js";
import { checkDatabaseConnection } from "../db/connection.js";
import { listApiKeysFromState, listApiKeysFromTables } from "../db/api-key-store.js";
import {
  decideBusinessOnboardingApplication,
  getBusinessOnboardingApplication,
  listBusinessOnboardingApplications,
  type BusinessOnboardingReviewActionType
} from "../db/business-onboarding-review-store.js";
import { listInternalUsersFromIdentityTables } from "../db/internal-identity-store.js";
import { getSupabaseClient } from "../db/transaction.js";
import { stateStoreStatus } from "../db/state-store.js";
import {
  createApiClientAndKey,
  dailyClose,
  emitAudit,
  emitOutbox,
  newId,
  releaseReadiness,
  toMinorUnits,
  trialBalance,
  type ApiState,
  type AppUser,
  type InternalUserInvitation,
  type RoleCode
} from "../data.js";
import { applicationManifest, health } from "../index.js";
import { badRequest, notFound, type JsonResponse } from "./index.js";

export interface RouteInput {
  method: string;
  pathname: string;
  body?: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
}

export const routeMetadata = (method: string, pathname: string): { public?: boolean; requiredScopes?: ApiScope[] } => {
  if (method === "GET" && ["/health", "/manifest", "/version", "/readiness"].includes(pathname)) return { public: true };
  if (method === "POST" && pathname === "/webhooks/circle") return { public: true };
  if (method === "POST" && pathname === "/auth/invitations") return { public: true };
  if (method === "GET" && pathname === "/auth/me") return { public: true };
  if (method === "POST" && pathname === "/admin/bootstrap/super-admin") return { public: true };
  if (method === "POST" && ["/internal-access/initialize", "/internal-access/login"].includes(pathname)) return { public: true };
  if (pathname === "/onboarding/me" || pathname.startsWith("/onboarding/me/")) return { public: true };
  if (pathname.startsWith("/api-keys")) return { requiredScopes: ["admin:api-keys"] };
  if (pathname.startsWith("/admin/business-onboarding")) return { requiredScopes: method === "GET" ? ["read:operations"] : ["write:clients"] };
  if (pathname.startsWith("/admin/users") || pathname === "/admin/roles") return { requiredScopes: ["admin:users"] };
  if (method === "GET") return { requiredScopes: ["read:operations"] };
  if (pathname.includes("reconciliation")) return { requiredScopes: ["write:reconciliation"] };
  if (pathname.includes("liquidity-rebalancing")) return { requiredScopes: ["write:rebalancing"] };
  if (pathname.includes("payment") || pathname.includes("/fiat/")) return { requiredScopes: ["write:payments"] };
  if (pathname.includes("obligation")) return { requiredScopes: ["write:obligations"] };
  if (pathname.includes("reservation")) return { requiredScopes: ["write:reservations"] };
  if (pathname.includes("ledger")) return { requiredScopes: ["write:ledger"] };
  if (pathname.includes("accounts-of-digital-asset")) return { requiredScopes: ["write:accounts"] };
  if (pathname.includes("business-clients")) return { requiredScopes: ["write:clients"] };
  if (pathname.includes("release-readiness")) return { requiredScopes: ["write:release-readiness"] };
  return { requiredScopes: ["read:operations"] };
};

export const handleApiRequest = async (state: ApiState, input: RouteInput): Promise<JsonResponse> => {
  const { method, pathname, body = {} } = input;

  if (method === "GET" && pathname === "/health") return ok(health());
  if (method === "GET" && pathname === "/manifest") return ok(applicationManifest());
  if (method === "GET" && pathname === "/version") return ok({ version: "0.1.0-full-api-foundation" });
  if (method === "GET" && pathname === "/readiness") {
    const database = await checkDatabaseConnection();
    return ok({
      status: database.configured && !database.connected ? "degraded" : "ready",
      database,
      stateStore: stateStoreStatus,
      circleMode: process.env.CIRCLE_ENVIRONMENT ?? "simulator"
    });
  }

  if (method === "POST" && pathname === "/auth/invitations") {
    return handleSelfRegistrationInvitation(state, {
      email: body.email,
      headers: input.headers
    });
  }
  if (method === "POST" && pathname === "/admin/bootstrap/super-admin") {
    return handleBootstrapSuperAdmin(state, body, input.headers ?? {});
  }
  if (method === "POST" && pathname === "/internal-access/initialize") {
    return handleInternalAccessInitialize(state, body);
  }
  if (method === "POST" && pathname === "/internal-access/login") {
    return handleInternalAccessLogin(state, body);
  }
  if (method === "GET" && pathname === "/auth/me") {
    return handleAuthMe(state, input.headers ?? {});
  }
  if (method === "GET" && pathname === "/onboarding/me") {
    return handleGetOrCreateMyOnboarding(state, input.headers ?? {});
  }
  const onboardingStepMatch = pathname.match(/^\/onboarding\/me\/steps\/([^/]+)$/);
  if ((method === "POST" || method === "PATCH") && onboardingStepMatch) {
    return handleSaveMyOnboardingStep(state, {
      headers: input.headers ?? {},
      stepKey: onboardingStepMatch[1]!,
      payload: body.payload
    });
  }
  if (method === "POST" && pathname === "/onboarding/me/submit") {
    return handleSubmitMyOnboarding(state, input.headers ?? {});
  }

  if (method === "POST" && pathname === "/api-keys") {
    return created(createApiClientAndKey(state, {
      clientName: stringBody(body, "clientName", "API Client"),
      scopes: arrayBody(body, "scopes") as ApiScope[],
      expiresAt: optionalStringBody(body, "expiresAt")
    }));
  }
  if (method === "GET" && pathname === "/api-keys") {
    const databaseKeys = await listApiKeysFromTables();
    return ok({ keys: databaseKeys ?? listApiKeysFromState(state) });
  }

  if (method === "GET" && pathname === "/admin/roles") return ok({ roles: state.roles });
  if (method === "GET" && pathname === "/admin/business-onboarding/applications") {
    return ok({ applications: await listBusinessOnboardingApplications(state) });
  }
  const adminOnboardingMatch = pathname.match(/^\/admin\/business-onboarding\/applications\/([^/]+)$/);
  if (method === "GET" && adminOnboardingMatch) {
    const application = await getBusinessOnboardingApplication(state, decodeURIComponent(adminOnboardingMatch[1]!));
    return application ? ok({ application }) : notFound(pathname);
  }
  const adminOnboardingActionMatch = pathname.match(/^\/admin\/business-onboarding\/applications\/([^/]+)\/(approve|reject|request-info)$/);
  if (method === "POST" && adminOnboardingActionMatch) {
    const action = reviewActionFromRoute(adminOnboardingActionMatch[2]!);
    if (!action) return badRequest("invalid_review_action");
    const application = await decideBusinessOnboardingApplication(state, {
      action,
      actorEmail: optionalStringBody(body, "actorEmail"),
      applicationId: decodeURIComponent(adminOnboardingActionMatch[1]!),
      note: optionalStringBody(body, "note"),
      requestedFields: (arrayBody(body, "requestedFields") ?? []).map(String)
    });
    return application ? ok({ application }) : notFound(pathname);
  }
  if (method === "GET" && pathname === "/admin/users") {
    const databaseUsers = await listInternalUsersFromIdentityTables();
    return ok({ users: databaseUsers ?? state.appUsers.map((user) => userWithRoles(state, user)) });
  }
  if (method === "POST" && pathname === "/admin/users/invitations") {
    const roleCode = stringBody(body, "roleCode") as RoleCode;
    if (!roleCode || roleCode === "business_user" || roleCode === "super_admin" || !state.roles.some((role) => role.roleCode === roleCode)) return badRequest("invalid_internal_role");
    const idempotencyKey = stringBody(body, "idempotencyKey");
    if (!idempotencyKey) return badRequest("idempotency_key_required");
    const email = stringBody(body, "email").trim().toLowerCase();
    if (!email) return badRequest("email_required");
    const duplicate = state.internalUserInvitations.find((item) => item.idempotencyKey === idempotencyKey);
    if (duplicate) return ok({ invitation: duplicate, duplicate: true });
    const existingInternalUser = state.appUsers.find((item) => item.email === email && item.userType === "internal_user");
    if (existingInternalUser && existingInternalUser.status !== "invited") return badRequest("internal_user_already_exists");

    const invitedAt = new Date().toISOString();
    const setupToken = randomBytes(32).toString("base64url");
    const provisionedUser = existingInternalUser ?? {
      id: randomUUID(),
      tenantId: persistentTenantId(state),
      authUserId: randomUUID(),
      email,
      displayName: stringBody(body, "displayName", email),
      userType: "internal_user" as const,
      status: "invited" as const,
      createdAt: invitedAt,
      updatedAt: invitedAt
    };
    if (!existingInternalUser) state.appUsers.push(provisionedUser);
    else {
      existingInternalUser.displayName = stringBody(body, "displayName", existingInternalUser.displayName);
      existingInternalUser.updatedAt = invitedAt;
    }
    assignRoles(state, provisionedUser.id, [roleCode], stringBody(body, "invitedByUserId", "user_platform_admin"));
    const invitation = {
      id: randomUUID(),
      tenantId: provisionedUser.tenantId,
      email,
      displayName: provisionedUser.displayName,
      roleCode: roleCode as Exclude<RoleCode, "business_user">,
      status: "sent" as const,
      supabaseUserId: provisionedUser.authUserId,
      idempotencyKey,
      invitedByUserId: stringBody(body, "invitedByUserId", "user_platform_admin"),
      invitedAt,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      createdAt: invitedAt,
      updatedAt: invitedAt
    };
    state.internalUserInvitations.push(invitation);
    state.internalAccessSecrets.push({
      userId: provisionedUser.id,
      invitationId: invitation.id,
      email,
      setupTokenHash: hashSecret(setupToken),
      createdAt: invitedAt,
      updatedAt: invitedAt
    });
    emitAudit(state, {
      eventType: "internal_user.invited",
      requestPath: pathname,
      requestMethod: method,
      correlationId: idempotencyKey
    });
    const baseUrl = stringBody(body, "internalAccessBaseUrl", process.env.INTERNAL_OPERATION_BASE_URL ?? "http://localhost:5173/internal/access/init");
    const initializationUrl = `${baseUrl}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(setupToken)}`;
    const emailDelivery = await sendInternalInvitationEmail({
      email,
      displayName: invitation.displayName,
      initializationUrl,
      invitationId: invitation.id,
      roleCode: invitation.roleCode
    });
    if (emailDelivery.supabaseUserId && isUuid(emailDelivery.supabaseUserId)) {
      provisionedUser.authUserId = emailDelivery.supabaseUserId;
      provisionedUser.updatedAt = new Date().toISOString();
      invitation.supabaseUserId = emailDelivery.supabaseUserId;
      invitation.updatedAt = provisionedUser.updatedAt;
    }
    emitAudit(state, {
      eventType: emailDelivery.sent ? "internal_user.invitation_email.sent" : "internal_user.invitation_email.dev_queued",
      requestPath: pathname,
      requestMethod: method,
      correlationId: idempotencyKey
    });
    return created({ invitation, user: userWithRoles(state, provisionedUser), setupToken, initializationUrl, emailDelivery });
  }
  const resendInternalInvitationMatch = pathname.match(/^\/admin\/users\/([^/]+)\/invitation\/resend$/);
  if (method === "POST" && resendInternalInvitationMatch) {
    const user = requireItem(state.appUsers, resendInternalInvitationMatch[1]!, "app_user_not_found");
    if (user.userType !== "internal_user") return badRequest("internal_user_required");
    if (user.status !== "invited") return badRequest("internal_user_not_invited");
    const roles = rolesForUser(state, user.id).filter((role): role is Exclude<RoleCode, "business_user"> => role !== "business_user");
    const roleCode = roles.find((role) => role !== "super_admin") ?? roles[0];
    if (!roleCode) return badRequest("internal_user_role_required");

    const now = new Date().toISOString();
    const setupToken = randomBytes(32).toString("base64url");
    let invitation = state.internalUserInvitations
      .filter((item) => item.email === user.email && item.status === "sent")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

    if (!invitation) {
      invitation = {
        id: randomUUID(),
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        roleCode,
        status: "sent",
        supabaseUserId: user.authUserId,
        idempotencyKey: `resend-${user.id}-${Date.now()}`,
        invitedByUserId: stringBody(body, "invitedByUserId", "user_platform_admin"),
        invitedAt: now,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
        createdAt: now,
        updatedAt: now
      };
      state.internalUserInvitations.push(invitation);
    } else {
      invitation.displayName = user.displayName;
      invitation.roleCode = roleCode;
      invitation.supabaseUserId = user.authUserId;
      invitation.invitedAt = now;
      invitation.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
      invitation.updatedAt = now;
    }

    const secret = state.internalAccessSecrets.find((item) => item.userId === user.id || item.invitationId === invitation.id || item.email === user.email);
    if (secret) {
      secret.userId = user.id;
      secret.invitationId = invitation.id;
      secret.email = user.email;
      secret.setupTokenHash = hashSecret(setupToken);
      secret.updatedAt = now;
    } else {
      state.internalAccessSecrets.push({
        userId: user.id,
        invitationId: invitation.id,
        email: user.email,
        setupTokenHash: hashSecret(setupToken),
        createdAt: now,
        updatedAt: now
      });
    }

    user.updatedAt = now;
    const baseUrl = stringBody(body, "internalAccessBaseUrl", process.env.INTERNAL_OPERATION_BASE_URL ?? "http://localhost:5173/internal/access/init");
    const initializationUrl = `${baseUrl}?email=${encodeURIComponent(user.email)}&token=${encodeURIComponent(setupToken)}`;
    const emailDelivery = await sendInternalInvitationEmail({
      email: user.email,
      displayName: user.displayName,
      initializationUrl,
      invitationId: invitation.id,
      roleCode
    });
    if (emailDelivery.supabaseUserId && isUuid(emailDelivery.supabaseUserId)) {
      user.authUserId = emailDelivery.supabaseUserId;
      user.updatedAt = new Date().toISOString();
      invitation.supabaseUserId = emailDelivery.supabaseUserId;
      invitation.updatedAt = user.updatedAt;
    }
    emitAudit(state, {
      eventType: emailDelivery.sent ? "internal_user.invitation_email.resent" : "internal_user.invitation_email.dev_requeued",
      requestPath: pathname,
      requestMethod: method,
      correlationId: invitation.idempotencyKey
    });
    return ok({ invitation, user: userWithRoles(state, user), setupToken, initializationUrl, emailDelivery });
  }
  const adminUserMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
  if (method === "GET" && adminUserMatch) return ok({ user: userWithRoles(state, requireItem(state.appUsers, adminUserMatch[1]!, "app_user_not_found")) });
  if (method === "PATCH" && adminUserMatch) {
    const user = requireItem(state.appUsers, adminUserMatch[1]!, "app_user_not_found");
    if (user.userType !== "internal_user") return badRequest("internal_user_required");
    const displayName = optionalStringBody(body, "displayName")?.trim();
    const email = optionalStringBody(body, "email")?.trim().toLowerCase();
    const status = optionalStringBody(body, "status") as AppUser["status"] | undefined;
    const roleCodes = arrayBody(body, "roles") as RoleCode[] | undefined;

    if (displayName !== undefined && !displayName) return badRequest("display_name_required");
    if (email !== undefined && !email) return badRequest("email_required");
    if (email && state.appUsers.some((item) => item.id !== user.id && item.email === email)) return badRequest("email_already_in_use");
    if (status !== undefined && !["invited", "active", "disabled"].includes(status)) return badRequest("invalid_user_status");
    if (roleCodes !== undefined) {
      if (!roleCodes.length) return badRequest("roles_required");
      if (roleCodes.some((roleCode) => roleCode === "business_user" || !state.roles.some((role) => role.roleCode === roleCode))) return badRequest("invalid_role");
    }
    const nextStatus = status ?? user.status;
    const nextRoles = roleCodes ?? rolesForUser(state, user.id);
    const currentlyActiveAdmin = user.status === "active" && (hasRole(state, user.id, "platform_admin") || hasRole(state, user.id, "super_admin"));
    const remainsActiveAdmin = nextStatus === "active" && (nextRoles.includes("platform_admin") || nextRoles.includes("super_admin"));
    if (currentlyActiveAdmin && !remainsActiveAdmin && activePlatformAdminCount(state) <= 1) {
      return badRequest("last_active_platform_admin_required");
    }

    const previousEmail = user.email;
    const now = new Date().toISOString();
    if (displayName !== undefined) user.displayName = displayName;
    if (email !== undefined) user.email = email;
    user.status = nextStatus;
    user.updatedAt = now;
    if (roleCodes !== undefined) assignRoles(state, user.id, roleCodes, stringBody(body, "updatedByUserId", "user_platform_admin"));
    for (const invitation of state.internalUserInvitations.filter((item) => item.email === previousEmail || item.email === user.email)) {
      invitation.email = user.email;
      invitation.displayName = user.displayName;
      invitation.updatedAt = now;
    }
    for (const secret of state.internalAccessSecrets.filter((item) => item.userId === user.id || item.email === previousEmail)) {
      secret.email = user.email;
      secret.updatedAt = now;
    }
    emitAudit(state, {
      eventType: "internal_user.updated",
      requestPath: pathname,
      requestMethod: method,
      correlationId: stringBody(body, "idempotencyKey", `update-${user.id}-${Date.now()}`)
    });
    return ok({ user: userWithRoles(state, user) });
  }
  const adminUserRolesMatch = pathname.match(/^\/admin\/users\/([^/]+)\/roles$/);
  if (method === "PATCH" && adminUserRolesMatch) {
    const user = requireItem(state.appUsers, adminUserRolesMatch[1]!, "app_user_not_found");
    if (user.status === "disabled") return badRequest("disabled_user_cannot_receive_roles");
    const roleCodes = arrayBody(body, "roles") as RoleCode[] | undefined;
    if (!roleCodes?.length) return badRequest("roles_required");
    if (roleCodes.some((roleCode) => !state.roles.some((role) => role.roleCode === roleCode))) return badRequest("invalid_role");
    assignRoles(state, user.id, roleCodes, stringBody(body, "assignedByUserId", "user_platform_admin"));
    user.updatedAt = new Date().toISOString();
    return ok({ user: userWithRoles(state, user) });
  }
  const adminUserStatusMatch = pathname.match(/^\/admin\/users\/([^/]+)\/status$/);
  if (method === "PATCH" && adminUserStatusMatch) {
    const user = requireItem(state.appUsers, adminUserStatusMatch[1]!, "app_user_not_found");
    const status = stringBody(body, "status") as AppUser["status"];
    if (!["invited", "active", "disabled"].includes(status)) return badRequest("invalid_user_status");
    if (status === "disabled" && hasRole(state, user.id, "platform_admin") && activePlatformAdminCount(state) <= 1) {
      return badRequest("last_active_platform_admin_required");
    }
    user.status = status;
    user.updatedAt = new Date().toISOString();
    return ok({ user: userWithRoles(state, user) });
  }
  const apiKeyMatch = pathname.match(/^\/api-keys\/([^/]+)$/);
  if (method === "GET" && apiKeyMatch) return ok({ key: publicApiKey(requireItem(state.apiKeys, apiKeyMatch[1]!, "api_key_not_found")) });
  const revokeMatch = pathname.match(/^\/api-keys\/([^/]+)\/revoke$/);
  if (method === "POST" && revokeMatch) {
    const key = requireItem(state.apiKeys, revokeMatch[1]!, "api_key_not_found");
    key.status = "revoked";
    key.revokedAt = new Date().toISOString();
    return ok({ key: publicApiKey(key) });
  }
  const rotateMatch = pathname.match(/^\/api-keys\/([^/]+)\/rotate$/);
  if (method === "POST" && rotateMatch) {
    const oldKey = requireItem(state.apiKeys, rotateMatch[1]!, "api_key_not_found");
    oldKey.status = "revoked";
    oldKey.revokedAt = new Date().toISOString();
    const client = requireItem(state.apiClients, oldKey.apiClientId, "api_client_not_found");
    const createdKey = createApiClientAndKey(state, { clientName: `${client.clientName} rotated`, scopes: oldKey.scopes });
    state.apiKeys[state.apiKeys.length - 1]!.rotatedFromApiKeyId = oldKey.id;
    return created(createdKey);
  }

  if (method === "POST" && pathname === "/business-clients") {
    const client = {
      id: newId("client"),
      tenantId: state.tenantId,
      legalName: stringBody(body, "legalName", "New Client"),
      country: stringBody(body, "country", "US"),
      onboardingStatus: "draft" as const,
      createdAt: new Date().toISOString()
    };
    state.businessClients.push(client);
    emitOutbox(state, "business_client.created", { businessClientId: client.id });
    return created({ businessClient: client });
  }
  if (method === "GET" && pathname === "/business-clients") return ok({ businessClients: state.businessClients });
  const businessClientMatch = pathname.match(/^\/business-clients\/([^/]+)$/);
  if (method === "GET" && businessClientMatch) return ok({ businessClient: requireItem(state.businessClients, businessClientMatch[1]!, "business_client_not_found") });
  const onboardingMatch = pathname.match(/^\/business-clients\/([^/]+)\/submit-onboarding$/);
  if (method === "POST" && onboardingMatch) {
    const client = requireItem(state.businessClients, onboardingMatch[1]!, "business_client_not_found");
    const transitionError = validateBusinessClientTransition(client.onboardingStatus, "submitted");
    if (transitionError) return badRequest(transitionError);
    client.onboardingStatus = "submitted";
    const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: "client_onboarding", payload: { businessClientId: client.id } });
    client.circleApplicationId = circle.providerReferenceId;
    emitOutbox(state, "business_client.onboarding_submitted", { businessClientId: client.id, circleOperationId: circle.id });
    return ok({ businessClient: client, circleOperation: circle });
  }
  const mapCircleMatch = pathname.match(/^\/business-clients\/([^/]+)\/map-circle$/);
  if (method === "POST" && mapCircleMatch) {
    const client = requireItem(state.businessClients, mapCircleMatch[1]!, "business_client_not_found");
    const transitionError = validateBusinessClientTransition(client.onboardingStatus, "approved");
    if (transitionError) return badRequest(transitionError);
    client.circleClientEntityId = stringBody(body, "circleClientEntityId", `circle_${client.id}`);
    client.circleApplicationId = stringBody(body, "circleApplicationId", `app_${client.id}`);
    client.onboardingStatus = "approved";
    return ok({ businessClient: client });
  }
  const clientRestrictionMatch = pathname.match(/^\/business-clients\/([^/]+)\/(restrict|close)$/);
  if (method === "POST" && clientRestrictionMatch) {
    const client = requireItem(state.businessClients, clientRestrictionMatch[1]!, "business_client_not_found");
    const nextStatus = clientRestrictionMatch[2] === "restrict" ? "restricted" as const : "closed" as const;
    const transitionError = validateBusinessClientTransition(client.onboardingStatus, nextStatus);
    if (transitionError) return badRequest(transitionError);
    client.onboardingStatus = nextStatus;
    return ok({ businessClient: client });
  }

  if (method === "POST" && pathname === "/accounts-of-digital-asset") {
    const businessClientId = stringBody(body, "businessClientId", "client_buyer");
    const client = requireItem(state.businessClients, businessClientId, "business_client_not_found");
    if (client.onboardingStatus !== "approved") return badRequest("business_client_not_approved");
    const account = {
      id: newId("ada"),
      tenantId: state.tenantId,
      businessClientId,
      accountName: stringBody(body, "accountName", "New ADA"),
      usePurpose: "settlement" as const,
      status: "active" as const,
      createdAt: new Date().toISOString()
    };
    state.accounts.push(account);
    state.balances.push({ accountOfDigitalAssetId: account.id, availableMinorUnits: 0n, pendingMinorUnits: 0n, reservedMinorUnits: 0n, lockedMinorUnits: 0n, suspenseMinorUnits: 0n, version: 1 });
    return created({ account });
  }
  if (method === "GET" && pathname === "/accounts-of-digital-asset") return ok({ accounts: state.accounts });
  const accountMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)$/);
  if (method === "GET" && accountMatch) return ok({ account: requireItem(state.accounts, accountMatch[1]!, "account_not_found") });
  const provisionMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/provision-circle$/);
  if (method === "POST" && provisionMatch) {
    const account = requireItem(state.accounts, provisionMatch[1]!, "account_not_found");
    const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: "account_provision", payload: { accountId: account.id } });
    account.circleAccountId = circle.providerReferenceId;
    account.circleSubAccountId = `${circle.providerReferenceId}_sub`;
    emitOutbox(state, "account_of_digital_asset.provisioned", { accountOfDigitalAssetId: account.id, circleOperationId: circle.id });
    return ok({ account, circleOperation: circle });
  }
  const accountRestrictionMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/(restrict|unrestrict)$/);
  if (method === "POST" && accountRestrictionMatch) {
    const account = requireItem(state.accounts, accountRestrictionMatch[1]!, "account_not_found");
    const nextStatus = accountRestrictionMatch[2] === "restrict" ? "restricted" as const : "active" as const;
    const transitionError = validateAccountTransition(account.status, nextStatus);
    if (transitionError) return badRequest(transitionError);
    account.status = nextStatus;
    return ok({ account });
  }
  const balanceMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/balance$/);
  if (method === "GET" && balanceMatch) return ok({ balance: balanceFor(state, balanceMatch[1]!) });
  const statementMatch = pathname.match(/^\/accounts-of-digital-asset\/([^/]+)\/statement$/);
  if (method === "GET" && statementMatch) return ok({ accountId: statementMatch[1], journals: state.journals.filter((item) => item.accountOfDigitalAssetId === statementMatch[1]) });

  if (method === "GET" && pathname === "/ledger/chart-of-accounts") return ok({ accounts: chartOfAccounts });
  if (method === "GET" && pathname === "/ledger/posting-rules") return ok({ postingRules });
  if (method === "POST" && pathname === "/ledger/events/opening-journal") {
    const accountOfDigitalAssetId = stringBody(body, "accountOfDigitalAssetId");
    requireItem(state.accounts, accountOfDigitalAssetId, "account_not_found");
    const rule = postingRules.find((item) => item.eventType === "treasury.opening_journal.posted" && item.status === "active");
    if (!rule) return badRequest("posting_rule_not_active");
    const amountMinorUnits = toMinorUnits(body.amountMinorUnits, 0n);
    if (amountMinorUnits <= 0n) return badRequest("money_amount_must_be_positive");
    const journal = {
      id: newId("journal"),
      tenantId: state.tenantId,
      description: stringBody(body, "description", rule.ruleName),
      amountMinorUnits,
      debitLedgerAccountCode: rule.debitLedgerAccountCode,
      creditLedgerAccountCode: rule.creditLedgerAccountCode,
      accountOfDigitalAssetId,
      createdAt: new Date().toISOString()
    };
    state.journals.push(journal);
    balanceFor(state, accountOfDigitalAssetId).availableMinorUnits += journal.amountMinorUnits;
    emitOutbox(state, "treasury.journal_entry.posted", { journalEntryId: journal.id, postingRule: rule.eventType });
    return created({ journal });
  }
  if (method === "POST" && pathname === "/ledger/journals") {
    const journal = {
      id: newId("journal"),
      tenantId: state.tenantId,
      description: stringBody(body, "description", "API journal"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 0n),
      debitLedgerAccountCode: stringBody(body, "debitLedgerAccountCode", "10020"),
      creditLedgerAccountCode: stringBody(body, "creditLedgerAccountCode", "20400"),
      accountOfDigitalAssetId: optionalStringBody(body, "accountOfDigitalAssetId"),
      createdAt: new Date().toISOString()
    };
    state.journals.push(journal);
    if (journal.accountOfDigitalAssetId) balanceFor(state, journal.accountOfDigitalAssetId).availableMinorUnits += journal.amountMinorUnits;
    emitOutbox(state, "treasury.journal_entry.posted", { journalEntryId: journal.id });
    return created({ journal });
  }
  if (method === "GET" && pathname === "/ledger/journals") return ok({ journals: state.journals });
  const journalMatch = pathname.match(/^\/ledger\/journals\/([^/]+)$/);
  if (method === "GET" && journalMatch) return ok({ journal: requireItem(state.journals, journalMatch[1]!, "journal_not_found") });
  const journalReverseMatch = pathname.match(/^\/ledger\/journals\/([^/]+)\/reverse$/);
  if (method === "POST" && journalReverseMatch) {
    const original = requireItem(state.journals, journalReverseMatch[1]!, "journal_not_found");
    const reversal = { ...original, id: newId("journal"), description: `Reversal of ${original.id}`, reversalOfJournalEntryId: original.id, createdAt: new Date().toISOString() };
    state.journals.push(reversal);
    return created({ journal: reversal });
  }

  if (method === "POST" && pathname === "/balances/project") return ok({ projected: state.balances });
  if (method === "GET" && pathname === "/balances/projection-runs") return ok({ projectionRuns: [{ id: "projection_run_latest", status: "completed" }] });
  const balanceHistoryMatch = pathname.match(/^\/balances\/([^/]+)\/history$/);
  if (method === "GET" && balanceHistoryMatch) return ok({ accountOfDigitalAssetId: balanceHistoryMatch[1], history: [balanceFor(state, balanceHistoryMatch[1]!)] });
  const directBalanceMatch = pathname.match(/^\/balances\/([^/]+)$/);
  if (method === "GET" && directBalanceMatch) return ok({ balance: balanceFor(state, directBalanceMatch[1]!) });

  if (method === "POST" && pathname === "/settlement-obligations") {
    const obligation = {
      id: newId("obligation"),
      tenantId: state.tenantId,
      buyerBusinessClientId: stringBody(body, "buyerBusinessClientId", "client_buyer"),
      supplierBusinessClientId: stringBody(body, "supplierBusinessClientId", "client_supplier"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n),
      disputedMinorUnits: 0n,
      dueDate: stringBody(body, "dueDate", "2027-01-31"),
      status: "draft" as const,
      fundingStatus: "unfunded" as const,
      createdAt: new Date().toISOString()
    };
    state.obligations.push(obligation);
    return created({ obligation });
  }
  if (method === "GET" && pathname === "/settlement-obligations") return ok({ obligations: state.obligations });
  const obligationMatch = pathname.match(/^\/settlement-obligations\/([^/]+)$/);
  if (method === "GET" && obligationMatch) return ok({ obligation: requireItem(state.obligations, obligationMatch[1]!, "obligation_not_found") });
  const obligationActionMatch = pathname.match(/^\/settlement-obligations\/([^/]+)\/(approve|dispute|release-dispute|cancel)$/);
  if (method === "POST" && obligationActionMatch) {
    const obligation = requireItem(state.obligations, obligationActionMatch[1]!, "obligation_not_found");
    const action = obligationActionMatch[2]!;
    if (action === "approve") obligation.status = "approved";
    if (action === "dispute") {
      obligation.status = "disputed";
      obligation.disputedMinorUnits = toMinorUnits(body.disputedMinorUnits, obligation.amountMinorUnits);
    }
    if (action === "release-dispute") {
      obligation.status = "approved";
      obligation.disputedMinorUnits = 0n;
    }
    if (action === "cancel") obligation.status = "cancelled";
    return ok({ obligation });
  }

  if (method === "POST" && pathname === "/funding-reservations") {
    const reservation = {
      id: newId("reservation"),
      tenantId: state.tenantId,
      settlementObligationId: stringBody(body, "settlementObligationId", state.obligations[0]?.id ?? "obligation_missing"),
      accountOfDigitalAssetId: stringBody(body, "accountOfDigitalAssetId", "ada_buyer"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n),
      status: "active" as const,
      createdAt: new Date().toISOString()
    };
    const balance = balanceFor(state, reservation.accountOfDigitalAssetId);
    if (balance.availableMinorUnits < reservation.amountMinorUnits) return badRequest("reservation_exceeds_available_balance");
    balance.availableMinorUnits -= reservation.amountMinorUnits;
    balance.reservedMinorUnits += reservation.amountMinorUnits;
    balance.version += 1;
    state.reservations.push(reservation);
    emitOutbox(state, "funding_reservation.activated", { reservationId: reservation.id, settlementObligationId: reservation.settlementObligationId });
    return created({ reservation });
  }
  if (method === "GET" && pathname === "/funding-reservations") return ok({ reservations: state.reservations });
  const reservationMatch = pathname.match(/^\/funding-reservations\/([^/]+)$/);
  if (method === "GET" && reservationMatch) return ok({ reservation: requireItem(state.reservations, reservationMatch[1]!, "reservation_not_found") });
  const reservationActionMatch = pathname.match(/^\/funding-reservations\/([^/]+)\/(activate|release|expire|cancel)$/);
  if (method === "POST" && reservationActionMatch) {
    const reservation = requireItem(state.reservations, reservationActionMatch[1]!, "reservation_not_found");
    const action = reservationActionMatch[2]!;
    reservation.status = action === "activate" ? "active" : action === "expire" ? "expired" : action === "cancel" ? "cancelled" : "released";
    emitOutbox(state, action === "release" ? "funding_reservation.released" : `funding_reservation.${reservation.status}`, { reservationId: reservation.id });
    return ok({ reservation });
  }

  if (method === "POST" && ["/payments/internal", "/payments/external-usdc"].includes(pathname)) {
    const payment = {
      id: newId("payment"),
      tenantId: state.tenantId,
      paymentType: pathname.endsWith("internal") ? "internal" as const : "external_usdc" as const,
      sourceAccountOfDigitalAssetId: stringBody(body, "sourceAccountOfDigitalAssetId", "ada_buyer"),
      destinationAccountOfDigitalAssetId: optionalStringBody(body, "destinationAccountOfDigitalAssetId"),
      recipientAddress: optionalStringBody(body, "recipientAddress"),
      amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n),
      status: "created" as const,
      idempotencyKey: optionalStringBody(body, "idempotencyKey"),
      createdAt: new Date().toISOString()
    };
    state.payments.push(payment);
    return created({ payment });
  }
  if (method === "GET" && pathname === "/payments") return ok({ payments: state.payments });
  const paymentMatch = pathname.match(/^\/payments\/([^/]+)$/);
  if (method === "GET" && paymentMatch) return ok({ payment: requireItem(state.payments, paymentMatch[1]!, "payment_not_found") });
  const paymentActionMatch = pathname.match(/^\/payments\/([^/]+)\/(submit|cancel|retry|refresh-status)$/);
  if (method === "POST" && paymentActionMatch) {
    const payment = requireItem(state.payments, paymentActionMatch[1]!, "payment_not_found");
    const action = paymentActionMatch[2]!;
    if (action === "cancel") payment.status = "cancelled";
    else {
      const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: payment.paymentType === "internal" ? "internal_transfer" : "external_crypto_transfer", idempotencyKey: payment.idempotencyKey, payload: { paymentId: payment.id } });
      payment.providerTransferId = circle.providerReferenceId;
      payment.status = action === "refresh-status" ? "complete" : "submitted";
      emitOutbox(state, payment.status === "complete" ? "payment_execution.completed" : "payment_execution.submitted", { paymentId: payment.id, circleOperationId: circle.id });
    }
    return ok({ payment });
  }

  if (method === "POST" && pathname === "/fiat/wire-accounts") {
    const wire = { id: newId("wire"), tenantId: state.tenantId, businessClientId: stringBody(body, "businessClientId", "client_supplier"), bankName: stringBody(body, "bankName", "Supplier Bank"), accountNumberLast4: stringBody(body, "accountNumberLast4", "7788"), routingNumber: stringBody(body, "routingNumber", "000000001"), status: "active" as const };
    state.wireAccounts.push(wire);
    return created({ wireAccount: wire });
  }
  if (method === "GET" && pathname === "/fiat/wire-accounts") return ok({ wireAccounts: state.wireAccounts });
  if (method === "POST" && pathname === "/fiat/redemptions") {
    const redemption = { id: newId("redemption"), tenantId: state.tenantId, sourceAccountOfDigitalAssetId: stringBody(body, "sourceAccountOfDigitalAssetId", "ada_supplier"), fiatWireAccountId: stringBody(body, "fiatWireAccountId", state.wireAccounts[0]?.id ?? "wire_missing"), amountMinorUnits: toMinorUnits(body.amountMinorUnits, 100000000n), status: "created" as const };
    state.redemptions.push(redemption);
    return created({ redemption });
  }
  if (method === "GET" && pathname === "/fiat/redemptions") return ok({ redemptions: state.redemptions });
  const redemptionMatch = pathname.match(/^\/fiat\/redemptions\/([^/]+)$/);
  if (method === "GET" && redemptionMatch) return ok({ redemption: requireItem(state.redemptions, redemptionMatch[1]!, "redemption_not_found") });
  const redemptionActionMatch = pathname.match(/^\/fiat\/redemptions\/([^/]+)\/(submit|retry|refresh-status)$/);
  if (method === "POST" && redemptionActionMatch) {
    const redemption = requireItem(state.redemptions, redemptionActionMatch[1]!, "redemption_not_found");
    const circle = await invokeCircle(state, { tenantId: state.tenantId, operationType: "withdrawal", payload: { redemptionId: redemption.id } });
    redemption.providerWithdrawalId = circle.providerReferenceId;
    redemption.status = redemptionActionMatch[2] === "refresh-status" ? "complete" : "submitted";
    emitOutbox(state, redemption.status === "complete" ? "redemption.completed" : "redemption.submitted", { redemptionId: redemption.id, circleOperationId: circle.id });
    return ok({ redemption });
  }
  if (method === "POST" && pathname === "/fiat/funding-instructions") return created({ fundingInstruction: { id: newId("fiat_funding"), status: "created" } });
  if (method === "GET" && pathname === "/fiat/funding-instructions") return ok({ fundingInstructions: [] });

  if (method === "GET" && pathname === "/liquidity-rebalancing/recommendations") return ok({ recommendations: state.recommendations });
  if (method === "POST" && pathname === "/liquidity-rebalancing/instructions") {
    const recommendation = requireItem(state.recommendations, stringBody(body, "id", state.recommendations[0]?.id), "rebalance_recommendation_not_found");
    recommendation.status = "queued";
    return created({ instruction: recommendation });
  }
  if (method === "GET" && pathname === "/liquidity-rebalancing/instructions") return ok({ instructions: state.recommendations });
  const rebalanceMatch = pathname.match(/^\/liquidity-rebalancing\/instructions\/([^/]+)$/);
  if (method === "GET" && rebalanceMatch) return ok({ instruction: requireItem(state.recommendations, rebalanceMatch[1]!, "rebalance_instruction_not_found") });
  const rebalanceActionMatch = pathname.match(/^\/liquidity-rebalancing\/instructions\/([^/]+)\/(approve|reject|execute)$/);
  if (method === "POST" && rebalanceActionMatch) {
    const recommendation = requireItem(state.recommendations, rebalanceActionMatch[1]!, "rebalance_instruction_not_found");
    recommendation.status = rebalanceActionMatch[2] === "approve" ? "approved" : rebalanceActionMatch[2] === "reject" ? "rejected" : "executed";
    return ok({ instruction: recommendation });
  }

  if (method === "POST" && pathname === "/reconciliation/runs") {
    const run = { id: newId("recon_run"), status: "completed", breakCount: state.reconciliationBreaks.length, createdAt: new Date().toISOString() };
    emitOutbox(state, "reconciliation.run.completed", { reconciliationRunId: run.id, breakCount: run.breakCount });
    return created({ run });
  }
  if (method === "GET" && pathname === "/reconciliation/runs") return ok({ runs: [{ id: "recon_run_latest", status: "completed" }] });
  const reconciliationRunMatch = pathname.match(/^\/reconciliation\/runs\/([^/]+)$/);
  if (method === "GET" && reconciliationRunMatch) return ok({ run: { id: reconciliationRunMatch[1], status: "completed", breakCount: state.reconciliationBreaks.length } });
  if (method === "GET" && pathname === "/reconciliation/breaks") return ok({ breaks: state.reconciliationBreaks });
  const breakMatch = pathname.match(/^\/reconciliation\/breaks\/([^/]+)$/);
  if (method === "GET" && breakMatch) return ok({ break: requireItem(state.reconciliationBreaks, breakMatch[1]!, "reconciliation_break_not_found") });
  const breakActionMatch = pathname.match(/^\/reconciliation\/breaks\/([^/]+)\/(assign|add-note|attach-evidence|resolve|reopen)$/);
  if (method === "POST" && breakActionMatch) {
    const reconciliationBreak = requireItem(state.reconciliationBreaks, breakActionMatch[1]!, "reconciliation_break_not_found");
    const action = breakActionMatch[2]!;
    if (action === "assign") {
      reconciliationBreak.assignedTo = stringBody(body, "assignedTo", "api_operator");
      reconciliationBreak.status = "assigned";
    }
    if (action === "add-note") reconciliationBreak.note = stringBody(body, "note", "Operator note");
    if (action === "attach-evidence") reconciliationBreak.evidenceUri = stringBody(body, "evidenceUri", "evidence://api");
    if (action === "resolve") {
      reconciliationBreak.status = "resolved";
      emitOutbox(state, "reconciliation.break.resolved", { reconciliationBreakId: reconciliationBreak.id });
    }
    if (action === "reopen") reconciliationBreak.status = "reopened";
    return ok({ break: reconciliationBreak });
  }

  if (method === "GET" && pathname === "/treasury-accounting/trial-balance") return ok(trialBalance());
  if (method === "GET" && pathname === "/treasury-accounting/customer-liability-control") return ok({ customerLiabilityMinorUnits: 1500000000n, balanced: true });
  if (method === "GET" && pathname === "/reports/daily-close") return ok(dailyClose(state));
  if (method.startsWith("GET") && pathname.startsWith("/reports/")) return ok({ report: pathname.split("/").at(-1), status: "available" });

  if (method === "GET" && pathname === "/events/outbox") return ok({ events: state.outbox });
  if (method === "GET" && pathname === "/events/inbox") return ok({ events: state.inbox });
  const eventRetryMatch = pathname.match(/^\/events\/(outbox|inbox)\/([^/]+)\/retry$/);
  if (method === "POST" && eventRetryMatch) {
    const list = eventRetryMatch[1] === "outbox" ? state.outbox : state.inbox;
    const event = requireItem(list, eventRetryMatch[2]!, "event_not_found");
    event.status = "pending";
    event.attemptCount += 1;
    return ok({ event });
  }
  if (method === "GET" && pathname === "/dead-letter") return ok({ events: state.deadLetters });
  const deadLetterReplayMatch = pathname.match(/^\/dead-letter\/([^/]+)\/replay$/);
  if (method === "POST" && deadLetterReplayMatch) {
    const event = requireItem(state.deadLetters, deadLetterReplayMatch[1]!, "dead_letter_not_found");
    event.status = "pending";
    event.processedAt = new Date().toISOString();
    return ok({ event });
  }
  if (method === "GET" && ["/audit-log", "/audit-events"].includes(pathname)) return ok({ auditEvents: state.auditEvents });
  if (method === "GET" && pathname === "/internal/operations/commandcentre") return ok({ dailyClose: dailyClose(state), recommendations: state.recommendations, breaks: state.reconciliationBreaks });

  if (method === "POST" && pathname === "/webhooks/circle") {
    const verification = verifyCircleWebhook(input.rawBody ?? JSON.stringify(body), input.headers?.["circle-signature"]);
    const existing = state.circleWebhooks.find((item) => item.providerEventId === verification.providerEventId);
    if (existing) return ok({ webhook: existing, duplicate: true });
    const webhook = { id: newId("circle_webhook"), tenantId: state.tenantId, providerEventId: verification.providerEventId, signatureValid: verification.valid, rawPayload: body, normalizedPayload: verification.normalizedPayload, status: verification.valid ? "received" as const : "rejected" as const, receivedAt: new Date().toISOString() };
    state.circleWebhooks.push(webhook);
    if (!verification.valid) return { status: 401, body: { error: "circle_webhook_signature_invalid" } };
    state.inbox.push({ id: newId("inbox"), tenantId: state.tenantId, eventType: verification.eventType, payload: verification.normalizedPayload, status: "pending", attemptCount: 0, createdAt: new Date().toISOString() });
    emitOutbox(state, "circle.webhook.received", { webhookId: webhook.id, providerEventId: webhook.providerEventId });
    return ok({ webhook });
  }
  if (method === "GET" && pathname === "/webhooks/circle/events") return ok({ webhooks: state.circleWebhooks });
  const webhookRetryMatch = pathname.match(/^\/webhooks\/circle\/events\/([^/]+)\/retry$/);
  if (method === "POST" && webhookRetryMatch) {
    const webhook = requireItem(state.circleWebhooks, webhookRetryMatch[1]!, "webhook_not_found");
    webhook.status = "processed";
    return ok({ webhook });
  }

  if (method === "GET" && pathname === "/uat/scenarios") return ok({ scenarios: uatScenarios });
  const uatResultMatch = pathname.match(/^\/uat\/scenarios\/([^/]+)\/result$/);
  if (method === "POST" && uatResultMatch) return ok({ scenarioId: uatResultMatch[1], status: stringBody(body, "status", "pass") });
  if (method === "GET" && pathname === "/release-readiness") return ok(releaseReadiness(state));
  if (method === "POST" && pathname === "/release-readiness/evaluate") return ok(releaseReadiness(state));
  if (method === "POST" && pathname === "/release-readiness/decision") return created({ decision: "approved", releaseVersion: stringBody(body, "releaseVersion", "0.1.0-full-api") });
  if (method === "GET" && pathname === "/release-artifacts") return ok({ artifacts: releaseArtifacts });
  if (method === "POST" && pathname === "/release-artifacts") return created({ artifact: { id: newId("artifact"), ...body } });

  return notFound(pathname);
};

const ok = (body: unknown): JsonResponse => ({ status: 200, body });
const created = (body: unknown): JsonResponse => ({ status: 201, body });
const stringBody = (body: Record<string, unknown>, key: string, fallback?: string): string => typeof body[key] === "string" ? body[key] as string : fallback ?? "";
const optionalStringBody = (body: Record<string, unknown>, key: string): string | undefined => typeof body[key] === "string" ? body[key] as string : undefined;
const uuidBody = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = optionalStringBody(body, key);
  return value && isUuid(value) ? value : undefined;
};
const arrayBody = (body: Record<string, unknown>, key: string): unknown[] | undefined => Array.isArray(body[key]) ? body[key] as unknown[] : undefined;
const reviewActionFromRoute = (value: string): BusinessOnboardingReviewActionType | undefined => {
  if (value === "approve") return "approved";
  if (value === "reject") return "rejected";
  if (value === "request-info") return "requested_information";
  return undefined;
};
const requireItem = <T extends { id: string }>(items: T[], id: string, errorCode: string): T => {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(errorCode);
  return item;
};
const balanceFor = (state: ApiState, accountOfDigitalAssetId: string) => {
  const balance = state.balances.find((item) => item.accountOfDigitalAssetId === accountOfDigitalAssetId);
  if (!balance) throw new Error("balance_not_found");
  return balance;
};

const rolePriority: RoleCode[] = ["super_admin", "platform_admin", "platform_operator", "treasury_operator", "auditor", "business_user"];

const roleRedirects: Record<RoleCode, string> = {
  super_admin: "/internal/operations/commandcentre",
  platform_admin: "/internal/operations/commandcentre",
  platform_operator: "/internal/operations/business-clients",
  treasury_operator: "/internal/operations/ledger/chart-of-accounts",
  auditor: "/internal/operations/audit",
  business_user: "/onboarding/step-1"
};

const rolePermissions: Record<RoleCode, string[]> = {
  super_admin: ["users:bootstrap", "users:invite", "users:write", "api_keys:write", "tenant:write", "tenant:read"],
  platform_admin: ["users:invite", "users:write", "api_keys:write", "tenant:read"],
  platform_operator: ["clients:write", "adas:write", "onboarding:review"],
  treasury_operator: ["ledger:read", "ledger:write", "statements:read"],
  auditor: ["audit:read", "events:read", "statements:read"],
  business_user: ["onboarding:own"]
};

const rolesForUser = (state: ApiState, userId: string): RoleCode[] => {
  return state.userRoleAssignments
    .filter((assignment) => assignment.userId === userId)
    .map((assignment) => state.roles.find((role) => role.id === assignment.roleId)?.roleCode)
    .filter((roleCode): roleCode is RoleCode => Boolean(roleCode));
};

const userWithRoles = (state: ApiState, user: AppUser) => ({
  ...user,
  roles: rolesForUser(state, user.id)
});

const defaultRedirect = (roles: RoleCode[], status: AppUser["status"]): string | undefined => {
  if (status === "disabled") return undefined;
  const selected = rolePriority.find((role) => roles.includes(role));
  return selected ? roleRedirects[selected] : undefined;
};

const permissionsForRoles = (roles: RoleCode[]): string[] => {
  return [...new Set(roles.flatMap((role) => rolePermissions[role]))];
};

const handleAuthMe = (state: ApiState, headers: Record<string, string | undefined>): JsonResponse => {
  const email = headers["x-dev-auth-email"]?.trim().toLowerCase() ?? "admin@gtt.example";
  const user = state.appUsers.find((item) => item.email === email);
  if (!user) return { status: 401, body: { error: "user_not_found" } };
  const roles = rolesForUser(state, user.id);
  return ok({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      tenantId: user.tenantId,
      userType: user.userType,
      roles,
      status: user.status
    },
    permissions: user.status === "active" ? permissionsForRoles(roles) : [],
    redirectTo: defaultRedirect(roles, user.status)
  });
};

const assignRoles = (state: ApiState, userId: string, roleCodes: RoleCode[], assignedByUserId: string): void => {
  const now = new Date().toISOString();
  state.userRoleAssignments = state.userRoleAssignments.filter((assignment) => assignment.userId !== userId);
  for (const roleCode of roleCodes) {
    const role = state.roles.find((candidate) => candidate.roleCode === roleCode);
    if (role) state.userRoleAssignments.push({ userId, roleId: role.id, assignedByUserId, assignedAt: now });
  }
};

const hasRole = (state: ApiState, userId: string, roleCode: RoleCode): boolean => rolesForUser(state, userId).includes(roleCode);

const activePlatformAdminCount = (state: ApiState): number => {
  return state.appUsers.filter((user) => user.status === "active" && (hasRole(state, user.id, "platform_admin") || hasRole(state, user.id, "super_admin"))).length;
};

const persistentTenantId = (state: ApiState): string => {
  if (isUuid(state.tenantId)) return state.tenantId;
  return process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
};

const sendInternalInvitationEmail = async (input: {
  email: string;
  displayName: string;
  initializationUrl: string;
  invitationId: string;
  roleCode: Exclude<RoleCode, "business_user">;
}): Promise<{ sent: boolean; provider: "supabase" | "dev"; status: string; detail?: string; initializationUrl?: string; supabaseUserId?: string }> => {
  if (!process.env.SUPABASE_URL) {
    return {
      sent: false,
      provider: "dev",
      status: "dev_email_not_configured",
      detail: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to send invitation email.",
      initializationUrl: input.initializationUrl
    };
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      sent: false,
      provider: "supabase",
      status: "supabase_service_role_key_required",
      detail: "SUPABASE_SERVICE_ROLE_KEY is required because Supabase Auth Admin invite cannot send email with the anon key.",
      initializationUrl: input.initializationUrl
    };
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      sent: false,
      provider: "dev",
      status: "supabase_admin_not_configured",
      initializationUrl: input.initializationUrl
    };
  }

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: input.initializationUrl,
    data: {
      displayName: input.displayName,
      internalInvitationId: input.invitationId,
      role: input.roleCode,
      userType: "internal_user"
    }
  });

  if (error) {
    return {
      sent: false,
      provider: "supabase",
      status: "supabase_invitation_failed",
      detail: error.message,
      initializationUrl: input.initializationUrl
    };
  }

  return {
    sent: true,
    provider: "supabase",
    status: "sent",
    supabaseUserId: data.user?.id
  };
};

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const handleBootstrapSuperAdmin = (
  state: ApiState,
  body: Record<string, unknown>,
  headers: Record<string, string | undefined>
): JsonResponse => {
  const expectedToken = process.env.GTT_BOOTSTRAP_TOKEN;
  if (!expectedToken) return { status: 503, body: { error: "bootstrap_token_not_configured" } };
  const presentedToken = headers["x-bootstrap-token"] ?? stringBody(body, "bootstrapToken");
  if (!presentedToken || hashSecret(presentedToken) !== hashSecret(expectedToken)) return { status: 401, body: { error: "bootstrap_token_invalid" } };
  if (
    state.appUsers.some((user) => rolesForUser(state, user.id).includes("super_admin")) ||
    state.internalUserInvitations.some((invitation) => invitation.roleCode === "super_admin" && ["sent", "accepted"].includes(invitation.status))
  ) {
    return badRequest("super_admin_already_provisioned");
  }

  const now = new Date().toISOString();
  const email = stringBody(body, "email").trim().toLowerCase();
  if (!email) return badRequest("email_required");
  const setupToken = randomBytes(32).toString("base64url");
  ensureRole(state, "super_admin", "Super Admin");
  const idempotencyKey = stringBody(body, "idempotencyKey", `bootstrap-${email}`);
  const invitation = {
    id: randomUUID(),
    tenantId: persistentTenantId(state),
    email,
    displayName: stringBody(body, "displayName", "Super Admin"),
    roleCode: "super_admin",
    status: "sent",
    supabaseUserId: uuidBody(body, "authUserId"),
    idempotencyKey,
    invitedByUserId: "bootstrap",
    invitedAt: now,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
    createdAt: now,
    updatedAt: now
  } satisfies InternalUserInvitation;
  state.internalUserInvitations.push(invitation);
  state.internalAccessSecrets.push({
    invitationId: invitation.id,
    email,
    setupTokenHash: hashSecret(setupToken),
    createdAt: now,
    updatedAt: now
  });
  const baseUrl = stringBody(body, "internalAccessBaseUrl", process.env.INTERNAL_OPERATION_BASE_URL ?? "http://localhost:5173/internal/access/init");
  const initializationUrl = `${baseUrl}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(setupToken)}`;
  return created({
    invitation,
    identity: {
      email,
      displayName: invitation.displayName,
      status: "invited",
      roles: ["super_admin"]
    },
    setupToken,
    initializationUrl
  });
};

const handleInternalAccessInitialize = (state: ApiState, body: Record<string, unknown>): JsonResponse => {
  const email = stringBody(body, "email").trim().toLowerCase();
  const setupToken = stringBody(body, "setupToken");
  const password = stringBody(body, "password");
  const error = validateInternalPassword(password);
  if (error) return badRequest(error);
  const existingUser = state.appUsers.find((item) => item.email === email && item.userType === "internal_user");
  if (existingUser?.status === "disabled") return { status: 403, body: { error: "internal_user_disabled" } };
  const invitation = state.internalUserInvitations.find((item) =>
    item.email === email &&
    item.status === "sent" &&
    new Date(item.expiresAt).getTime() > Date.now()
  );
  if (!existingUser && !invitation) return { status: 404, body: { error: "internal_invitation_not_found" } };
  const secret = state.internalAccessSecrets.find((item) =>
    (existingUser && item.userId === existingUser.id) ||
    (invitation && item.invitationId === invitation.id) ||
    item.email === email
  );
  if (!secret?.setupTokenHash || secret.setupTokenHash !== hashSecret(setupToken)) return { status: 401, body: { error: "setup_token_invalid" } };

  const now = new Date().toISOString();
  const invitationAuthUserId = isUuid(invitation?.supabaseUserId ?? "") ? invitation?.supabaseUserId : undefined;
  const user = existingUser ?? {
    id: randomUUID(),
    tenantId: invitation?.tenantId ?? persistentTenantId(state),
    authUserId: uuidBody(body, "authUserId") ?? invitationAuthUserId ?? randomUUID(),
    email,
    displayName: invitation?.displayName ?? email,
    userType: "internal_user" as const,
    status: "invited" as const,
    createdAt: now,
    updatedAt: now
  };
  if (!existingUser) state.appUsers.push(user);
  if (invitation) assignRoles(state, user.id, [invitation.roleCode], invitation.invitedByUserId);
  secret.passwordHash = hashSecret(password);
  secret.setupTokenHash = undefined;
  secret.userId = user.id;
  secret.initializedAt = now;
  secret.updatedAt = now;
  user.status = "active";
  user.updatedAt = now;
  for (const invitation of state.internalUserInvitations.filter((item) => item.email === email && item.status === "sent")) {
    invitation.status = "accepted";
    invitation.acceptedAt = now;
    invitation.updatedAt = now;
  }
  const roles = rolesForUser(state, user.id);
  return ok({ user: userWithRoles(state, user), redirectTo: defaultRedirect(roles, user.status) });
};

const handleInternalAccessLogin = (state: ApiState, body: Record<string, unknown>): JsonResponse => {
  const email = stringBody(body, "email").trim().toLowerCase();
  const password = stringBody(body, "password");
  const user = state.appUsers.find((item) => item.email === email && item.userType === "internal_user");
  if (!user) return { status: 401, body: { error: "invalid_internal_credentials" } };
  if (user.status === "disabled") return { status: 403, body: { error: "internal_user_disabled" } };
  if (user.status === "invited") return { status: 403, body: { error: "internal_user_not_initialized" } };
  const secret = state.internalAccessSecrets.find((item) => item.userId === user.id);
  if (!secret?.passwordHash || secret.passwordHash !== hashSecret(password)) return { status: 401, body: { error: "invalid_internal_credentials" } };
  const roles = rolesForUser(state, user.id);
  return ok({
    user: userWithRoles(state, user),
    permissions: permissionsForRoles(roles),
    redirectTo: defaultRedirect(roles, user.status)
  });
};

const ensureRole = (state: ApiState, roleCode: RoleCode, roleName: string) => {
  let role = state.roles.find((item) => item.roleCode === roleCode);
  if (!role) {
    role = { id: `role_${roleCode}`, roleCode, roleName };
    state.roles.push(role);
  }
  return role;
};

const hashSecret = (value: string): string => {
  return createHash("sha256").update(`${process.env.GTT_INTERNAL_SECRET_PEPPER ?? "gtt_internal_secret_pepper"}:${value}`).digest("hex");
};

const validateInternalPassword = (password: string): string | undefined => {
  if (password.length < 14) return "password_minimum_14_characters";
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return "password_complexity_required";
  }
  if (["password", "1234", "qwerty", "admin"].some((pattern) => password.toLowerCase().includes(pattern))) {
    return "password_common_pattern_rejected";
  }
  return undefined;
};

const chartOfAccounts = [
  { accountCode: "10020", accountName: "Circle Business Account USDC", accountClass: "Asset", normalBalance: "debit" },
  { accountCode: "10150", accountName: "Circle Settlement Suspense", accountClass: "Asset", normalBalance: "debit" },
  { accountCode: "20400", accountName: "Escrow Liability - Investor Funds", accountClass: "Liability", normalBalance: "credit" },
  { accountCode: "20430", accountName: "Customer ADA Liability - Available", accountClass: "Liability", normalBalance: "credit" },
  { accountCode: "20440", accountName: "Customer ADA Liability - Reserved", accountClass: "Liability", normalBalance: "credit" }
];

const postingRules = [
  {
    eventType: "treasury.opening_journal.posted",
    ruleName: "Opening ADA journal",
    status: "active",
    debitLedgerAccountCode: "10020",
    creditLedgerAccountCode: "20400"
  }
];

const businessClientTransitions: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["approved", "restricted"],
  approved: ["restricted", "closed"],
  restricted: ["approved"],
  closed: []
};

const accountTransitions: Record<string, string[]> = {
  draft: ["active"],
  active: ["restricted", "closed"],
  restricted: ["active"],
  closed: []
};

const validateBusinessClientTransition = (from: string, to: string): string | undefined => {
  return businessClientTransitions[from]?.includes(to) ? undefined : "business_client_invalid_status_transition";
};

const validateAccountTransition = (from: string, to: string): string | undefined => {
  return accountTransitions[from]?.includes(to) ? undefined : "account_invalid_status_transition";
};

const uatScenarios = [
  "Business onboarding and approval",
  "Account provisioning",
  "Wire funding",
  "Buyer obligation creation",
  "Obligation approval",
  "Full reservation",
  "Partial reservation",
  "Internal supplier settlement",
  "External USDC supplier settlement",
  "Supplier fiat redemption",
  "Failed payment retry",
  "Reservation expiry",
  "Dispute hold",
  "Rebalancing",
  "Reconciliation break",
  "Suspense resolution",
  "Journal reversal",
  "Account restriction",
  "Maker-checker approval",
  "Daily close"
].map((name, index) => ({ id: `uat-${index + 1}`, name, status: "pass" }));

const releaseArtifacts = [
  "deployment_runbook",
  "incident_runbook",
  "circle_integration_runbook",
  "reconciliation_runbook",
  "daily_operations_checklist",
  "security_review_report"
].map((artifactType) => ({ id: artifactType, artifactType, approvalStatus: "approved" }));
