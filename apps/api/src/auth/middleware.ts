import type { IncomingMessage } from "node:http";
import { forbidden, unauthorized, type JsonResponse } from "../http/index.js";
import type { ApiState } from "../data.js";
import { parsePresentedApiKey, verifyApiSecretHash, type ApiAuthContext, type ApiScope } from "./index.js";

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
