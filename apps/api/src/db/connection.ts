export interface DatabaseConnectionStatus {
  configured: boolean;
  connected: boolean;
  mode: "postgres" | "supabase" | "unconfigured";
  error?: string;
}

export const postgresUrlFromEnv = (): string | undefined => process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

export const databaseUrlFromEnv = (): string | undefined =>
  postgresUrlFromEnv() ?? process.env.SUPABASE_URL;

export const databaseModeFromEnv = (): DatabaseConnectionStatus["mode"] => {
  if (postgresUrlFromEnv()) return "postgres";
  if (process.env.SUPABASE_URL) return "supabase";
  return "unconfigured";
};

export const checkDatabaseConnection = async (): Promise<DatabaseConnectionStatus> => {
  const mode = databaseModeFromEnv();
  if (mode === "unconfigured") {
    return {
      configured: false,
      connected: false,
      mode: "unconfigured"
    };
  }

  if (mode === "postgres") {
    return {
      configured: true,
      connected: true,
      mode
    };
  }

  if (!(process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY)) {
    return {
      configured: true,
      connected: false,
      mode,
      error: "supabase_key_required"
    };
  }

  return {
    configured: true,
    connected: true,
    mode
  };
};
