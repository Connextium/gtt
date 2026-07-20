import { randomUUID } from "node:crypto";
import type { BusinessClient, BusinessOnboardingApplication, OnboardingStepPayload, ApiState } from "../data.js";
import { emitOutbox, newId } from "../data.js";
import { postgresUrlFromEnv } from "./connection.js";
import { getPostgresPool, getSupabaseClient, withPostgresTransaction, type PostgresClient } from "./transaction.js";

export type BusinessOnboardingReviewActionType = "approved" | "rejected" | "requested_information";

export interface BusinessOnboardingReviewAction {
  id: string;
  tenantId: string;
  applicationId: string;
  action: BusinessOnboardingReviewActionType;
  note?: string;
  requestedFields: string[];
  actorEmail?: string;
  createdAt: string;
}

export interface AdminBusinessOnboardingApplication {
  application: BusinessOnboardingApplication;
  businessClient?: BusinessClient;
  stepPayloads: Record<string, Record<string, unknown>>;
  reviewActions: BusinessOnboardingReviewAction[];
}

export const listBusinessOnboardingApplications = async (
  state: ApiState
): Promise<AdminBusinessOnboardingApplication[]> => {
  if (postgresUrlFromEnv()) return listWithPostgres();
  const supabaseItems = await listWithSupabase();
  if (supabaseItems) return supabaseItems;
  return listFromState(state);
};

export const getBusinessOnboardingApplication = async (
  state: ApiState,
  applicationId: string
): Promise<AdminBusinessOnboardingApplication | undefined> => {
  const items = await listBusinessOnboardingApplications(state);
  return items.find((item) => item.application.id === applicationId);
};

export const decideBusinessOnboardingApplication = async (
  state: ApiState,
  input: {
    action: BusinessOnboardingReviewActionType;
    actorEmail?: string;
    applicationId: string;
    note?: string;
    requestedFields?: string[];
  }
): Promise<AdminBusinessOnboardingApplication | undefined> => {
  if (postgresUrlFromEnv()) {
    return decideWithPostgres(input);
  }
  const supabaseHandled = await decideWithSupabase(input);
  if (supabaseHandled) return supabaseHandled;
  return decideInState(state, input);
};

const listFromState = (state: ApiState): AdminBusinessOnboardingApplication[] =>
  state.businessOnboardingApplications
    .map((application) => ({
      application,
      businessClient: state.businessClients.find((client) => client.id === runtimeUuid(application.id) || client.id === application.id),
      stepPayloads: Object.fromEntries(
        state.onboardingStepPayloads
          .filter((item) => item.applicationId === application.id)
          .map((item) => [item.stepKey, item.payload])
      ),
      reviewActions: []
    }))
    .sort((left, right) => right.application.updatedAt.localeCompare(left.application.updatedAt));

const decideInState = (
  state: ApiState,
  input: {
    action: BusinessOnboardingReviewActionType;
    actorEmail?: string;
    applicationId: string;
    note?: string;
    requestedFields?: string[];
  }
): AdminBusinessOnboardingApplication | undefined => {
  const application = state.businessOnboardingApplications.find((item) => item.id === input.applicationId);
  if (!application) return undefined;
  const now = new Date().toISOString();
  application.status = statusForAction(input.action);
  application.currentStep = input.action === "requested_information" ? "pending_review" : "reviewd";
  application.updatedAt = now;
  const stepPayloads = Object.fromEntries(
    state.onboardingStepPayloads
      .filter((item) => item.applicationId === application.id)
      .map((item) => [item.stepKey, item.payload])
  );
  if (input.action === "approved") {
    const businessClient = businessClientFromApplication(state, application, stepPayloads);
    businessClient.onboardingStatus = "approved";
    upsertBusinessClient(state, businessClient);
  }
  emitOutbox(state, `business_onboarding.${input.action}`, {
    applicationId: application.id,
    actorEmail: input.actorEmail,
    note: input.note,
    requestedFields: input.requestedFields ?? []
  });
  return {
    application,
    businessClient: state.businessClients.find((client) => client.id === runtimeUuid(application.id) || client.id === application.id),
    stepPayloads,
    reviewActions: [{
      id: newId("business_onboarding_review_action"),
      tenantId: application.tenantId,
      applicationId: application.id,
      action: input.action,
      note: input.note,
      requestedFields: input.requestedFields ?? [],
      actorEmail: input.actorEmail,
      createdAt: now
    }]
  };
};

const listWithPostgres = async (): Promise<AdminBusinessOnboardingApplication[]> => {
  const pool = getPostgresPool();
  if (!pool) return [];
  const applications = await pool.query<ApplicationRow>(
    `select id, tenant_id, auth_user_id, email, current_step, status, submitted_at, created_at, updated_at
     from business_onboarding_applications
     order by updated_at desc`
  );
  const ids = applications.rows.map((row) => row.id);
  const payloadsByApplication = await payloadsByApplicationWithPostgres(pool, ids);
  const clientsByApplication = await clientsByApplicationWithPostgres(pool, ids);
  const actionsByApplication = await actionsByApplicationWithPostgres(pool, ids);
  return applications.rows.map((row) => {
    const application = mapApplicationRow(row);
    return {
      application,
      businessClient: clientsByApplication.get(row.id),
      stepPayloads: payloadsByApplication.get(row.id) ?? {},
      reviewActions: actionsByApplication.get(row.id) ?? []
    };
  });
};

const decideWithPostgres = async (input: {
  action: BusinessOnboardingReviewActionType;
  actorEmail?: string;
  applicationId: string;
  note?: string;
  requestedFields?: string[];
}): Promise<AdminBusinessOnboardingApplication> => {
  const pool = getPostgresPool();
  const applicationUuid = runtimeUuid(input.applicationId);
  if (!pool) throw new Error("postgres_url_required");
  if (!applicationUuid) throw new Error("invalid_application_id");
  const now = new Date().toISOString();
  const status = statusForAction(input.action);
  const step = input.action === "requested_information" ? "pending_review" : "reviewd";
  const updated = await pool.query<ApplicationRow>(
    `update business_onboarding_applications
     set status = $2, current_step = $3, updated_at = $4
     where id = $1
     returning id, tenant_id, auth_user_id, email, current_step, status, submitted_at, created_at, updated_at`,
    [applicationUuid, status, step, now]
  );
  const application = updated.rows[0];
  if (!application) throw new Error("business_onboarding_application_not_found");
  const mappedApplication = mapApplicationRow(application);
  await pool.query(
    `insert into business_onboarding_review_actions
      (id, tenant_id, application_id, action, note, requested_fields, actor_email, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [randomUUID(), application.tenant_id, applicationUuid, input.action, input.note ?? null, input.requestedFields ?? [], input.actorEmail ?? null, now]
  );
  const payloads = await payloadsByApplicationWithPostgres(pool, [applicationUuid]);
  const stepPayloads = payloads.get(applicationUuid) ?? {};
  let businessClient = businessClientFromApplication({ tenantId: application.tenant_id } as ApiState, mappedApplication, stepPayloads);
  if (input.action === "approved") {
    businessClient.onboardingStatus = "approved";
    await upsertApprovedBusinessClientWithPostgres(pool, mappedApplication, stepPayloads, now);
  } else {
    const clients = await clientsByApplicationWithPostgres(pool, [applicationUuid]);
    businessClient = clients.get(applicationUuid) ?? businessClient;
  }
  await pool.query(
    `insert into outbox_events (id, platform_tenant_id, event_type, payload, status, created_at)
     values ($1, $2, $3, $4, 'pending', $5)`,
    [
      randomUUID(),
      tenantUuid(application.tenant_id),
      `business_onboarding.${input.action}`,
      JSON.stringify({ applicationId: applicationUuid, note: input.note, requestedFields: input.requestedFields ?? [], actorEmail: input.actorEmail }),
      now
    ]
  ).catch(() => undefined);
  return {
    application: mappedApplication,
    businessClient,
    stepPayloads,
    reviewActions: [{
      id: newId("business_onboarding_review_action"),
      tenantId: application.tenant_id,
      applicationId: mappedApplication.id,
      action: input.action,
      note: input.note,
      requestedFields: input.requestedFields ?? [],
      actorEmail: input.actorEmail,
      createdAt: now
    }]
  };
};

const listWithSupabase = async (): Promise<AdminBusinessOnboardingApplication[] | undefined> => {
  const client = getSupabaseClient();
  if (!client) return undefined;
  const result = await client
    .from("business_onboarding_applications")
    .select("*")
    .order("updated_at", { ascending: false });
  if (result.error) throw result.error;
  const ids = (result.data ?? []).map((row) => String(row.id));
  const [payloadsByApplication, clientsByApplication, actionsByApplication] = await Promise.all([
    payloadsByApplicationWithSupabase(ids),
    clientsByApplicationWithSupabase(ids),
    actionsByApplicationWithSupabase(ids)
  ]);
  return (result.data ?? []).map((row) => {
    const application = mapApplicationRow(row as ApplicationRow);
    return {
      application,
      businessClient: clientsByApplication.get(String(row.id)),
      stepPayloads: payloadsByApplication.get(String(row.id)) ?? {},
      reviewActions: actionsByApplication.get(String(row.id)) ?? []
    };
  });
};

const decideWithSupabase = async (input: {
  action: BusinessOnboardingReviewActionType;
  actorEmail?: string;
  applicationId: string;
  note?: string;
  requestedFields?: string[];
}): Promise<AdminBusinessOnboardingApplication | undefined> => {
  const client = getSupabaseClient();
  const applicationUuid = runtimeUuid(input.applicationId);
  if (!client || !applicationUuid) return undefined;
  const now = new Date().toISOString();
  const { data, error } = await client
    .from("business_onboarding_applications")
    .update({
      status: statusForAction(input.action),
      current_step: input.action === "requested_information" ? "pending_review" : "reviewd",
      updated_at: now
    })
    .eq("id", applicationUuid)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const actionResult = await client.from("business_onboarding_review_actions").insert({
    tenant_id: data.tenant_id,
    application_id: applicationUuid,
    action: input.action,
    note: input.note ?? null,
    requested_fields: input.requestedFields ?? [],
    actor_email: input.actorEmail ?? null,
    created_at: now
  });
  if (actionResult.error) throw actionResult.error;
  if (input.action === "approved") {
    const payloads = await payloadsByApplicationWithSupabase([applicationUuid]);
    const businessClient = businessClientFromApplication({ tenantId: String(data.tenant_id) } as ApiState, mapApplicationRow(data as ApplicationRow), payloads.get(applicationUuid) ?? {});
    const clientResult = await client.from("business_clients").upsert({
      id: applicationUuid,
      platform_tenant_id: tenantUuid(String(data.tenant_id)),
      legal_name: businessClient.legalName,
      country: businessClient.country,
      onboarding_status: "approved",
      correlation_id: `business_onboarding:${applicationUuid}`,
      created_at: businessClient.createdAt,
      updated_at: now
    });
    if (clientResult.error) throw clientResult.error;
  }
  const mappedApplication = mapApplicationRow(data as ApplicationRow);
  const payloads = await payloadsByApplicationWithSupabase([applicationUuid]);
  const stepPayloads = payloads.get(applicationUuid) ?? {};
  const clients = await clientsByApplicationWithSupabase([applicationUuid]);
  return {
    application: mappedApplication,
    businessClient: clients.get(applicationUuid) ?? businessClientFromApplication({ tenantId: String(data.tenant_id) } as ApiState, mappedApplication, stepPayloads),
    stepPayloads,
    reviewActions: [{
      id: newId("business_onboarding_review_action"),
      tenantId: String(data.tenant_id),
      applicationId: mappedApplication.id,
      action: input.action,
      note: input.note,
      requestedFields: input.requestedFields ?? [],
      actorEmail: input.actorEmail,
      createdAt: now
    }]
  };
};

type Queryable = Pick<PostgresClient, "query">;

interface ApplicationRow {
  id: string;
  tenant_id: string;
  auth_user_id: string;
  email: string;
  current_step: string;
  status: string;
  submitted_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface StepPayloadRow {
  id: string;
  tenant_id: string;
  application_id: string;
  step_key: string;
  payload: Record<string, unknown>;
  saved_at: string;
}

const payloadsByApplicationWithPostgres = async (client: Queryable, applicationIds: string[]): Promise<Map<string, Record<string, Record<string, unknown>>>> => {
  const result = new Map<string, Record<string, Record<string, unknown>>>();
  if (!applicationIds.length) return result;
  const payloads = await client.query<StepPayloadRow>(
    `select id, tenant_id, application_id, step_key, payload, saved_at
     from onboarding_step_payloads
     where application_id = any($1::uuid[])`,
    [applicationIds]
  );
  for (const row of payloads.rows) {
    const current = result.get(row.application_id) ?? {};
    current[row.step_key] = row.payload ?? {};
    result.set(row.application_id, current);
  }
  return result;
};

const clientsByApplicationWithPostgres = async (client: Queryable, applicationIds: string[]): Promise<Map<string, BusinessClient>> => {
  const result = new Map<string, BusinessClient>();
  if (!applicationIds.length) return result;
  const clients = await client.query<{
    id: string;
    platform_tenant_id: string;
    legal_name: string;
    country: string;
    onboarding_status: BusinessClient["onboardingStatus"];
    circle_client_entity_id?: string | null;
    circle_application_id?: string | null;
    created_at: string;
  }>(
    `select id, platform_tenant_id, legal_name, country, onboarding_status, circle_client_entity_id, circle_application_id, created_at
     from business_clients
     where id = any($1::uuid[]) or correlation_id = any($2::text[])`,
    [applicationIds, applicationIds.map((id) => `business_onboarding:${id}`)]
  );
  for (const row of clients.rows) {
    result.set(row.id, {
      id: row.id,
      tenantId: row.platform_tenant_id,
      legalName: row.legal_name,
      country: row.country,
      onboardingStatus: row.onboarding_status,
      circleClientEntityId: row.circle_client_entity_id ?? undefined,
      circleApplicationId: row.circle_application_id ?? undefined,
      createdAt: row.created_at
    });
  }
  return result;
};

const actionsByApplicationWithPostgres = async (client: Queryable, applicationIds: string[]): Promise<Map<string, BusinessOnboardingReviewAction[]>> => {
  const result = new Map<string, BusinessOnboardingReviewAction[]>();
  if (!applicationIds.length) return result;
  const actions = await client.query<ReviewActionRow>(
      `select id, tenant_id, application_id, action, note, requested_fields, actor_email, created_at
       from business_onboarding_review_actions
       where application_id = any($1::uuid[])
       order by created_at desc`,
      [applicationIds]
    )
    .catch((error: unknown) => {
      if (isMissingReviewActionsTableError(error)) return { rows: [] as ReviewActionRow[] };
      throw error;
    });
  for (const row of actions.rows) {
    const items = result.get(row.application_id) ?? [];
    items.push({
      id: row.id,
      tenantId: row.tenant_id,
      applicationId: `business_onboarding_application_${row.application_id}`,
      action: row.action,
      note: row.note ?? undefined,
      requestedFields: row.requested_fields ?? [],
      actorEmail: row.actor_email ?? undefined,
      createdAt: row.created_at
    });
    result.set(row.application_id, items);
  }
  return result;
};

const payloadsByApplicationWithSupabase = async (applicationIds: string[]): Promise<Map<string, Record<string, Record<string, unknown>>>> => {
  const result = new Map<string, Record<string, Record<string, unknown>>>();
  const client = getSupabaseClient();
  if (!client || !applicationIds.length) return result;
  const payloads = await client.from("onboarding_step_payloads").select("*").in("application_id", applicationIds);
  if (payloads.error) throw payloads.error;
  for (const row of payloads.data ?? []) {
    const id = String(row.application_id);
    const current = result.get(id) ?? {};
    current[String(row.step_key)] = isRecord(row.payload) ? row.payload : {};
    result.set(id, current);
  }
  return result;
};

const clientsByApplicationWithSupabase = async (applicationIds: string[]): Promise<Map<string, BusinessClient>> => {
  const result = new Map<string, BusinessClient>();
  const client = getSupabaseClient();
  if (!client || !applicationIds.length) return result;
  const clients = await client.from("business_clients").select("*").in("id", applicationIds);
  if (clients.error) throw clients.error;
  for (const row of clients.data ?? []) {
    result.set(String(row.id), {
      id: String(row.id),
      tenantId: String(row.platform_tenant_id),
      legalName: String(row.legal_name),
      country: String(row.country),
      onboardingStatus: row.onboarding_status as BusinessClient["onboardingStatus"],
      circleClientEntityId: row.circle_client_entity_id ? String(row.circle_client_entity_id) : undefined,
      circleApplicationId: row.circle_application_id ? String(row.circle_application_id) : undefined,
      createdAt: String(row.created_at)
    });
  }
  return result;
};

const actionsByApplicationWithSupabase = async (applicationIds: string[]): Promise<Map<string, BusinessOnboardingReviewAction[]>> => {
  const result = new Map<string, BusinessOnboardingReviewAction[]>();
  const client = getSupabaseClient();
  if (!client || !applicationIds.length) return result;
  const actions = await client.from("business_onboarding_review_actions").select("*").in("application_id", applicationIds).order("created_at", { ascending: false });
  if (actions.error) {
    if (isMissingReviewActionsTableError(actions.error)) return result;
    throw actions.error;
  }
  for (const row of actions.data ?? []) {
    const applicationId = String(row.application_id);
    const items = result.get(applicationId) ?? [];
    items.push({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      applicationId: `business_onboarding_application_${applicationId}`,
      action: row.action as BusinessOnboardingReviewActionType,
      note: row.note ? String(row.note) : undefined,
      requestedFields: Array.isArray(row.requested_fields) ? row.requested_fields.map(String) : [],
      actorEmail: row.actor_email ? String(row.actor_email) : undefined,
      createdAt: String(row.created_at)
    });
    result.set(applicationId, items);
  }
  return result;
};

interface ReviewActionRow {
  id: string;
  tenant_id: string;
  application_id: string;
  action: BusinessOnboardingReviewActionType;
  note?: string | null;
  requested_fields?: string[] | null;
  actor_email?: string | null;
  created_at: string;
}

const isMissingReviewActionsTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  return record.code === "42P01" || message.includes("business_onboarding_review_actions") && message.includes("does not exist");
};

const upsertApprovedBusinessClientWithPostgres = async (
  client: Queryable,
  application: BusinessOnboardingApplication,
  stepPayloads: Record<string, Record<string, unknown>>,
  now: string
): Promise<void> => {
  const businessClient = businessClientFromApplication({ tenantId: application.tenantId } as ApiState, application, stepPayloads);
  await client.query(
    `insert into platform_tenants (id, tenant_name)
     values ($1, 'Demo Tenant')
     on conflict (id) do nothing`,
    [tenantUuid(application.tenantId)]
  );
  await client.query(
    `insert into business_clients
      (id, platform_tenant_id, legal_name, country, onboarding_status, correlation_id, created_at, updated_at)
     values ($1, $2, $3, $4, 'approved', $5, $6, $7)
     on conflict (id) do update set
       legal_name = excluded.legal_name,
       country = excluded.country,
       onboarding_status = excluded.onboarding_status,
       correlation_id = excluded.correlation_id,
       updated_at = excluded.updated_at`,
    [
      runtimeUuid(application.id),
      tenantUuid(application.tenantId),
      businessClient.legalName,
      businessClient.country,
      `business_onboarding:${runtimeUuid(application.id)}`,
      businessClient.createdAt,
      now
    ]
  );
};

const businessClientFromApplication = (
  state: Pick<ApiState, "tenantId">,
  application: BusinessOnboardingApplication,
  stepPayloads: Record<string, Record<string, unknown>>
): BusinessClient => {
  const businessProfile = stepPayloads.step_2 ?? {};
  return {
    id: runtimeUuid(application.id) ?? application.id,
    tenantId: tenantUuid(application.tenantId || state.tenantId),
    legalName: textValue(businessProfile.legalBusinessName) ?? textValue(businessProfile.legalName) ?? application.email.split("@")[0] ?? "Business Client",
    country: countryCode(businessProfile),
    onboardingStatus: "submitted",
    createdAt: application.createdAt
  };
};

const upsertBusinessClient = (state: ApiState, businessClient: BusinessClient): void => {
  const index = state.businessClients.findIndex((item) => item.id === businessClient.id);
  if (index >= 0) {
    state.businessClients[index] = { ...state.businessClients[index], ...businessClient };
    return;
  }
  state.businessClients.push(businessClient);
};

const mapApplicationRow = (row: ApplicationRow): BusinessOnboardingApplication => ({
  id: `business_onboarding_application_${row.id}`,
  tenantId: row.tenant_id,
  authUserId: row.auth_user_id,
  email: row.email,
  currentStep: isCurrentStep(row.current_step) ? row.current_step : "step_1",
  status: isApplicationStatus(row.status) ? row.status : "draft",
  submittedAt: row.submitted_at ?? undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const statusForAction = (action: BusinessOnboardingReviewActionType): BusinessOnboardingApplication["status"] => {
  if (action === "approved") return "approved";
  if (action === "rejected") return "rejected";
  return "needs_information";
};

const runtimeUuid = (id: string): string | undefined => {
  const match = id.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match?.[0] ?? undefined;
};

const tenantUuid = (tenantId?: string): string => runtimeUuid(tenantId ?? "") ?? process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const textValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const countryCode = (payload: Record<string, unknown>): string => {
  const raw = textValue(payload.formationCountry) ?? textValue(payload.country) ?? "US";
  const mapped: Record<string, string> = {
    "germany": "DE",
    "select jurisdiction": "US",
    "singapore": "SG",
    "united kingdom": "GB",
    "united states": "US"
  };
  return mapped[raw.toLowerCase()] ?? raw.slice(0, 2).toUpperCase();
};

const isCurrentStep = (value: string): value is BusinessOnboardingApplication["currentStep"] =>
  ["step_1", "step_2", "step_3", "step_4", "pending_review", "reviewd"].includes(value);

const isApplicationStatus = (value: string): value is BusinessOnboardingApplication["status"] =>
  ["draft", "submitted", "pending_review", "needs_information", "approved", "rejected"].includes(value);
