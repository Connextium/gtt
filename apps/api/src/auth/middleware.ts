import type { IncomingMessage } from "node:http";
import { forbidden, unauthorized, type JsonResponse } from "../http/index.js";
import type { ApiState } from "../data.js";
import { parsePresentedApiKey, verifyApiSecretHash, type ApiAuthContext, type ApiScope } from "./index.js";
import { postgresUrlFromEnv } from "../db/connection.js";
import { getPostgresPool } from "../db/transaction.js";

export const authenticateApiRequest = (
  state: ApiState,
  request: IncomingMessage,
  requiredScopes: string[] = []
): { auth?: ApiAuthContext; error?: JsonResponse } => {
  const presented = request.headers.authorization ?? request.headers["x-gtt-api-key"];
  const rawKey = Array.isArray(presented) ? presented[0] : presented;
  if (!rawKey) return { error: unauthorized("api_key_required") };

  const parsed = parsePresentedApiKey(rawKey);
  if (!parsed) return { error: unauthorized("api_key_invalid_format") };

  const key = state.apiKeys.find((item) => item.id === parsed.keyId && item.keyPrefix === parsed.prefix);
  if (!key) return { error: unauthorized("api_key_not_found") };
  if (key.status !== "active") return { error: unauthorized("api_key_not_active") };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) return { error: unauthorized("api_key_expired") };
  if (!verifyApiSecretHash(parsed.secret, key.keyHash)) return { error: unauthorized("api_key_secret_invalid") };

  const missingScope = requiredScopes.find((scope) => !key.scopes.includes(scope as ApiScope));
  if (missingScope) return { error: forbidden(`api_key_scope_missing:${missingScope}`) };

  key.lastUsedAt = new Date().toISOString();
  key.lastUsedIp = request.socket.remoteAddress;

  return {
    auth: {
      tenantId: key.tenantId,
      apiClientId: key.apiClientId,
      apiKeyId: key.id,
      scopes: key.scopes
    }
  };
};

export const authenticateApiRequestWithDatabaseFallback = async (
  state: ApiState,
  request: IncomingMessage,
  requiredScopes: string[] = []
): Promise<{ auth?: ApiAuthContext; error?: JsonResponse }> => {
  const stateResult = authenticateApiRequest(state, request, requiredScopes);
  if (!stateResult.error || errorCode(stateResult.error.body) !== "api_key_not_found" || !postgresUrlFromEnv()) return stateResult;

  const presented = request.headers.authorization ?? request.headers["x-gtt-api-key"];
  const rawKey = Array.isArray(presented) ? presented[0] : presented;
  const parsed = rawKey ? parsePresentedApiKey(rawKey) : undefined;
  if (!parsed) return stateResult;

  const pool = getPostgresPool();
  if (!pool) return stateResult;
  const result = await pool.query<{
    id: string;
    platform_tenant_id: string;
    api_client_id: string;
    key_prefix: string;
    key_hash: string;
    scopes: string[];
    status: string;
    expires_at: Date | string | null;
  }>(
    `select id, platform_tenant_id, api_client_id, key_prefix, key_hash, scopes, status, expires_at
       from api_keys
      where id = $1 and key_prefix = $2`,
    [parsed.keyId, parsed.prefix]
  );
  const key = result.rows[0];
  if (!key) return stateResult;
  if (key.status !== "active") return { error: unauthorized("api_key_not_active") };
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) return { error: unauthorized("api_key_expired") };
  if (!verifyApiSecretHash(parsed.secret, key.key_hash)) return { error: unauthorized("api_key_secret_invalid") };

  const missingScope = requiredScopes.find((scope) => !key.scopes.includes(scope));
  if (missingScope) return { error: forbidden(`api_key_scope_missing:${missingScope}`) };

  await pool.query(
    `update api_keys set last_used_at = now(), last_used_ip = $2 where id = $1`,
    [key.id, request.socket.remoteAddress]
  );
  await pool.query(
    `insert into audit_events
      (id, platform_tenant_id, event_type, request_path, request_method, api_key_id, api_client_id, correlation_id, payload)
     values (gen_random_uuid(), $1, 'api_key.authenticated', $2, $3, $4, $5, $6, '{}'::jsonb)`,
    [
      key.platform_tenant_id,
      request.url ?? undefined,
      request.method ?? "GET",
      key.id,
      key.api_client_id,
      request.headers["x-correlation-id"] ?? `corr_${Date.now()}`
    ]
  ).catch(() => undefined);

  return {
    auth: {
      tenantId: key.platform_tenant_id,
      apiClientId: key.api_client_id,
      apiKeyId: key.id,
      scopes: key.scopes as ApiScope[]
    }
  };
};

const errorCode = (body: unknown): string | undefined => {
  return body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : undefined;
};
