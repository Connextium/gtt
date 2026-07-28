import { randomUUID } from "node:crypto";
import type {
  ApiState,
  BusinessClient,
  BusinessOnboardingApplication,
  CircleKybEvidence,
  OnboardingRfiTask,
  OnboardingStatusEvent,
  OnboardingStepPayload
} from "../data.js";
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
  rfiTasks: OnboardingRfiTask[];
  statusEvents: OnboardingStatusEvent[];
  circleKybEvidence: CircleKybEvidence[];
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
    assigneeEmail?: string;
    dueAt?: string;
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
      reviewActions: [],
      rfiTasks: state.onboardingRfiTasks.filter((item) => item.applicationId === application.id),
      statusEvents: state.onboardingStatusEvents.filter((item) => item.applicationId === application.id),
      circleKybEvidence: state.circleKybEvidence.filter((item) => item.applicationId === application.id)
    }))
    .sort((left, right) => right.application.updatedAt.localeCompare(left.application.updatedAt));

const decideInState = (
  state: ApiState,
  input: {
    action: BusinessOnboardingReviewActionType;
    actorEmail?: string;
    assigneeEmail?: string;
    dueAt?: string;
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
    businessClient.circleApplicationId = `circle_app_${application.id}`;
    businessClient.circleClientEntityId = `circle_entity_${application.id}`;
    upsertBusinessClient(state, businessClient);
    state.circleKybEvidence.push(createStateKybEvidence(application, businessClient, input, now));
  }
  if (input.action === "requested_information") {
    state.onboardingRfiTasks.push({
      id: newId("onboarding_rfi_task"),
      tenantId: application.tenantId,
      applicationId: application.id,
      businessClientId: state.businessClients.find((client) => client.id === runtimeUuid(application.id) || client.id === application.id)?.id,
      status: "open",
      requestedFields: input.requestedFields ?? [],
      note: input.note,
      requesterEmail: input.actorEmail,
      assigneeEmail: input.assigneeEmail,
      dueAt: input.dueAt,
      createdAt: now,
      updatedAt: now
    });
  }
  state.onboardingStatusEvents.push({
    id: newId("onboarding_status_event"),
    tenantId: application.tenantId,
    applicationId: application.id,
    businessClientId: state.businessClients.find((client) => client.id === runtimeUuid(application.id) || client.id === application.id)?.id,
    previousStatus: undefined,
    nextStatus: application.status,
    source: "internal_review",
    actorEmail: input.actorEmail,
    payload: { action: input.action, note: input.note, requestedFields: input.requestedFields ?? [] },
    createdAt: now
  });
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
    }],
    rfiTasks: state.onboardingRfiTasks.filter((item) => item.applicationId === application.id),
    statusEvents: state.onboardingStatusEvents.filter((item) => item.applicationId === application.id),
    circleKybEvidence: state.circleKybEvidence.filter((item) => item.applicationId === application.id)
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
  const rfiTasksByApplication = await rfiTasksByApplicationWithPostgres(pool, ids);
  const statusEventsByApplication = await statusEventsByApplicationWithPostgres(pool, ids);
  const kybEvidenceByApplication = await kybEvidenceByApplicationWithPostgres(pool, ids);
  return applications.rows.map((row) => {
    const application = mapApplicationRow(row);
    return {
      application,
      businessClient: clientsByApplication.get(row.id),
      stepPayloads: payloadsByApplication.get(row.id) ?? {},
      reviewActions: actionsByApplication.get(row.id) ?? [],
      rfiTasks: rfiTasksByApplication.get(row.id) ?? [],
      statusEvents: statusEventsByApplication.get(row.id) ?? [],
      circleKybEvidence: kybEvidenceByApplication.get(row.id) ?? []
    };
  });
};

const decideWithPostgres = async (input: {
  action: BusinessOnboardingReviewActionType;
  actorEmail?: string;
  assigneeEmail?: string;
  dueAt?: string;
  applicationId: string;
  note?: string;
  requestedFields?: string[];
}): Promise<AdminBusinessOnboardingApplication> => {
  const applicationUuid = runtimeUuid(input.applicationId);
  if (!applicationUuid) throw new Error("invalid_application_id");
  return withPostgresTransaction(async (client) => {
    const now = new Date().toISOString();
    const before = await client.query<ApplicationRow>(
      `select id, tenant_id, auth_user_id, email, current_step, status, submitted_at, created_at, updated_at
       from business_onboarding_applications
       where id = $1
       for update`,
      [applicationUuid]
    );
    const previous = before.rows[0];
    if (!previous) throw new Error("business_onboarding_application_not_found");

    const status = statusForAction(input.action);
    const step = input.action === "requested_information" ? "pending_review" : "reviewd";
    const updated = await client.query<ApplicationRow>(
      `update business_onboarding_applications
       set status = $2, current_step = $3, updated_at = $4
       where id = $1
       returning id, tenant_id, auth_user_id, email, current_step, status, submitted_at, created_at, updated_at`,
      [applicationUuid, status, step, now]
    );
    const application = updated.rows[0];
    if (!application) throw new Error("business_onboarding_application_not_found");
    const mappedApplication = mapApplicationRow(application);

    await client.query(
      `insert into business_onboarding_review_actions
        (id, tenant_id, application_id, action, note, requested_fields, actor_email, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), application.tenant_id, applicationUuid, input.action, input.note ?? null, input.requestedFields ?? [], input.actorEmail ?? null, now]
    );

    const payloads = await payloadsByApplicationWithPostgres(client, [applicationUuid]);
    const stepPayloads = payloads.get(applicationUuid) ?? {};
    let businessClient = businessClientFromApplication({ tenantId: application.tenant_id } as ApiState, mappedApplication, stepPayloads);
    let persistedBusinessClientId = runtimeUuid(businessClient.id) ?? applicationUuid;
    let providerApplicationId: string | undefined;
    let providerClientEntityId: string | undefined;

    if (input.action === "approved") {
      providerApplicationId = `circle_app_${applicationUuid}`;
      providerClientEntityId = `circle_entity_${applicationUuid}`;
      businessClient.onboardingStatus = "approved";
      businessClient.circleApplicationId = providerApplicationId;
      businessClient.circleClientEntityId = providerClientEntityId;
      await upsertApprovedBusinessClientWithPostgres(client, mappedApplication, stepPayloads, now, {
        providerApplicationId,
        providerClientEntityId
      });
      persistedBusinessClientId = applicationUuid;
      await insertCircleKybEvidenceWithPostgres(client, {
        application,
        businessClientId: persistedBusinessClientId,
        input,
        now,
        providerApplicationId,
        providerClientEntityId
      });
    } else {
      const clients = await clientsByApplicationWithPostgres(client, [applicationUuid]);
      businessClient = clients.get(applicationUuid) ?? businessClient;
      persistedBusinessClientId = runtimeUuid(businessClient.id) ?? applicationUuid;
    }

    if (input.action === "requested_information") {
      await client.query(
        `insert into onboarding_rfi_tasks
          (id, platform_tenant_id, onboarding_application_id, business_client_id, status, requested_fields, note, requester_email, assignee_email, due_at, created_at, updated_at)
         values ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9, $10, $10)`,
        [
          randomUUID(),
          tenantUuid(application.tenant_id),
          applicationUuid,
          persistedBusinessClientId,
          input.requestedFields ?? [],
          input.note ?? null,
          input.actorEmail ?? null,
          input.assigneeEmail ?? null,
          input.dueAt ?? null,
          now
        ]
      );
    }

    await client.query(
      `insert into onboarding_status_events
        (id, platform_tenant_id, onboarding_application_id, business_client_id, previous_status, next_status, source, actor_email, payload, created_at)
       values ($1, $2, $3, $4, $5, $6, 'internal_review', $7, $8, $9)`,
      [
        randomUUID(),
        tenantUuid(application.tenant_id),
        applicationUuid,
        persistedBusinessClientId,
        previous.status,
        status,
        input.actorEmail ?? null,
        JSON.stringify({ action: input.action, note: input.note, requestedFields: input.requestedFields ?? [] }),
        now
      ]
    );

    await client.query(
      `insert into business_client_lifecycle_transitions
        (id, platform_tenant_id, business_client_id, from_status, to_status, reason, actor_role, correlation_id, idempotency_key, created_at)
       values ($1, $2, $3, $4, $5, $6, 'internal_review', $7, $8, $9)`,
      [
        randomUUID(),
        tenantUuid(application.tenant_id),
        persistedBusinessClientId,
        previous.status,
        status === "rejected" ? "restricted" : status,
        input.note ?? null,
        `business_onboarding:${applicationUuid}`,
        `business_onboarding:${applicationUuid}:${input.action}`,
        now
      ]
    ).catch(() => undefined);

    await client.query(
      `insert into audit_events
        (id, platform_tenant_id, event_type, request_path, request_method, correlation_id, idempotency_key, payload, created_at)
       values ($1, $2, $3, $4, 'POST', $5, $6, $7, $8)`,
      [
        randomUUID(),
        tenantUuid(application.tenant_id),
        `business_onboarding.${input.action}`,
        `/admin/business-onboarding/applications/${applicationUuid}/${input.action}`,
        `business_onboarding:${applicationUuid}`,
        `business_onboarding:${applicationUuid}:${input.action}`,
        JSON.stringify({ applicationId: applicationUuid, actorEmail: input.actorEmail, note: input.note }),
        now
      ]
    ).catch(() => undefined);

    await client.query(
      `insert into event_outbox (id, platform_tenant_id, event_type, payload, status, created_at)
       values ($1, $2, $3, $4, 'pending', $5)`,
      [
        randomUUID(),
        tenantUuid(application.tenant_id),
        `business_onboarding.${input.action}`,
        JSON.stringify({ applicationId: applicationUuid, businessClientId: persistedBusinessClientId, providerApplicationId, providerClientEntityId, note: input.note, requestedFields: input.requestedFields ?? [], actorEmail: input.actorEmail }),
        now
      ]
    ).catch(() => undefined);

    const [actionsByApplication, rfiTasksByApplication, statusEventsByApplication, kybEvidenceByApplication] = await Promise.all([
      actionsByApplicationWithPostgres(client, [applicationUuid]),
      rfiTasksByApplicationWithPostgres(client, [applicationUuid]),
      statusEventsByApplicationWithPostgres(client, [applicationUuid]),
      kybEvidenceByApplicationWithPostgres(client, [applicationUuid])
    ]);

    return {
      application: mappedApplication,
      businessClient,
      stepPayloads,
      reviewActions: actionsByApplication.get(applicationUuid) ?? [],
      rfiTasks: rfiTasksByApplication.get(applicationUuid) ?? [],
      statusEvents: statusEventsByApplication.get(applicationUuid) ?? [],
      circleKybEvidence: kybEvidenceByApplication.get(applicationUuid) ?? []
    };
  });
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
      reviewActions: actionsByApplication.get(String(row.id)) ?? [],
      rfiTasks: [],
      statusEvents: [],
      circleKybEvidence: []
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
    }],
    rfiTasks: [],
    statusEvents: [],
    circleKybEvidence: []
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

const rfiTasksByApplicationWithPostgres = async (client: Queryable, applicationIds: string[]): Promise<Map<string, OnboardingRfiTask[]>> => {
  const result = new Map<string, OnboardingRfiTask[]>();
  if (!applicationIds.length) return result;
  const tasks = await client.query<RfiTaskRow>(
    `select id, platform_tenant_id, onboarding_application_id, business_client_id, status, requested_fields, note, requester_email, assignee_email, due_at, resolved_at, created_at, updated_at
     from onboarding_rfi_tasks
     where onboarding_application_id = any($1::uuid[])
     order by created_at desc`,
    [applicationIds]
  ).catch((error: unknown) => {
    if (isMissingTableError(error, "onboarding_rfi_tasks")) return { rows: [] as RfiTaskRow[] };
    throw error;
  });
  for (const row of tasks.rows) {
    const items = result.get(row.onboarding_application_id) ?? [];
    items.push({
      id: `onboarding_rfi_task_${row.id}`,
      tenantId: row.platform_tenant_id,
      applicationId: `business_onboarding_application_${row.onboarding_application_id}`,
      businessClientId: row.business_client_id ?? undefined,
      status: row.status,
      requestedFields: row.requested_fields ?? [],
      note: row.note ?? undefined,
      requesterEmail: row.requester_email ?? undefined,
      assigneeEmail: row.assignee_email ?? undefined,
      dueAt: row.due_at ?? undefined,
      resolvedAt: row.resolved_at ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    });
    result.set(row.onboarding_application_id, items);
  }
  return result;
};

const statusEventsByApplicationWithPostgres = async (client: Queryable, applicationIds: string[]): Promise<Map<string, OnboardingStatusEvent[]>> => {
  const result = new Map<string, OnboardingStatusEvent[]>();
  if (!applicationIds.length) return result;
  const events = await client.query<StatusEventRow>(
    `select id, platform_tenant_id, onboarding_application_id, business_client_id, previous_status, next_status, source, provider_event_id, idempotency_key, actor_email, payload, created_at
     from onboarding_status_events
     where onboarding_application_id = any($1::uuid[])
     order by created_at desc`,
    [applicationIds]
  ).catch((error: unknown) => {
    if (isMissingTableError(error, "onboarding_status_events")) return { rows: [] as StatusEventRow[] };
    throw error;
  });
  for (const row of events.rows) {
    const items = result.get(row.onboarding_application_id) ?? [];
    items.push({
      id: `onboarding_status_event_${row.id}`,
      tenantId: row.platform_tenant_id,
      applicationId: `business_onboarding_application_${row.onboarding_application_id}`,
      businessClientId: row.business_client_id ?? undefined,
      previousStatus: row.previous_status ?? undefined,
      nextStatus: row.next_status,
      source: row.source,
      providerEventId: row.provider_event_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      actorEmail: row.actor_email ?? undefined,
      payload: row.payload ?? {},
      createdAt: row.created_at
    });
    result.set(row.onboarding_application_id, items);
  }
  return result;
};

const kybEvidenceByApplicationWithPostgres = async (client: Queryable, applicationIds: string[]): Promise<Map<string, CircleKybEvidence[]>> => {
  const result = new Map<string, CircleKybEvidence[]>();
  if (!applicationIds.length) return result;
  const evidence = await client.query<KybEvidenceRow>(
    `select id, platform_tenant_id, onboarding_application_id, business_client_id, operation_type, provider, provider_application_id, provider_client_entity_id, provider_event_id, provider_status, idempotency_key, correlation_id, request_payload, response_payload, raw_payload, created_at
     from circle_kyb_evidence
     where onboarding_application_id = any($1::uuid[])
     order by created_at desc`,
    [applicationIds]
  ).catch((error: unknown) => {
    if (isMissingTableError(error, "circle_kyb_evidence")) return { rows: [] as KybEvidenceRow[] };
    throw error;
  });
  for (const row of evidence.rows) {
    const items = result.get(row.onboarding_application_id) ?? [];
    items.push({
      id: `circle_kyb_evidence_${row.id}`,
      tenantId: row.platform_tenant_id,
      applicationId: `business_onboarding_application_${row.onboarding_application_id}`,
      businessClientId: row.business_client_id ?? undefined,
      operationType: row.operation_type,
      provider: "circle",
      providerApplicationId: row.provider_application_id ?? undefined,
      providerClientEntityId: row.provider_client_entity_id ?? undefined,
      providerEventId: row.provider_event_id ?? undefined,
      providerStatus: row.provider_status,
      idempotencyKey: row.idempotency_key ?? undefined,
      correlationId: row.correlation_id,
      requestPayload: row.request_payload ?? {},
      responsePayload: row.response_payload ?? {},
      rawPayload: row.raw_payload ?? undefined,
      createdAt: row.created_at
    });
    result.set(row.onboarding_application_id, items);
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

interface RfiTaskRow {
  id: string;
  platform_tenant_id: string;
  onboarding_application_id: string;
  business_client_id?: string | null;
  status: OnboardingRfiTask["status"];
  requested_fields?: string[] | null;
  note?: string | null;
  requester_email?: string | null;
  assignee_email?: string | null;
  due_at?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface StatusEventRow {
  id: string;
  platform_tenant_id: string;
  onboarding_application_id: string;
  business_client_id?: string | null;
  previous_status?: string | null;
  next_status: string;
  source: OnboardingStatusEvent["source"];
  provider_event_id?: string | null;
  idempotency_key?: string | null;
  actor_email?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

interface KybEvidenceRow {
  id: string;
  platform_tenant_id: string;
  onboarding_application_id: string;
  business_client_id?: string | null;
  operation_type: CircleKybEvidence["operationType"];
  provider: "circle";
  provider_application_id?: string | null;
  provider_client_entity_id?: string | null;
  provider_event_id?: string | null;
  provider_status: string;
  idempotency_key?: string | null;
  correlation_id: string;
  request_payload?: Record<string, unknown> | null;
  response_payload?: Record<string, unknown> | null;
  raw_payload?: Record<string, unknown> | null;
  created_at: string;
}

const isMissingReviewActionsTableError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  return record.code === "42P01" || message.includes("business_onboarding_review_actions") && message.includes("does not exist");
};

const isMissingTableError = (error: unknown, tableName: string): boolean => {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  return record.code === "42P01" || (message.includes(tableName) && message.includes("does not exist"));
};

const upsertApprovedBusinessClientWithPostgres = async (
  client: Queryable,
  application: BusinessOnboardingApplication,
  stepPayloads: Record<string, Record<string, unknown>>,
  now: string,
  circle?: {
    providerApplicationId: string;
    providerClientEntityId: string;
  }
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
      (id, platform_tenant_id, legal_name, country, onboarding_status, circle_client_entity_id, circle_application_id, correlation_id, created_at, updated_at)
     values ($1, $2, $3, $4, 'approved', $5, $6, $7, $8, $9)
     on conflict (id) do update set
       legal_name = excluded.legal_name,
       country = excluded.country,
       onboarding_status = excluded.onboarding_status,
       circle_client_entity_id = excluded.circle_client_entity_id,
       circle_application_id = excluded.circle_application_id,
       correlation_id = excluded.correlation_id,
       updated_at = excluded.updated_at`,
    [
      runtimeUuid(application.id),
      tenantUuid(application.tenantId),
      businessClient.legalName,
      businessClient.country,
      circle?.providerClientEntityId ?? null,
      circle?.providerApplicationId ?? null,
      `business_onboarding:${runtimeUuid(application.id)}`,
      businessClient.createdAt,
      now
    ]
  );
};

const insertCircleKybEvidenceWithPostgres = async (
  client: Queryable,
  input: {
    application: ApplicationRow;
    businessClientId: string;
    input: {
      action: BusinessOnboardingReviewActionType;
      actorEmail?: string;
      note?: string;
      requestedFields?: string[];
    };
    now: string;
    providerApplicationId: string;
    providerClientEntityId: string;
  }
): Promise<void> => {
  const correlationId = `business_onboarding:${input.application.id}:circle_kyb`;
  const idempotencyKey = `business_onboarding:${input.application.id}:approve:circle_kyb`;
  const requestPayload = {
    applicationId: input.application.id,
    businessClientId: input.businessClientId,
    email: input.application.email,
    actorEmail: input.input.actorEmail,
    note: input.input.note
  };
  const responsePayload = {
    accepted: true,
    simulated: true,
    provider: "circle",
    providerApplicationId: input.providerApplicationId,
    providerClientEntityId: input.providerClientEntityId,
    status: "approved"
  };

  await client.query(
    `insert into circle_kyb_evidence
      (id, platform_tenant_id, onboarding_application_id, business_client_id, operation_type, provider, provider_application_id, provider_client_entity_id, provider_status, idempotency_key, correlation_id, request_payload, response_payload, created_at)
     values ($1, $2, $3, $4, 'kyb_application_create', 'circle', $5, $6, 'approved', $7, $8, $9, $10, $11)`,
    [
      randomUUID(),
      tenantUuid(input.application.tenant_id),
      input.application.id,
      input.businessClientId,
      input.providerApplicationId,
      input.providerClientEntityId,
      idempotencyKey,
      correlationId,
      JSON.stringify(requestPayload),
      JSON.stringify(responsePayload),
      input.now
    ]
  );

  await client.query(
    `insert into circle_api_operations
      (id, platform_tenant_id, operation_type, idempotency_key, request_payload, response_payload, provider_reference_id, status, onboarding_application_id, business_client_id, correlation_id, created_at)
     values ($1, $2, 'client_onboarding', $3, $4, $5, $6, 'complete', $7, $8, $9, $10)`,
    [
      randomUUID(),
      tenantUuid(input.application.tenant_id),
      idempotencyKey,
      JSON.stringify(requestPayload),
      JSON.stringify(responsePayload),
      input.providerApplicationId,
      input.application.id,
      input.businessClientId,
      correlationId,
      input.now
    ]
  ).catch(() => undefined);
};

const createStateKybEvidence = (
  application: BusinessOnboardingApplication,
  businessClient: BusinessClient,
  input: {
    action: BusinessOnboardingReviewActionType;
    actorEmail?: string;
    note?: string;
    requestedFields?: string[];
  },
  now: string
): CircleKybEvidence => ({
  id: newId("circle_kyb_evidence"),
  tenantId: application.tenantId,
  applicationId: application.id,
  businessClientId: businessClient.id,
  operationType: "kyb_application_create",
  provider: "circle",
  providerApplicationId: businessClient.circleApplicationId,
  providerClientEntityId: businessClient.circleClientEntityId,
  providerStatus: "approved",
  idempotencyKey: `business_onboarding:${application.id}:approve:circle_kyb`,
  correlationId: `business_onboarding:${application.id}:circle_kyb`,
  requestPayload: {
    applicationId: application.id,
    businessClientId: businessClient.id,
    actorEmail: input.actorEmail,
    note: input.note
  },
  responsePayload: {
    accepted: true,
    simulated: true,
    providerApplicationId: businessClient.circleApplicationId,
    providerClientEntityId: businessClient.circleClientEntityId,
    status: "approved"
  },
  createdAt: now
});

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
