import { randomUUID } from "node:crypto";
import { verifyCircleWebhook } from "../modules/circle/index.js";
import type { JsonResponse } from "../http/index.js";
import type { PostgresQueryClient, PostgresRouteInput } from "../db/postgres-route-types.js";
import type { CircleWebhookRepository } from "../db/repositories/circle-webhook-repository.js";

export interface NormalizedCircleWebhookEvent {
  providerEventId: string;
  eventType: string;
  fundingInstructionId?: string;
  providerReferenceId?: string;
  accountOfDigitalAssetId?: string;
  sourceAccountOfDigitalAssetId?: string;
  destinationAccountOfDigitalAssetId?: string;
  amountMinorUnits: string;
  payload: Record<string, unknown>;
}

interface CircleWebhookServiceDependencies {
  repository: CircleWebhookRepository;
  processFundingEvent: (
    client: PostgresQueryClient,
    tenantId: string,
    input: PostgresRouteInput,
    webhookEventId: string,
    event: NormalizedCircleWebhookEvent
  ) => Promise<void>;
  writeAuditAndOutbox: (
    client: PostgresQueryClient,
    tenantId: string,
    input: PostgresRouteInput,
    eventType: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
}

export interface CircleWebhookService {
  ingest: (
    client: PostgresQueryClient,
    tenantId: string,
    input: PostgresRouteInput
  ) => Promise<JsonResponse>;
  reprocess: (
    client: PostgresQueryClient,
    tenantId: string,
    input: PostgresRouteInput,
    webhookEventId: string
  ) => Promise<JsonResponse>;
  resolveReconciliationBreak: (
    client: PostgresQueryClient,
    tenantId: string,
    input: PostgresRouteInput,
    breakId: string
  ) => Promise<JsonResponse>;
}

export const circleWebhookIdempotencyKey = (input: PostgresRouteInput, hash: string): string => {
  const providerEventId = stringBody(input.body, "providerEventId")
    || stringBody(input.body, "eventId")
    || stringBody(input.body, "id");
  return providerEventId ? `circle_webhook_${providerEventId}` : `circle_webhook_${hash}`;
};

export const createCircleWebhookService = (
  dependencies: CircleWebhookServiceDependencies
): CircleWebhookService => ({
  ingest: async (client, tenantId, input) => {
    const rawBody = input.rawBody ?? JSON.stringify(input.body);
    const signature = input.headers?.["circle-signature"] ?? input.headers?.["x-circle-signature"];
    const keyId = input.headers?.["circle-key-id"] ?? input.headers?.["x-circle-key-id"];
    const verification = await verifyCircleWebhook(rawBody, signature, undefined, keyId);
    const providerEventId = stringBody(input.body, "providerEventId")
      || stringBody(input.body, "eventId")
      || stringBody(input.body, "id")
      || verification.providerEventId;
    const eventType = stringBody(input.body, "eventType")
      || stringBody(input.body, "type")
      || verification.eventType;
    if (!providerEventId || !eventType) {
      return { status: 400, body: { error: "provider_event_id_and_event_type_required" } };
    }

    const existing = await dependencies.repository.findByProviderEventId(tenantId, providerEventId);
    if (existing) {
      return {
        status: 200,
        body: {
          webhookEventId: existing.id,
          duplicate: true,
          status: existing.status
        }
      };
    }

    const signatureValid = input.body.signatureValid === false ? false : verification.valid;
    const normalized = normalizeCircleWebhookPayload(input.body, providerEventId, eventType);

    if (!signatureValid) {
      const webhookEventId = randomUUID();
      const deadLetterId = randomUUID();
      await dependencies.repository.insertInvalid({
        webhookEventId,
        deadLetterId,
        tenantId,
        providerEventId,
        eventType,
        payload: input.body,
        normalized
      });
      await dependencies.writeAuditAndOutbox(client, tenantId, input, "circle.webhook.dead_lettered", {
        webhookEventId,
        providerEventId,
        eventType,
        deadLetterId,
        reason: "invalid_signature"
      });
      return { status: 400, body: { error: "invalid_signature", webhookEventId, deadLetterId } };
    }

    const webhookEventId = randomUUID();
    await dependencies.repository.insertReceived({
      webhookEventId,
      tenantId,
      providerEventId,
      eventType,
      payload: input.body,
      normalized
    });

    let processingStatus: "processed" | "failed" = "processed";
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let deadLetterId: string | undefined;

    await dependencies.repository.createProcessingSavepoint();
    try {
      await dependencies.processFundingEvent(client, tenantId, input, webhookEventId, normalized);
      await dependencies.repository.releaseProcessingSavepoint();
    } catch (error) {
      await dependencies.repository.rollbackProcessingSavepoint();
      await dependencies.repository.releaseProcessingSavepoint();
      processingStatus = "failed";
      errorCode = "webhook_processing_failed";
      errorMessage = error instanceof Error ? error.message : "circle_webhook_processing_failed";
      deadLetterId = randomUUID();
      await dependencies.repository.insertDeadLetter({
        deadLetterId,
        tenantId,
        providerEventId,
        eventType,
        payload: input.body,
        normalized,
        errorCode,
        errorMessage,
        retryCount: 1
      });
    }

    await dependencies.repository.updateProcessingStatus({
      tenantId,
      webhookEventId,
      status: processingStatus,
      errorCode,
      errorMessage,
      normalized
    });

    if (processingStatus === "failed") {
      await dependencies.writeAuditAndOutbox(client, tenantId, input, "circle.webhook.processing_failed", {
        webhookEventId,
        providerEventId,
        eventType,
        errorCode,
        errorMessage,
        deadLetterId
      });
      return {
        status: 500,
        body: {
          error: errorCode,
          message: errorMessage,
          webhookEventId,
          deadLetterId
        }
      };
    }

    await dependencies.writeAuditAndOutbox(client, tenantId, input, "circle.webhook.processed", {
      webhookEventId,
      providerEventId,
      eventType
    });
    return { status: 202, body: { webhookEventId, providerEventId, eventType, status: "processed" } };
  },

  reprocess: async (client, tenantId, input, webhookEventId) => {
    const event = await dependencies.repository.reprocess(tenantId, webhookEventId);
    if (!event) return { status: 404, body: { error: "webhook_event_not_found" } };
    await dependencies.writeAuditAndOutbox(client, tenantId, input, "circle.webhook.reprocessed", {
      webhookEventId,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      retryCount: event.retryCount
    });
    return {
      status: 200,
      body: {
        webhookEvent: {
          id: event.id,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          status: event.status,
          retryCount: event.retryCount,
          processedAt: event.processedAt
        }
      }
    };
  },

  resolveReconciliationBreak: async (client, tenantId, input, breakId) => {
    const resolutionNote = stringBody(input.body, "resolutionNote", "Resolved by operator");
    const row = await dependencies.repository.resolveReconciliationBreak(
      tenantId,
      breakId,
      resolutionNote,
      asUuidOrNull(input.actorUserId)
    );
    if (!row) return { status: 404, body: { error: "reconciliation_break_not_found" } };
    await dependencies.writeAuditAndOutbox(client, tenantId, input, "reconciliation.break.resolved", {
      reconciliationBreakId: breakId,
      resolutionNote
    });
    return {
      status: 200,
      body: {
        break: {
          id: row.id,
          status: row.status,
          reason: row.reason,
          webhookEventId: row.webhookEventId,
          suspenseCaseId: row.suspenseCaseId,
          resolutionNote: row.resolutionNote,
          resolvedAt: row.resolvedAt
        }
      }
    };
  }
});

const normalizeCircleWebhookPayload = (
  payload: Record<string, unknown>,
  providerEventId: string,
  eventType: string
): NormalizedCircleWebhookEvent => {
  const payloadRecord = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload)
    ? payload.payload as Record<string, unknown>
    : undefined;

  const accountOfDigitalAssetId = optionalStringBody(payload, "accountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "accountOfDigitalAssetId")
    ?? optionalStringBody(payload, "destinationAccountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "destinationAccountOfDigitalAssetId");
  const sourceAccountOfDigitalAssetId = optionalStringBody(payload, "sourceAccountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "sourceAccountOfDigitalAssetId");
  const destinationAccountOfDigitalAssetId = optionalStringBody(payload, "destinationAccountOfDigitalAssetId")
    ?? optionalStringBody(payloadRecord ?? {}, "destinationAccountOfDigitalAssetId")
    ?? accountOfDigitalAssetId;

  return {
    providerEventId,
    eventType,
    fundingInstructionId: optionalStringBody(payload, "fundingInstructionId")
      ?? optionalStringBody(payloadRecord ?? {}, "fundingInstructionId"),
    providerReferenceId: optionalStringBody(payload, "providerReferenceId")
      ?? optionalStringBody(payloadRecord ?? {}, "providerReferenceId")
      ?? optionalStringBody(payload, "transactionId")
      ?? optionalStringBody(payloadRecord ?? {}, "transactionId"),
    accountOfDigitalAssetId,
    sourceAccountOfDigitalAssetId,
    destinationAccountOfDigitalAssetId,
    amountMinorUnits: stringBody(payload, "amountMinorUnits", stringBody(payloadRecord ?? {}, "amountMinorUnits", "0")),
    payload
  };
};

const optionalStringBody = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const stringBody = (body: Record<string, unknown>, key: string, fallback = ""): string => {
  const value = body[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return fallback;
};

const asUuidOrNull = (value: string | undefined): string | null => {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
};