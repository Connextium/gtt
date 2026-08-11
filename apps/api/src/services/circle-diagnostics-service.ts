import { randomUUID } from "node:crypto";
import type { CircleOperationRepository } from "../db/repositories/circle-operation-repository.js";
import type { PostgresRouteInput } from "../db/postgres-route-types.js";
import type { JsonResponse } from "../http/index.js";
import type { CircleGateway } from "../modules/circle/circle-gateway.js";

interface CircleDiagnosticsServiceDependencies {
  circle: Pick<CircleGateway, "checkHealth">;
  operations: CircleOperationRepository;
  writeAuditAndOutbox: (
    input: PostgresRouteInput,
    eventType: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
}

export interface CircleDiagnosticsService {
  getHealth: (tenantId: string) => Promise<unknown>;
  runSandboxCheck: (tenantId: string, input: PostgresRouteInput) => Promise<JsonResponse>;
}

export const createCircleDiagnosticsService = (
  dependencies: CircleDiagnosticsServiceDependencies
): CircleDiagnosticsService => ({
  getHealth: async (tenantId) => ({
    circle: await dependencies.circle.checkHealth({ probe: false }),
    lastDiagnostic: await dependencies.operations.findLatestDiagnostic(tenantId)
  }),

  runSandboxCheck: async (tenantId, input) => {
    const health = await dependencies.circle.checkHealth({ probe: true });
    const operationId = randomUUID();
    await dependencies.operations.recordSandboxDiagnostic(tenantId, input, operationId, health);
    await dependencies.writeAuditAndOutbox(
      input,
      health.status === "ready" ? "circle.sandbox_check.succeeded" : "circle.sandbox_check.failed",
      {
        circleOperationId: operationId,
        environment: health.environment,
        status: health.status,
        errorCode: health.errorCode
      }
    );
    return {
      status: health.status === "ready" ? 200 : health.errorCode === "circle_api_key_required" ? 400 : 502,
      body: {
        circle: health,
        diagnostic: await dependencies.operations.findById(tenantId, operationId)
      }
    };
  }
});