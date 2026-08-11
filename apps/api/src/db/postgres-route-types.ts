import type { JsonResponse } from "../http/index.js";
import type { PostgresClient } from "./transaction.js";

export type PostgresQueryClient = Pick<PostgresClient, "query">;

export interface PostgresRouteInput {
  method: string;
  pathname: string;
  query?: Record<string, string>;
  body: Record<string, unknown>;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
  idempotencyKey?: string;
  correlationId: string;
  apiKeyId?: string;
  apiClientId?: string;
  actorUserId?: string;
  actorRole?: string;
}

export type PostgresRouteHandler = (
  client: PostgresQueryClient,
  tenantId: string,
  input: PostgresRouteInput
) => Promise<JsonResponse>;