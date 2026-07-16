import type { IncomingMessage, ServerResponse } from "node:http";

export interface JsonResponse {
  status: number;
  body: unknown;
  public?: boolean;
  requiredScopes?: string[];
}

export const sendJson = (response: ServerResponse, result: JsonResponse): void => {
  const payload = JSON.stringify(result.body, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
  response.writeHead(result.status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,idempotency-key,x-correlation-id,x-gtt-api-key,x-dev-auth-user-id,x-dev-auth-email"
  });
  response.end(payload);
};

export const readJsonBody = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const raw = await readRawBody(request);
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("json_object_required");
  }
  return parsed as Record<string, unknown>;
};

export const readRawBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const notFound = (path: string): JsonResponse => ({
  status: 404,
  body: {
    error: "not_found",
    path
  }
});

export const badRequest = (message: string): JsonResponse => ({
  status: 400,
  body: {
    error: message
  }
});

export const unauthorized = (message: string): JsonResponse => ({
  status: 401,
  body: {
    error: message
  }
});

export const forbidden = (message: string): JsonResponse => ({
  status: 403,
  body: {
    error: message
  }
});
