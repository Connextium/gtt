import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config as loadEnv } from "dotenv";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify as toYaml } from "yaml";
import type { ApiAuthContext } from "./auth/index.js";
import { authenticateApiRequestWithDatabaseFallback } from "./auth/middleware.js";
import { createInitialState, emitAudit } from "./data.js";
import { postgresUrlFromEnv } from "./db/connection.js";
import { handlePostgresRoute, isPostgresApiRoute } from "./db/postgres-route-handler.js";
import { withApiStateTransaction } from "./db/state-transaction.js";
import { loadApiStateSnapshot, saveApiStateSnapshot } from "./db/state-store.js";
import { persistInternalIdentityTables, refreshInternalIdentityStateFromTables, shouldPersistInternalIdentity, shouldRefreshInternalIdentity } from "./db/internal-identity-store.js";
import { readRawBody, sendJson, badRequest, corsHeaders } from "./http/index.js";
import { findIdempotentResponse, recordIdempotentResponse, requestHash } from "./events/idempotency.js";
import { handleApiRequest, routeMetadata } from "./http/router.js";
import { resolveOpenApiDocument } from "./openapi/specs.js";

const loadEnvironment = () => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "../../.env.local"),
    resolve(moduleDir, "../../.env.local"),
    ".env.local"
  ];

  for (const envPath of candidatePaths) {
    loadEnv({ path: envPath, quiet: true });
  }
  loadEnv({ quiet: true });
};

loadEnvironment();

const moduleDir = dirname(fileURLToPath(import.meta.url));
const BUSINESS_CLIENT_DOCS_CANDIDATE_PATHS = [
  resolve(moduleDir, "./docs/business-client-api-docs.html"),
  resolve(moduleDir, "../docs/business-client-api-docs.html")
];
let businessClientDocsHtmlCache: string | undefined;

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
      const docsServed = await tryServeBusinessClientDocs(request, response, url.pathname);
      if (docsServed) return;

      if ((request.method ?? "GET") === "GET" && url.pathname.endsWith(".yaml")) {
        const document = resolveOpenApiDocument(url.pathname);
        if (document) {
          response.writeHead(200, {
            "content-type": "application/yaml; charset=utf-8",
            ...corsHeaders(request.headers.origin)
          });
          response.end(toYaml(document));
          return;
        }
      }
      const state = await statePromise;
      const isMutatingRequest = ["POST", "PATCH", "PUT", "DELETE"].includes(request.method ?? "GET");
      const rawBody = isMutatingRequest ? await readRawBody(request) : "";
      const body = rawBody.trim() ? JSON.parse(rawBody) as Record<string, unknown> : {};
      if (shouldRefreshInternalIdentity(url.pathname)) {
        await refreshInternalIdentityStateFromTables(state);
      }
      const metadata = routeMetadata(request.method ?? "GET", url.pathname);
      let authContext: ApiAuthContext | undefined;
      if (!metadata.public) {
        const auth = await authenticateApiRequestWithDatabaseFallback(state, request, metadata.requiredScopes);
        if (auth.error) {
          sendJson(response, auth.error, request);
          return;
        }
        authContext = auth.auth;
      }
      const headers = Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
      const correlationId = headers["x-correlation-id"] ?? `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const idempotencyKey = isMutatingRequest
        ? headers["idempotency-key"] ?? stringFromBody(body, "idempotencyKey")
        : undefined;
      const hasPostgres = Boolean(postgresUrlFromEnv());
      const isPostgresRoute = isPostgresApiRoute(request.method ?? "GET", url.pathname);
      if (hasPostgres && isPostgresRoute) {
        const result = await handlePostgresRoute({
          method: request.method ?? "GET",
          pathname: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          body,
          rawBody,
          headers,
          idempotencyKey,
          correlationId,
          apiKeyId: authContext?.apiKeyId,
          apiClientId: authContext?.apiClientId
        });
        sendJson(response, result, request);
        return;
      }
      if (hasPostgres && isPersistenceRequiredFinanceRoute(url.pathname)) {
        sendJson(
          response,
          {
            status: 501,
            body: {
              error: "finance_route_not_persisted",
              detail: `Route ${url.pathname} must be mapped to Postgres and cannot run in-memory.`
            }
          },
          request
        );
        return;
      }
      const hash = isMutatingRequest ? requestHash({ method: request.method ?? "GET", pathname: url.pathname, body }) : undefined;
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
            headers,
            query: Object.fromEntries(url.searchParams.entries())
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

const isPersistenceRequiredFinanceRoute = (pathname: string): boolean => {
  if (pathname.startsWith("/fiat/")) return true;
  if (pathname.startsWith("/funding-reservations")) return true;
  if (pathname === "/payments" || pathname.startsWith("/payments/")) return true;
  if (pathname === "/ledger/journals" || pathname.startsWith("/ledger/journals/")) return true;
  return false;
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

const tryServeBusinessClientDocs = async (
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string
): Promise<boolean> => {
  const method = request.method ?? "GET";
  if (!isBusinessClientDocsPath(pathname) || !["GET", "HEAD"].includes(method)) {
    return false;
  }

  const html = businessClientDocsHtmlCache ?? await loadBusinessClientDocsHtml();
  businessClientDocsHtmlCache = html;
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    ...corsHeaders(request.headers.origin)
  });
  if (method === "HEAD") {
    response.end();
    return true;
  }
  response.end(html);
  return true;
};

const loadBusinessClientDocsHtml = async (): Promise<string> => {
  let lastError: unknown;
  for (const docsPath of BUSINESS_CLIENT_DOCS_CANDIDATE_PATHS) {
    try {
      return await readFile(docsPath, "utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? new Error(`business_client_docs_not_found: ${lastError.message}`)
    : new Error("business_client_docs_not_found");
};

const isBusinessClientDocsPath = (pathname: string): boolean => (
  pathname === "/docs/business-client"
  || pathname === "/docs/business-client/"
  || pathname === "/docs/business-client-api"
  || pathname === "/docs/business-client-api/"
  || pathname === "/openapi/business-client/docs"
  || pathname === "/openapi/business-client/docs/"
);
