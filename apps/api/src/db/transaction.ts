import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { postgresUrlFromEnv } from "./connection.js";

export type PostgresClient = pg.PoolClient;

let postgresPool: pg.Pool | undefined;

export const setPostgresPoolForTest = (pool: pg.Pool | undefined): void => {
  postgresPool = pool;
};

export const getPostgresPool = (): pg.Pool | undefined => {
  const connectionString = postgresUrlFromEnv();
  if (!connectionString) return undefined;
  postgresPool ??= new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000
  });
  return postgresPool;
};

export const withPostgresTransaction = async <T>(work: (client: PostgresClient) => Promise<T>): Promise<T> => {
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error("postgres_url_required");
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const getSupabaseClient = (): SupabaseClient | undefined => {
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

export const withSupabaseClient = async <T>(work: (client: SupabaseClient) => Promise<T>): Promise<T> => {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("supabase_client_required");
  }
  return work(client);
};

export const closePostgresPoolForTest = async (): Promise<void> => {
  await postgresPool?.end();
  postgresPool = undefined;
};
