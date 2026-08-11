import type { PostgresQueryClient } from "../postgres-route-types.js";

export interface CircleWebhookRecord {
  id: string;
  status: string;
}

export interface ReprocessedCircleWebhook extends CircleWebhookRecord {
  providerEventId: string;
  eventType: string;
  retryCount: number;
  processedAt?: string;
}

export interface ResolvedReconciliationBreak {
  id: string;
  status: string;
  reason: string;
  webhookEventId?: string;
  suspenseCaseId?: string;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface CircleWebhookRepository {
  findByProviderEventId: (tenantId: string, providerEventId: string) => Promise<CircleWebhookRecord | undefined>;
  insertInvalid: (input: WebhookPersistenceInput & { webhookEventId: string; deadLetterId: string }) => Promise<void>;
  insertReceived: (input: WebhookPersistenceInput & { webhookEventId: string }) => Promise<void>;
  insertDeadLetter: (input: WebhookPersistenceInput & {
    deadLetterId: string;
    errorCode: string;
    errorMessage: string;
    retryCount: number;
  }) => Promise<void>;
  createProcessingSavepoint: () => Promise<void>;
  releaseProcessingSavepoint: () => Promise<void>;
  rollbackProcessingSavepoint: () => Promise<void>;
  updateProcessingStatus: (input: {
    tenantId: string;
    webhookEventId: string;
    status: "processed" | "failed";
    errorCode?: string;
    errorMessage?: string;
    normalized: unknown;
  }) => Promise<void>;
  reprocess: (tenantId: string, webhookEventId: string) => Promise<ReprocessedCircleWebhook | undefined>;
  resolveReconciliationBreak: (
    tenantId: string,
    breakId: string,
    resolutionNote: string,
    actorUserId: string | null
  ) => Promise<ResolvedReconciliationBreak | undefined>;
}

interface WebhookPersistenceInput {
  tenantId: string;
  providerEventId: string;
  eventType: string;
  payload: unknown;
  normalized: unknown;
}

export const createCircleWebhookRepository = (
  client: PostgresQueryClient
): CircleWebhookRepository => ({
  findByProviderEventId: async (tenantId, providerEventId) => {
    const result = await client.query(
      `select id, status
         from provider_webhook_events
        where platform_tenant_id = $1 and provider = 'circle' and provider_event_id = $2
        limit 1`,
      [tenantId, providerEventId]
    );
    const row = result.rows[0];
    return row ? { id: String(row.id), status: String(row.status) } : undefined;
  },

  insertInvalid: async (input) => {
    await client.query(
      `insert into provider_webhook_events
        (id, platform_tenant_id, provider, provider_event_id, event_type, signature_valid, status, payload_json, normalized_json, error_code, error_message)
       values ($1, $2, 'circle', $3, $4, false, 'failed', $5::jsonb, $6::jsonb, 'invalid_signature', 'Circle webhook signature verification failed')`,
      [input.webhookEventId, input.tenantId, input.providerEventId, input.eventType, JSON.stringify(input.payload), JSON.stringify(input.normalized)]
    );
    await client.query(
      `insert into provider_webhook_dead_letters
        (id, platform_tenant_id, provider, provider_event_id, event_type, payload_json, error_code, error_message, retry_count)
       values ($1, $2, 'circle', $3, $4, $5::jsonb, 'invalid_signature', 'Circle webhook signature verification failed', 0)`,
      [input.deadLetterId, input.tenantId, input.providerEventId, input.eventType, JSON.stringify(input.payload)]
    );
  },

  insertReceived: async (input) => {
    await client.query(
      `insert into provider_webhook_events
        (id, platform_tenant_id, provider, provider_event_id, event_type, signature_valid, status, payload_json, normalized_json)
       values ($1, $2, 'circle', $3, $4, true, 'received', $5::jsonb, $6::jsonb)`,
      [input.webhookEventId, input.tenantId, input.providerEventId, input.eventType, JSON.stringify(input.payload), JSON.stringify(input.normalized)]
    );
  },

  insertDeadLetter: async (input) => {
    await client.query(
      `insert into provider_webhook_dead_letters
        (id, platform_tenant_id, provider, provider_event_id, event_type, payload_json, error_code, error_message, retry_count)
       values ($1, $2, 'circle', $3, $4, $5::jsonb, $6, $7, $8)`,
      [
        input.deadLetterId,
        input.tenantId,
        input.providerEventId,
        input.eventType,
        JSON.stringify(input.payload),
        input.errorCode,
        input.errorMessage,
        input.retryCount
      ]
    );
  },

  createProcessingSavepoint: async () => { await client.query("savepoint circle_webhook_processing"); },
  releaseProcessingSavepoint: async () => { await client.query("release savepoint circle_webhook_processing"); },
  rollbackProcessingSavepoint: async () => { await client.query("rollback to savepoint circle_webhook_processing"); },

  updateProcessingStatus: async (input) => {
    await client.query(
      `update provider_webhook_events
          set status = $3,
              processed_at = now(),
              error_code = $4,
              error_message = $5,
              normalized_json = $6::jsonb
        where id = $1 and platform_tenant_id = $2`,
      [
        input.webhookEventId,
        input.tenantId,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        JSON.stringify(input.normalized)
      ]
    );
  },

  reprocess: async (tenantId, webhookEventId) => {
    const result = await client.query(
      `update provider_webhook_events
          set status = 'processed',
              retry_count = coalesce(retry_count, 0) + 1,
              processed_at = now(),
              error_code = null,
              error_message = null
        where id = $1 and platform_tenant_id = $2
        returning id, provider_event_id, event_type, status, retry_count, processed_at`,
      [webhookEventId, tenantId]
    );
    const row = result.rows[0];
    return row ? {
      id: String(row.id),
      providerEventId: String(row.provider_event_id),
      eventType: String(row.event_type),
      status: String(row.status),
      retryCount: Number(row.retry_count),
      processedAt: toIsoString(row.processed_at)
    } : undefined;
  },

  resolveReconciliationBreak: async (tenantId, breakId, resolutionNote, actorUserId) => {
    const result = await client.query(
      `update reconciliation_breaks
          set status = 'resolved',
              resolution_note = $3,
              resolved_by = $4,
              resolved_at = now(),
              updated_at = now()
        where id = $1 and platform_tenant_id = $2
        returning id, status, reason, webhook_event_id, suspense_case_id, resolution_note, resolved_at`,
      [breakId, tenantId, resolutionNote, actorUserId]
    );
    const row = result.rows[0];
    return row ? {
      id: String(row.id),
      status: String(row.status),
      reason: String(row.reason),
      webhookEventId: optionalString(row.webhook_event_id),
      suspenseCaseId: optionalString(row.suspense_case_id),
      resolutionNote: optionalString(row.resolution_note),
      resolvedAt: toIsoString(row.resolved_at)
    } : undefined;
  }
});

const optionalString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

const toIsoString = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
};