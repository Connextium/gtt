import pg from "pg";

export interface DatabaseConnectionStatus {
  configured: boolean;
  connected: boolean;
  mode: "postgres" | "unconfigured";
  error?: string;
}

export const databaseUrlFromEnv = (): string | undefined => process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

export const checkDatabaseConnection = async (): Promise<DatabaseConnectionStatus> => {
  const connectionString = databaseUrlFromEnv();
  if (!connectionString) {
    return {
      configured: false,
      connected: false,
      mode: "unconfigured"
    };
  }

  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    await client.query("select 1");
    return {
      configured: true,
      connected: true,
      mode: "postgres"
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      mode: "postgres",
      error: error instanceof Error ? error.message : "database_connection_failed"
    };
  } finally {
    await client.end().catch(() => undefined);
  }
};
