import { createClient } from "@supabase/supabase-js";
import type { ApiState } from "../data.js";
import { databaseModeFromEnv, databaseUrlFromEnv } from "./connection.js";

export interface StateStoreStatus {
  configured: boolean;
  loaded: boolean;
  persisted: boolean;
  error?: string;
}

const snapshotName = "default";
const schemaVersion = "0015";

export const stateStoreStatus: StateStoreStatus = {
  configured: Boolean(databaseUrlFromEnv()),
  loaded: false,
  persisted: false
};

const supabaseStateClient = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return undefined;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

const readSnapshot = async (): Promise<unknown | undefined> => {
  const mode = databaseModeFromEnv();
  if (mode === "postgres") return undefined;

  const client = supabaseStateClient();
  if (!client) return undefined;
  const { data, error } = await client
    .from("api_runtime_state_snapshots")
    .select("state_payload")
    .eq("snapshot_name", snapshotName)
    .maybeSingle();
  if (error) throw error;
  return data?.state_payload;
};

const writeSnapshot = async (state: ApiState): Promise<void> => {
  const payload = { snapshotName, schemaVersion, state: encodeBigInts(state) };
  const mode = databaseModeFromEnv();
  if (mode === "postgres") return;

  const client = supabaseStateClient();
  if (!client) return;
  const { error } = await client.from("api_runtime_state_snapshots").upsert({
    snapshot_name: snapshotName,
    state_payload: encodeBigInts(state),
    schema_version: schemaVersion,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
};

export const loadApiStateSnapshot = async (fallback: ApiState): Promise<ApiState> => {
  const configPath = databaseUrlFromEnv();
  stateStoreStatus.configured = Boolean(configPath);
  if (!configPath) return fallback;
  if (databaseModeFromEnv() === "postgres") {
    stateStoreStatus.loaded = false;
    stateStoreStatus.persisted = false;
    stateStoreStatus.error = undefined;
    return fallback;
  }

  try {
    const snapshot = await readSnapshot();
    if (!snapshot) {
      await saveApiStateSnapshot(fallback);
      return fallback;
    }
    stateStoreStatus.loaded = true;
    stateStoreStatus.error = undefined;
    return reviveApiStateSnapshot(snapshot, fallback);
  } catch (error) {
    stateStoreStatus.error = error instanceof Error ? error.message : "state_snapshot_load_failed";
    return fallback;
  }
};

export const saveApiStateSnapshot = async (state: ApiState): Promise<void> => {
  const configPath = databaseUrlFromEnv();
  stateStoreStatus.configured = Boolean(configPath);
  if (!configPath) return;
  if (databaseModeFromEnv() === "postgres") {
    stateStoreStatus.persisted = false;
    stateStoreStatus.error = undefined;
    return;
  }

  try {
    await writeSnapshot(state);
    stateStoreStatus.persisted = true;
    stateStoreStatus.error = undefined;
  } catch (error) {
    stateStoreStatus.error = error instanceof Error ? error.message : "state_snapshot_save_failed";
  }
};

export const encodeBigInts = (value: unknown): unknown => {
  if (typeof value === "bigint") return { __gttBigInt: value.toString() };
  if (Array.isArray(value)) return value.map(encodeBigInts);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeBigInts(item)]));
  }
  return value;
};

export const reviveBigInts = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(reviveBigInts);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.__gttBigInt === "string" && Object.keys(record).length === 1) {
      return BigInt(record.__gttBigInt);
    }
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, reviveBigInts(item)]));
  }
  return value;
};

export const reviveApiStateSnapshot = (snapshot: unknown, fallback: ApiState): ApiState => {
  const revived = reviveBigInts(snapshot);
  const candidate = unwrapApiStateSnapshot(revived);
  return isApiState(candidate) ? candidate : fallback;
};

const unwrapApiStateSnapshot = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return record.state ?? value;
};

const isApiState = (value: unknown): value is ApiState => {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Record<keyof ApiState, unknown>>;
  return (
    typeof record.tenantId === "string" &&
    Array.isArray(record.apiClients) &&
    Array.isArray(record.apiKeys) &&
    Array.isArray(record.businessClients) &&
    Array.isArray(record.accounts) &&
    Array.isArray(record.balances) &&
    Array.isArray(record.idempotencyRecords) &&
    Array.isArray(record.outbox) &&
    Array.isArray(record.inbox)
  );
};
