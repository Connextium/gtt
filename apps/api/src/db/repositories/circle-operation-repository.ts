import type { CircleHealthResult } from "../../modules/circle/index.js";
import type { PostgresQueryClient, PostgresRouteInput } from "../postgres-route-types.js";

export interface CircleOperationRepository {
  findById: (tenantId: string, operationId: string) => Promise<unknown | undefined>;
  findLatestDiagnostic: (tenantId: string) => Promise<unknown | undefined>;
  recordSandboxDiagnostic: (
    tenantId: string,
    input: PostgresRouteInput,
    operationId: string,
    health: CircleHealthResult
  ) => Promise<void>;
}

export const createCircleOperationRepository = (
  client: PostgresQueryClient
): CircleOperationRepository => ({
  findById: async (tenantId, operationId) => {
    const result = await client.query(
      `${circleOperationSelect}
        where id = $1 and platform_tenant_id = $2`,
      [operationId, tenantId]
    );
    return result.rows[0] ? mapCircleOperationRow(result.rows[0]) : undefined;
  },

  findLatestDiagnostic: async (tenantId) => {
    const result = await client.query(
      `${circleOperationSelect}
        where platform_tenant_id = $1
          and operation_type in ('circle.health_check', 'circle.sandbox_check')
        order by created_at desc
        limit 1`,
      [tenantId]
    );
    return result.rows[0] ? mapCircleOperationRow(result.rows[0]) : undefined;
  },

  recordSandboxDiagnostic: async (tenantId, input, operationId, health) => {
    await client.query(
      `insert into circle_api_operations
        (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_account_id, status, error_code, created_at)
       values ($1, $2, 'circle.sandbox_check', $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, now())`,
      [
        operationId,
        tenantId,
        input.idempotencyKey,
        input.correlationId,
        JSON.stringify({ environment: health.environment, baseUrl: health.baseUrl, probe: true }),
        JSON.stringify(health.responsePayload),
        health.providerRequestId ?? `circle_diagnostic_${health.environment}`,
        health.status === "ready" ? "succeeded" : "failed",
        health.errorCode
      ]
    );
  }
});

const circleOperationSelect = `select id,
                                      operation_type,
                                      idempotency_key,
                                      correlation_id,
                                      request_payload,
                                      response_payload,
                                      provider_account_id,
                                      provider_wallet_id,
                                      provider_address_id,
                                      status,
                                      error_code,
                                      created_at
                                 from circle_api_operations`;

const mapCircleOperationRow = (row: Record<string, unknown>): unknown => ({
  id: row.id,
  operationType: row.operation_type,
  idempotencyKey: row.idempotency_key,
  correlationId: row.correlation_id,
  requestPayload: row.request_payload ?? {},
  responsePayload: row.response_payload ?? {},
  providerAccountId: row.provider_account_id ?? undefined,
  providerWalletId: row.provider_wallet_id ?? undefined,
  providerAddressId: row.provider_address_id ?? undefined,
  status: row.status,
  errorCode: row.error_code ?? undefined,
  createdAt: toIsoString(row.created_at)
});

const toIsoString = (value: unknown): string | undefined => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return undefined;
};