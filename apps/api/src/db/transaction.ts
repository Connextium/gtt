import pg from "pg";
import { databaseUrlFromEnv } from "./connection.js";

let pool: pg.Pool | undefined;

export const getPostgresPool = (): pg.Pool | undefined => {
  const connectionString = databaseUrlFromEnv();
  if (!connectionString) return undefined;
  pool ??= new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5)
  });
  return pool;
};

export const withTransaction = async <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> => {
  const pool = getPostgresPool();
  if (!pool) throw new Error("database_url_required");
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
