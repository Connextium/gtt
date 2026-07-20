import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  emitOutbox,
  newId,
  type ApiState,
  type BusinessClient,
  type BusinessOnboardingApplication,
  type BusinessOnboardingInvitation,
  type BusinessUserProfile,
  type OnboardingStepPayload
} from "../../data.js";
import { postgresUrlFromEnv } from "../../db/connection.js";
import { withPostgresTransaction } from "../../db/transaction.js";
import { badRequest, unauthorized, type JsonResponse } from "../../http/index.js";

interface AuthenticatedBusinessUser {
  authUserId: string;
  email: string;
}

const rateLimitWindowMs = 60_000;
const maxAttemptsPerWindow = 5;
const invitationAttempts = new Map<string, { count: number; resetAt: number }>();

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const handleSelfRegistrationInvitation = async (
  state: ApiState,
  input: { email?: unknown; headers?: Record<string, string | undefined> }
): Promise<JsonResponse> => {
  const email = normalizeEmail(String(input.email ?? ""));
  if (!isValidEmail(email)) return badRequest("valid_email_required");

  const limiterKey = `${input.headers?.["x-forwarded-for"] ?? "local"}:${email}`;
  if (!checkRateLimit(limiterKey)) {
    return {
      status: 429,
      body: { error: "too_many_invitation_requests" }
    };
  }

  const invitation = createOrReuseInvitation(state, email);
  await persistInvitation(invitation);
  const supabase = supabaseAdminClient();

  if (!supabase) {
    if (process.env.ALLOW_DEV_WITHOUT_SUPABASE !== "true") {
      return {
        status: 503,
        body: { error: "supabase_admin_not_configured" }
      };
    }

    markInvitationSent(invitation);
    await persistInvitation(invitation);
    emitOutbox(state, "business_user.self_registration_invitation.dev_sent", {
      invitationId: invitation.id,
      email
    });
    return {
      status: 200,
      body: {
        ok: true,
        status: "check_email",
        message: "Invitation accepted for delivery.",
        devInviteLink: `${inviteRedirectUrl()}?dev_invitation=${invitation.id}`
      }
    };
  }

  const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: inviteRedirectUrl(),
    data: {
      onboardingInvitationId: invitation.id,
      role: "business_user"
    }
  });

  if (error) {
    if (isExistingSupabaseUserError(error.message)) {
      emitOutbox(state, "business_user.self_registration_invitation.existing_account", {
        invitationId: invitation.id,
        email
      });
      return {
        status: 200,
        body: {
          ok: true,
          status: "existing_account",
          message: "This email is already registered. Sign in to continue your application."
        }
      };
    }

    return {
      status: 502,
      body: { error: "supabase_invitation_failed", detail: error.message }
    };
  }

  markInvitationSent(invitation, data.user?.id);
  await persistInvitation(invitation);
  emitOutbox(state, "business_user.self_registration_invitation.sent", {
    invitationId: invitation.id,
    email,
    supabaseUserId: data.user?.id
  });

  return {
    status: 200,
    body: {
      ok: true,
      status: "check_email",
      message: "Invitation accepted for delivery."
    }
  };
};

export const handleGetOrCreateMyOnboarding = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  const stepPayloads = await hydrateOnboardingStepPayloads(state, bundle.application);
  await persistOnboardingBundle(state, auth, bundle);
  return {
    status: 200,
    body: {
      ...bundle,
      stepPayloads
    }
  };
};

export const handleSaveMyOnboardingStep = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; stepKey: string; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  const stepKey = input.stepKey.trim();
  if (!stepKey) return badRequest("step_key_required");

  const now = new Date().toISOString();
  const payload = isRecord(input.payload) ? input.payload : {};
  const payloadStepKey = stringPayload(payload, "completedStepKey") ?? stepKey;
  const existing = state.onboardingStepPayloads.find((item) => item.applicationId === bundle.application.id && item.stepKey === payloadStepKey);
  let savedStep: OnboardingStepPayload;
  if (existing) {
    existing.payload = payload;
    existing.savedAt = now;
    savedStep = existing;
  } else {
    savedStep = {
      id: newId("onboarding_step"),
      tenantId: state.tenantId,
      applicationId: bundle.application.id,
      stepKey: payloadStepKey,
      payload,
      savedAt: now
    };
    state.onboardingStepPayloads.push(savedStep);
  }

  if (isOnboardingStep(stepKey)) {
    bundle.application.currentStep = stepKey;
    bundle.application.updatedAt = now;
  }

  await persistOnboardingBundle(state, auth, bundle);
  await persistOnboardingStepPayload(savedStep);

  return {
    status: 200,
    body: { ok: true, application: bundle.application }
  };
};

export const handleSubmitMyOnboarding = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  const now = new Date().toISOString();
  bundle.application.status = "pending_review";
  bundle.application.currentStep = "pending_review";
  bundle.application.submittedAt = now;
  bundle.application.updatedAt = now;
  const stepPayloads = await hydrateOnboardingStepPayloads(state, bundle.application);
  const businessClient = businessClientFromOnboarding(state, bundle.application, stepPayloads, now);
  upsertRuntimeBusinessClient(state, businessClient);
  await persistOnboardingBundle(state, auth, bundle);
  await persistSubmittedBusinessClient(businessClient, bundle.application);
  emitOutbox(state, "business_user.onboarding_submitted", {
    applicationId: bundle.application.id,
    businessClientId: businessClient.id,
    authUserId: auth.authUserId,
    email: auth.email
  });

  return {
    status: 200,
    body: {
      status: "pending_review",
      redirectTo: "/submission-confirmed",
      application: bundle.application,
      businessClient
    }
  };
};

const ensureBusinessUserOnboarding = (
  state: ApiState,
  auth: AuthenticatedBusinessUser
): { profile: BusinessUserProfile; application: BusinessOnboardingApplication } => {
  const now = new Date().toISOString();
  let profile = state.businessUserProfiles.find((item) => item.authUserId === auth.authUserId);
  if (!profile) {
    profile = {
      id: newId("business_user_profile"),
      tenantId: state.tenantId,
      authUserId: auth.authUserId,
      email: auth.email,
      role: "business_user",
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    state.businessUserProfiles.push(profile);
  } else {
    profile.email = auth.email;
    profile.status = "active";
    profile.updatedAt = now;
  }

  let application = state.businessOnboardingApplications.find((item) => item.authUserId === auth.authUserId);
  if (!application) {
    application = {
      id: newId("business_onboarding_application"),
      tenantId: state.tenantId,
      authUserId: auth.authUserId,
      email: auth.email,
      currentStep: "step_1",
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
    state.businessOnboardingApplications.push(application);
  }

  const invitation = state.businessOnboardingInvitations.find((item) => item.email === auth.email);
  if (invitation && invitation.status !== "accepted") {
    invitation.status = "accepted";
    invitation.supabaseUserId = auth.authUserId;
    invitation.acceptedAt = now;
    invitation.updatedAt = now;
  }

  return { profile, application };
};

const hydrateBusinessUserOnboarding = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser
): Promise<{ profile: BusinessUserProfile; application: BusinessOnboardingApplication } | undefined> => {
  const authUserId = uuidFromRuntimeId(auth.authUserId);
  const supabase = supabaseAdminClient();
  if (!supabase || !authUserId) return undefined;

  const profileResult = await supabase
    .from("business_user_profiles")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (profileResult.error) throw new Error(`business_user_profiles_select_failed: ${profileResult.error.message}`);

  const applicationResult = await supabase
    .from("business_onboarding_applications")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (applicationResult.error) throw new Error(`business_onboarding_applications_select_failed: ${applicationResult.error.message}`);
  if (!profileResult.data || !applicationResult.data) return undefined;

  const profile = mapStoredProfile(profileResult.data);
  const application = mapStoredApplication(applicationResult.data);
  upsertRuntimeProfile(state, profile);
  upsertRuntimeApplication(state, application);
  return { profile, application };
};

const hydrateOnboardingStepPayloads = async (
  state: ApiState,
  application: BusinessOnboardingApplication
): Promise<Record<string, Record<string, unknown>>> => {
  const applicationId = uuidFromRuntimeId(application.id);
  const supabase = supabaseAdminClient();
  if (!supabase || !applicationId) {
    return Object.fromEntries(
      state.onboardingStepPayloads
        .filter((item) => item.applicationId === application.id)
        .map((item) => [item.stepKey, item.payload])
    );
  }

  const result = await supabase
    .from("onboarding_step_payloads")
    .select("*")
    .eq("application_id", applicationId);
  if (result.error) throw new Error(`onboarding_step_payloads_select_failed: ${result.error.message}`);

  const payloads: Record<string, Record<string, unknown>> = {};
  for (const row of result.data ?? []) {
    const stepPayload = mapStoredStepPayload(row);
    payloads[stepPayload.stepKey] = stepPayload.payload;
    upsertRuntimeStepPayload(state, stepPayload);
  }
  return payloads;
};

const mapStoredStepPayload = (row: Record<string, unknown>): OnboardingStepPayload => ({
  id: `onboarding_step_${String(row.id)}`,
  tenantId: String(row.tenant_id),
  applicationId: `business_onboarding_application_${String(row.application_id)}`,
  stepKey: String(row.step_key),
  payload: isRecord(row.payload) ? row.payload : {},
  savedAt: String(row.saved_at)
});

const mapStoredProfile = (row: Record<string, unknown>): BusinessUserProfile => ({
  id: `business_user_profile_${String(row.id)}`,
  tenantId: String(row.tenant_id),
  authUserId: String(row.auth_user_id),
  email: String(row.email),
  role: "business_user",
  status: isBusinessUserProfileStatus(row.status) ? row.status : "active",
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const mapStoredApplication = (row: Record<string, unknown>): BusinessOnboardingApplication => ({
  id: `business_onboarding_application_${String(row.id)}`,
  tenantId: String(row.tenant_id),
  authUserId: String(row.auth_user_id),
  email: String(row.email),
  currentStep: isOnboardingStep(String(row.current_step)) ? String(row.current_step) as BusinessOnboardingApplication["currentStep"] : "step_1",
  status: isOnboardingStatus(row.status) ? row.status : "draft",
  submittedAt: typeof row.submitted_at === "string" ? row.submitted_at : undefined,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const upsertRuntimeProfile = (state: ApiState, profile: BusinessUserProfile): void => {
  const index = state.businessUserProfiles.findIndex((item) => item.authUserId === profile.authUserId);
  if (index >= 0) {
    state.businessUserProfiles[index] = profile;
    return;
  }
  state.businessUserProfiles.push(profile);
};

const upsertRuntimeApplication = (state: ApiState, application: BusinessOnboardingApplication): void => {
  const index = state.businessOnboardingApplications.findIndex((item) => item.authUserId === application.authUserId);
  if (index >= 0) {
    state.businessOnboardingApplications[index] = application;
    return;
  }
  state.businessOnboardingApplications.push(application);
};

const upsertRuntimeStepPayload = (state: ApiState, stepPayload: OnboardingStepPayload): void => {
  const index = state.onboardingStepPayloads.findIndex(
    (item) => item.applicationId === stepPayload.applicationId && item.stepKey === stepPayload.stepKey
  );
  if (index >= 0) {
    state.onboardingStepPayloads[index] = stepPayload;
    return;
  }
  state.onboardingStepPayloads.push(stepPayload);
};

const upsertRuntimeBusinessClient = (state: ApiState, businessClient: BusinessClient): void => {
  const index = state.businessClients.findIndex((item) => item.id === businessClient.id);
  if (index >= 0) {
    state.businessClients[index] = {
      ...state.businessClients[index],
      ...businessClient
    };
    return;
  }
  state.businessClients.push(businessClient);
};

const businessClientFromOnboarding = (
  state: ApiState,
  application: BusinessOnboardingApplication,
  stepPayloads: Record<string, Record<string, unknown>>,
  now: string
): BusinessClient => {
  const step2 = stepPayloads.step_2 ?? {};
  const legalName =
    stringPayload(step2, "legalBusinessName") ??
    stringPayload(step2, "legalName") ??
    application.email.split("@")[0] ??
    "Submitted Business Client";
  return {
    id: uuidFromRuntimeId(application.id) ?? newId("client"),
    tenantId: persistentTenantId(state),
    legalName,
    country: countryCodeFromPayload(step2),
    onboardingStatus: "submitted",
    createdAt: application.createdAt || now
  };
};

const createOrReuseInvitation = (state: ApiState, email: string): BusinessOnboardingInvitation => {
  const existing = state.businessOnboardingInvitations.find(
    (item) => item.email === email && ["requested", "sent", "accepted"].includes(item.status)
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const invitation: BusinessOnboardingInvitation = {
    id: newId("business_invitation"),
    tenantId: state.tenantId,
    email,
    status: "requested",
    idempotencyKey: newId("idem"),
    createdAt: now,
    updatedAt: now
  };
  state.businessOnboardingInvitations.push(invitation);
  return invitation;
};

const markInvitationSent = (invitation: BusinessOnboardingInvitation, supabaseUserId?: string) => {
  const now = new Date().toISOString();
  invitation.status = "sent";
  invitation.supabaseUserId = supabaseUserId ?? invitation.supabaseUserId;
  invitation.invitedAt = invitation.invitedAt ?? now;
  invitation.updatedAt = now;
};

const authenticateBusinessUser = async (headers: Record<string, string | undefined>): Promise<AuthenticatedBusinessUser | undefined> => {
  const header = headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  if (!token) return undefined;

  const supabase = supabaseAdminClient();
  if (!supabase) {
    if (process.env.ALLOW_DEV_WITHOUT_SUPABASE !== "true") return undefined;
    const authUserId = headers["x-dev-auth-user-id"];
    const email = headers["x-dev-auth-email"];
    if (!authUserId || !email) return undefined;
    return { authUserId, email: normalizeEmail(email) };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user?.email) return undefined;
  return {
    authUserId: data.user.id,
    email: normalizeEmail(data.user.email)
  };
};

const supabaseAdminClient = (): SupabaseClient | undefined => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

const inviteRedirectUrl = (): string => process.env.AUTH_INVITE_REDIRECT_URL ?? "http://localhost:5173/auth/set-password";

const checkRateLimit = (key: string): boolean => {
  const now = Date.now();
  const current = invitationAttempts.get(key);
  if (!current || current.resetAt <= now) {
    invitationAttempts.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return true;
  }
  current.count += 1;
  return current.count <= maxAttemptsPerWindow;
};

const isExistingSupabaseUserError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("user already") ||
    normalized.includes("already exists")
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringPayload = (payload: Record<string, unknown>, key: string): string | undefined => {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const isOnboardingStep = (value: string): value is BusinessOnboardingApplication["currentStep"] =>
  ["step_1", "step_2", "step_3", "step_4", "pending_review", "reviewd"].includes(value);

const isOnboardingStatus = (value: unknown): value is BusinessOnboardingApplication["status"] =>
  typeof value === "string" && ["draft", "submitted", "pending_review", "needs_information", "approved", "rejected"].includes(value);

const isBusinessUserProfileStatus = (value: unknown): value is BusinessUserProfile["status"] =>
  typeof value === "string" && ["invited", "active", "disabled"].includes(value);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidFromRuntimeId = (value?: string): string | undefined => {
  if (!value) return undefined;
  const candidate = value.includes("_") ? value.split("_").at(-1) : value;
  return candidate && uuidPattern.test(candidate) ? candidate : undefined;
};

const persistInvitation = async (invitation?: BusinessOnboardingInvitation): Promise<void> => {
  if (!invitation) return;
  const id = uuidFromRuntimeId(invitation.id);
  if (!id) return;
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const existing = await supabase
    .from("business_onboarding_invitations")
    .select("id")
    .eq("tenant_id", invitation.tenantId)
    .ilike("email", invitation.email)
    .in("status", ["requested", "sent", "accepted"])
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`business_onboarding_invitations_select_failed: ${existing.error.message}`);

  const { error } = await supabase
    .from("business_onboarding_invitations")
    .upsert(
      {
        id: existing.data?.id ?? id,
        tenant_id: invitation.tenantId,
        email: invitation.email,
        status: invitation.status,
        supabase_user_id: uuidFromRuntimeId(invitation.supabaseUserId) ?? null,
        idempotency_key: invitation.idempotencyKey,
        invited_at: invitation.invitedAt ?? null,
        accepted_at: invitation.acceptedAt ?? null,
        expires_at: invitation.expiresAt ?? null,
        created_at: invitation.createdAt,
        updated_at: invitation.updatedAt
      },
      { onConflict: "id" }
    );
  if (error) throw new Error(`business_onboarding_invitations_upsert_failed: ${error.message}`);
};

const persistOnboardingBundle = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser,
  bundle: { profile: BusinessUserProfile; application: BusinessOnboardingApplication }
): Promise<void> => {
  const invitation = state.businessOnboardingInvitations.find((item) => item.email === auth.email);
  await persistInvitation(invitation);
  await persistBusinessUserProfile(bundle.profile);
  await persistOnboardingApplication(bundle.application);
};

const persistBusinessUserProfile = async (profile: BusinessUserProfile): Promise<void> => {
  const id = uuidFromRuntimeId(profile.id);
  const authUserId = uuidFromRuntimeId(profile.authUserId);
  if (!id || !authUserId) return;
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("business_user_profiles")
    .upsert(
      {
        id,
        tenant_id: profile.tenantId,
        auth_user_id: authUserId,
        email: profile.email,
        role: profile.role,
        status: profile.status,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt
      },
      { onConflict: "auth_user_id" }
    );
  if (error) throw new Error(`business_user_profiles_upsert_failed: ${error.message}`);
};

const persistOnboardingApplication = async (application: BusinessOnboardingApplication): Promise<void> => {
  const id = uuidFromRuntimeId(application.id);
  const authUserId = uuidFromRuntimeId(application.authUserId);
  if (!id || !authUserId) return;
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("business_onboarding_applications")
    .upsert(
      {
        id,
        tenant_id: application.tenantId,
        auth_user_id: authUserId,
        email: application.email,
        current_step: application.currentStep,
        status: application.status,
        submitted_at: application.submittedAt ?? null,
        created_at: application.createdAt,
        updated_at: application.updatedAt
      },
      { onConflict: "auth_user_id" }
    );
  if (error) throw new Error(`business_onboarding_applications_upsert_failed: ${error.message}`);
};

const persistSubmittedBusinessClient = async (
  businessClient: BusinessClient,
  application: BusinessOnboardingApplication
): Promise<void> => {
  if (!postgresUrlFromEnv()) return;
  const id = uuidFromRuntimeId(businessClient.id);
  const tenantId = uuidFromRuntimeId(businessClient.tenantId);
  if (!id || !tenantId) return;

  await withPostgresTransaction(async (client) => {
    await client.query(
      `insert into platform_tenants (id, tenant_name)
       values ($1, 'Demo Tenant')
       on conflict (id) do nothing`,
      [tenantId]
    );
    await client.query(
      `insert into business_clients
        (id, platform_tenant_id, legal_name, country, onboarding_status, correlation_id, created_at, updated_at)
       values ($1, $2, $3, $4, 'submitted', $5, $6, $7)
       on conflict (id) do update set
         platform_tenant_id = excluded.platform_tenant_id,
         legal_name = excluded.legal_name,
         country = excluded.country,
         onboarding_status = excluded.onboarding_status,
         correlation_id = excluded.correlation_id,
         updated_at = excluded.updated_at`,
      [
        id,
        tenantId,
        businessClient.legalName,
        businessClient.country,
        `business_onboarding:${uuidFromRuntimeId(application.id) ?? application.id}`,
        businessClient.createdAt,
        application.updatedAt
      ]
    );
  });
};

const persistOnboardingStepPayload = async (step: OnboardingStepPayload): Promise<void> => {
  const id = uuidFromRuntimeId(step.id);
  const applicationId = uuidFromRuntimeId(step.applicationId);
  if (!id || !applicationId) return;
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("onboarding_step_payloads")
    .upsert(
      {
        id,
        tenant_id: step.tenantId,
        application_id: applicationId,
        step_key: step.stepKey,
        payload: step.payload,
        saved_at: step.savedAt
      },
      { onConflict: "application_id,step_key" }
    );
  if (error) throw new Error(`onboarding_step_payloads_upsert_failed: ${error.message}`);
};

const persistentTenantId = (state: ApiState): string => {
  if (uuidFromRuntimeId(state.tenantId)) return state.tenantId;
  return process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
};

const countryCodeFromPayload = (payload: Record<string, unknown>): string => {
  const country = stringPayload(payload, "formationCountry") ?? stringPayload(payload, "country") ?? "US";
  const normalized = country.trim().toLowerCase();
  const mapped: Record<string, string> = {
    "germany": "DE",
    "select jurisdiction": "US",
    "singapore": "SG",
    "united kingdom": "GB",
    "united states": "US",
    "us": "US",
    "usa": "US"
  };
  return mapped[normalized] ?? (country.trim().slice(0, 2).toUpperCase() || "US");
};
