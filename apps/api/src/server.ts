import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import type { ApiAuthContext } from "./auth/index.js";
import { authenticateApiRequest } from "./auth/middleware.js";
import { createInitialState, emitAudit } from "./data.js";
import { loadApiStateSnapshot, saveApiStateSnapshot } from "./db/state-store.js";
import { readRawBody, sendJson, badRequest, corsHeaders } from "./http/index.js";
import { findIdempotentResponse, recordIdempotentResponse, requestHash } from "./events/idempotency.js";
import { handleApiRequest, routeMetadata } from "./http/router.js";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

export interface ApiServerOptions {
  port?: number;
  host?: string;
}

export const createApiServer = () => {
  const statePromise = loadApiStateSnapshot(createInitialState());
  return createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        ...corsHeaders()
      });
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", "http://localhost");
    try {
      const state = await statePromise;
      const rawBody = ["POST", "PATCH"].includes(request.method ?? "GET") ? await readRawBody(request) : "";
      const body = rawBody.trim() ? JSON.parse(rawBody) as Record<string, unknown> : {};
      const metadata = routeMetadata(request.method ?? "GET", url.pathname);
      let authContext: ApiAuthContext | undefined;
      if (!metadata.public) {
        const auth = authenticateApiRequest(state, request, metadata.requiredScopes);
        if (auth.error) {
          sendJson(response, auth.error);
          return;
        }
        authContext = auth.auth;
      }
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
      const correlationId = headers["x-correlation-id"] ?? `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const idempotencyKey = request.method === "POST" ? headers["idempotency-key"] ?? stringFromBody(body, "idempotencyKey") : undefined;
      const hash = request.method === "POST" ? requestHash({ method: request.method ?? "GET", pathname: url.pathname, body }) : undefined;
      const replay = hash ? findIdempotentResponse(state, { key: idempotencyKey, hash }) : { replayed: false as const };
      if (replay.replayed) {
        sendJson(response, { status: 200, body: replay.responseSnapshot });
        return;
      }
      const result = await handleApiRequest(state, {
        method: request.method ?? "GET",
        pathname: url.pathname,
        body,
        rawBody,
        headers
      });
      emitAudit(state, {
        eventType: request.method === "GET" ? "api.read" : "api.command",
        requestPath: url.pathname,
        requestMethod: request.method ?? "GET",
        apiKeyId: authContext?.apiKeyId,
        apiClientId: authContext?.apiClientId,
        correlationId
      });
      if (hash && result.status < 500) {
        recordIdempotentResponse(state, { key: idempotencyKey, hash, responseSnapshot: result.body });
      }
      await saveApiStateSnapshot(state);
      sendJson(response, result);
    } catch (error) {
      sendJson(response, badRequest(error instanceof Error ? error.message : "request_failed"));
    }
  });
};

const stringFromBody = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value : undefined;
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
