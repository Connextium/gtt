import pg from "pg";
import type { ApiState } from "../data.js";
import { databaseUrlFromEnv } from "./connection.js";

export interface StateStoreStatus {
  configured: boolean;
  loaded: boolean;
  persisted: boolean;
  error?: string;
}

const snapshotName = "default";
const schemaVersion = "0012";

export const stateStoreStatus: StateStoreStatus = {
  configured: Boolean(databaseUrlFromEnv()),
  loaded: false,
  persisted: false
};

export const loadApiStateSnapshot = async (fallback: ApiState): Promise<ApiState> => {
  const connectionString = databaseUrlFromEnv();
  stateStoreStatus.configured = Boolean(connectionString);
  if (!connectionString) return fallback;

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query<{ state_payload: unknown }>(
      "select state_payload from api_runtime_state_snapshots where snapshot_name = $1",
      [snapshotName]
    );
    const snapshot = result.rows[0]?.state_payload;
    if (!snapshot) {
      await saveApiStateSnapshot(fallback);
      return fallback;
    }
    stateStoreStatus.loaded = true;
    stateStoreStatus.error = undefined;
    return reviveBigInts(snapshot) as ApiState;
  } catch (error) {
    stateStoreStatus.error = error instanceof Error ? error.message : "state_snapshot_load_failed";
    return fallback;
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const saveApiStateSnapshot = async (state: ApiState): Promise<void> => {
  const connectionString = databaseUrlFromEnv();
  stateStoreStatus.configured = Boolean(connectionString);
  if (!connectionString) return;

  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(
      `insert into api_runtime_state_snapshots (snapshot_name, state_payload, schema_version, updated_at)
       values ($1, $2::jsonb, $3, now())
       on conflict (snapshot_name)
       do update set state_payload = excluded.state_payload, schema_version = excluded.schema_version, updated_at = now()`,
      [snapshotName, JSON.stringify(encodeBigInts(state)), schemaVersion]
    );
    stateStoreStatus.persisted = true;
    stateStoreStatus.error = undefined;
  } catch (error) {
    stateStoreStatus.error = error instanceof Error ? error.message : "state_snapshot_save_failed";
  } finally {
    await client.end().catch(() => undefined);
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
