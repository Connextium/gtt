import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config as loadEnv } from "dotenv";
import type { ApiAuthContext } from "./auth/index.js";
import { authenticateApiRequest } from "./auth/middleware.js";
import { createInitialState, emitAudit } from "./data.js";
import { postgresUrlFromEnv } from "./db/connection.js";
import { handleSprint1PostgresCommand, isSprint1PostgresCommand } from "./db/sprint1-postgres-unit-of-work.js";
import { withApiStateTransaction } from "./db/state-transaction.js";
import { loadApiStateSnapshot, saveApiStateSnapshot } from "./db/state-store.js";
import { persistInternalIdentityTables, refreshInternalIdentityStateFromTables, shouldPersistInternalIdentity, shouldRefreshInternalIdentity } from "./db/internal-identity-store.js";
import { readRawBody, sendJson, badRequest, corsHeaders } from "./http/index.js";
import { findIdempotentResponse, recordIdempotentResponse, requestHash } from "./events/idempotency.js";
import { handleApiRequest, routeMetadata } from "./http/router.js";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export interface ApiServerOptions {
  port?: number;
  host?: string;
}

export const createApiRequestHandler = (statePromise = loadApiStateSnapshot(createInitialState())) =>
  async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders(request.headers.origin)
      });
      response.end();
      return;
    }

    const url = parseRequestUrl(request.url ?? "/");
    try {
      const state = await statePromise;
      const rawBody = ["POST", "PATCH"].includes(request.method ?? "GET") ? await readRawBody(request) : "";
      const body = rawBody.trim() ? JSON.parse(rawBody) as Record<string, unknown> : {};
      if (shouldRefreshInternalIdentity(url.pathname)) {
        await refreshInternalIdentityStateFromTables(state);
      }
      const metadata = routeMetadata(request.method ?? "GET", url.pathname);
      let authContext: ApiAuthContext | undefined;
      if (!metadata.public) {
        const auth = authenticateApiRequest(state, request, metadata.requiredScopes);
        if (auth.error) {
          sendJson(response, auth.error, request);
          return;
        }
        authContext = auth.auth;
      }
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
      const correlationId = headers["x-correlation-id"] ?? `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const idempotencyKey = request.method === "POST" ? headers["idempotency-key"] ?? stringFromBody(body, "idempotencyKey") : undefined;
      if (postgresUrlFromEnv() && isSprint1PostgresCommand(request.method ?? "GET", url.pathname)) {
        const result = await handleSprint1PostgresCommand({
          method: request.method ?? "GET",
          pathname: url.pathname,
          body,
          idempotencyKey,
          correlationId,
          apiKeyId: authContext?.apiKeyId,
          apiClientId: authContext?.apiClientId
        });
        sendJson(response, result, request);
        return;
      }
      const hash = request.method === "POST" ? requestHash({ method: request.method ?? "GET", pathname: url.pathname, body }) : undefined;
      const replay = hash ? findIdempotentResponse(state, { key: idempotencyKey, hash }) : { replayed: false as const };
      if (replay.replayed) {
        sendJson(response, { status: 200, body: replay.responseSnapshot }, request);
        return;
      }
      const result = await withApiStateTransaction(
        state,
        async (draft) => {
          const routeResult = await handleApiRequest(draft, {
            method: request.method ?? "GET",
            pathname: url.pathname,
            body,
            rawBody,
            headers
          });
          emitAudit(draft, {
            eventType: request.method === "GET" ? "api.read" : "api.command",
            requestPath: url.pathname,
            requestMethod: request.method ?? "GET",
            apiKeyId: authContext?.apiKeyId,
            apiClientId: authContext?.apiClientId,
            correlationId
          });
          if (hash && routeResult.status < 500) {
            recordIdempotentResponse(draft, { key: idempotencyKey, hash, responseSnapshot: routeResult.body });
          }
          return routeResult;
        },
        async (draft, routeResult) => {
          if (routeResult.status < 400 && shouldPersistInternalIdentity(url.pathname)) {
            await persistInternalIdentityTables(draft, url.pathname);
          }
        }
      );
      await saveApiStateSnapshot(state);
      sendJson(response, result, request);
    } catch (error) {
      sendJson(response, badRequest(error instanceof Error ? error.message : "request_failed"), request);
    }
  };

export const createApiServer = () => {
  return createServer(createApiRequestHandler());
};

const stringFromBody = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

export const parseRequestUrl = (rawUrl: string): URL => {
  const normalizedRawUrl = rawUrl.replace(/^\/+/, "/");
  const url = new URL(normalizedRawUrl, "http://localhost");
  url.pathname = normalizeRequestPath(url.pathname);
  return url;
};

export const normalizeRequestPath = (pathname: string): string => {
  const normalized = pathname.replace(/\/{2,}/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
};

export const startApiServer = (options: ApiServerOptions = {}) => {
  const port = options.port ?? Number(process.env.PORT ?? 4000);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const server = createApiServer();
  server.listen(port, host, () => {
    console.log(`gtt-api listening on http://${host}:${port}`);
  });
  return server;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  startApiServer();
}
