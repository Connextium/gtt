import type { DomainModuleName } from "../../domain/index.js";

export interface SupabaseDatabaseConfig {
  url: string;
  serviceRoleKey?: string;
  anonKey?: string;
}

export interface MigrationCatalogEntry {
  version: string;
  fileName: string;
  domainModules: DomainModuleName[];
}

export interface MigrationCatalogValidation {
  latestVersion: string;
  migrationCount: number;
  sequenceValid: boolean;
}

export const requireDatabaseUrl = (env: Record<string, string | undefined>): string => {
  const value = env.DATABASE_URL ?? env.SUPABASE_DB_URL ?? env.SUPABASE_URL;
  if (!value) {
    throw new Error("database_url_required");
  }
  return value;
};

export const migrationCatalog: MigrationCatalogEntry[] = [
  {
    version: "0001",
    fileName: "0001_initial_schema.sql",
    domainModules: ["client-onboarding", "digital-accounts", "ledger"]
  },
  {
    version: "0002",
    fileName: "0002_rename_digital_asset_account_to_ada.sql",
    domainModules: ["digital-accounts"]
  },
  {
    version: "0003",
    fileName: "0003_sprint1_financial_core_foundation.sql",
    domainModules: ["ledger", "digital-accounts"]
  },
  {
    version: "0004",
    fileName: "0004_sprint2_balance_onboarding_foundation.sql",
    domainModules: ["client-onboarding", "balance"]
  },
  {
    version: "0005",
    fileName: "0005_sprint3_obligations_reservations.sql",
    domainModules: ["settlement-obligation", "funding-reservation"]
  },
  {
    version: "0006",
    fileName: "0006_sprint4_treasury_positions_liquidity.sql",
    domainModules: ["liquidity-rebalancing", "balance"]
  },
  {
    version: "0007",
    fileName: "0007_sprint5_funding_internal_settlement_webhooks.sql",
    domainModules: ["payment-execution", "settlement-obligation"]
  },
  {
    version: "0008",
    fileName: "0008_sprint6_external_payment_redemption.sql",
    domainModules: ["payment-execution", "funding-reservation"]
  },
  {
    version: "0009",
    fileName: "0009_sprint7_liquidity_reconciliation.sql",
    domainModules: ["liquidity-rebalancing", "reconciliation"]
  },
  {
    version: "0010",
    fileName: "0010_sprint8_hardening_uat_release.sql",
    domainModules: ["hardening-release"]
  },
  {
    version: "0011",
    fileName: "0011_full_api_auth_events_circle.sql",
    domainModules: ["api-auth", "events", "circle-integration", "payment-execution", "reconciliation"]
  },
  {
    version: "0012",
    fileName: "0012_api_runtime_state_snapshots.sql",
    domainModules: ["api-auth", "events", "circle-integration", "payment-execution", "reconciliation", "hardening-release"]
  },
  {
    version: "0013",
    fileName: "0013_sprint0_business_user_self_registration_auth.sql",
    domainModules: ["client-onboarding", "api-auth"]
  },
  {
    version: "0014",
    fileName: "0014_allow_reviewd_onboarding_current_step.sql",
    domainModules: ["client-onboarding"]
  },
  {
    version: "0015",
    fileName: "0015_sprint1_review_completion_fixes.sql",
    domainModules: ["client-onboarding", "digital-accounts", "ledger"]
  },
  {
    version: "0016",
    fileName: "0016_sprint1_2_operator_admin_identity.sql",
    domainModules: ["api-auth", "client-onboarding"]
  },
  {
    version: "0017",
    fileName: "0017_sprint1_postgres_unit_of_work.sql",
    domainModules: ["api-auth", "events", "ledger", "client-onboarding", "digital-accounts"]
  },
  {
    version: "0018",
    fileName: "0018_super_admin_bootstrap_and_internal_access.sql",
    domainModules: ["api-auth"]
  },
  {
    version: "0019",
    fileName: "0019_business_onboarding_review_actions.sql",
    domainModules: ["client-onboarding"]
  }
];

export const validateMigrationCatalog = (catalog: MigrationCatalogEntry[] = migrationCatalog): MigrationCatalogValidation => {
  const sequenceValid = catalog.every((entry, index) => entry.version === String(index + 1).padStart(4, "0"));
  const latest = catalog[catalog.length - 1];
  return {
    latestVersion: latest?.version ?? "0000",
    migrationCount: catalog.length,
    sequenceValid
  };
};
