import { allApiScopes, publicApiKey, type ApiKeyRecord, type ApiScope } from "../auth/index.js";
import type { ApiState } from "../data.js";
import { postgresUrlFromEnv } from "./connection.js";
import { getPostgresPool, getSupabaseClient } from "./transaction.js";

export type PublicApiKeyWithClient = Omit<ApiKeyRecord, "keyHash"> & {
  clientName: string;
  clientStatus: ApiState["apiClients"][number]["status"];
};

export const listApiKeysFromTables = async (): Promise<PublicApiKeyWithClient[] | undefined> => {
  if (postgresUrlFromEnv()) return listApiKeysWithPostgres();

  const client = getSupabaseClient();
  if (!client) return undefined;

  const keysResult = await client
    .from("api_keys")
    .select("id, platform_tenant_id, api_client_id, key_prefix, scopes, status, expires_at, revoked_at, rotated_from_api_key_id, last_used_at, last_used_ip, created_at")
    .order("created_at", { ascending: false });
  if (keysResult.error) throw keysResult.error;

  const apiClientIds = [...new Set((keysResult.data ?? []).map((key) => key.api_client_id).filter(Boolean))];
  const clientsById = new Map<string, { client_name: string; status: ApiState["apiClients"][number]["status"] }>();
  if (apiClientIds.length) {
    const clientsResult = await client
      .from("api_clients")
      .select("id, client_name, status")
      .in("id", apiClientIds);
    if (clientsResult.error) throw clientsResult.error;
    for (const item of clientsResult.data ?? []) {
      clientsById.set(item.id, {
        client_name: item.client_name,
        status: item.status
      });
    }
  }

  return (keysResult.data ?? []).map((row) => {
    const apiClient = clientsById.get(row.api_client_id);
    return {
      id: row.id,
      tenantId: row.platform_tenant_id,
      apiClientId: row.api_client_id,
      keyPrefix: row.key_prefix,
      scopes: (row.scopes ?? []).filter(isApiScope),
      status: row.status,
      expiresAt: row.expires_at ?? undefined,
      revokedAt: row.revoked_at ?? undefined,
      rotatedFromApiKeyId: row.rotated_from_api_key_id ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
      lastUsedIp: row.last_used_ip ?? undefined,
      createdAt: row.created_at,
      clientName: apiClient?.client_name ?? row.api_client_id,
      clientStatus: apiClient?.status ?? "active"
    };
  });
};

export const listApiKeysFromState = (state: ApiState): PublicApiKeyWithClient[] => {
  const clientsById = new Map(state.apiClients.map((client) => [client.id, client]));
  return state.apiKeys.map((key) => {
    const client = clientsById.get(key.apiClientId);
    return {
      ...publicApiKey(key),
      clientName: client?.clientName ?? key.apiClientId,
      clientStatus: client?.status ?? "active"
    };
  });
};

const listApiKeysWithPostgres = async (): Promise<PublicApiKeyWithClient[]> => {
  const pool = getPostgresPool();
  if (!pool) return [];

  const result = await pool.query<{
    id: string;
    platform_tenant_id: string;
    api_client_id: string;
    key_prefix: string;
    scopes: string[];
    status: ApiKeyRecord["status"];
    expires_at: Date | string | null;
    revoked_at: Date | string | null;
    rotated_from_api_key_id: string | null;
    last_used_at: Date | string | null;
    last_used_ip: string | null;
    created_at: Date | string;
    client_name: string;
    client_status: ApiState["apiClients"][number]["status"];
  }>(`
    select
      keys.id,
      keys.platform_tenant_id,
      keys.api_client_id,
      keys.key_prefix,
      keys.scopes,
      keys.status,
      keys.expires_at,
      keys.revoked_at,
      keys.rotated_from_api_key_id,
      keys.last_used_at,
      keys.last_used_ip,
      keys.created_at,
      clients.client_name,
      clients.status as client_status
    from api_keys keys
    join api_clients clients on clients.id = keys.api_client_id
    order by keys.created_at desc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    tenantId: row.platform_tenant_id,
    apiClientId: row.api_client_id,
    keyPrefix: row.key_prefix,
    scopes: row.scopes.filter(isApiScope),
    status: row.status,
    expiresAt: toIsoString(row.expires_at),
    revokedAt: toIsoString(row.revoked_at),
    rotatedFromApiKeyId: row.rotated_from_api_key_id ?? undefined,
    lastUsedAt: toIsoString(row.last_used_at),
    lastUsedIp: row.last_used_ip ?? undefined,
    createdAt: toIsoString(row.created_at) ?? new Date().toISOString(),
    clientName: row.client_name,
    clientStatus: row.client_status
  }));
};

const toIsoString = (value: Date | string | null | undefined): string | undefined => {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
};

const isApiScope = (value: string): value is ApiScope => allApiScopes.includes(value as ApiScope);
