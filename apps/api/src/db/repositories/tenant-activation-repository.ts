import { randomUUID } from "node:crypto";
import type { PostgresQueryClient } from "../postgres-route-types.js";

export interface TenantActivationRepository {
  findTenant: (tenantId: string) => Promise<Record<string, unknown> | undefined>;
  
  findCircleIntegration: (tenantId: string) => Promise<Record<string, unknown> | undefined>;
  
  upsertCircleIntegration: (
    integrationId: string,
    tenantId: string,
    environment: string,
    walletSetId: string | undefined,
    walletSetName: string,
    walletBlockchain: string,
    walletStrategy: string,
    status: string,
    metadata: Record<string, unknown>
  ) => Promise<void>;
  
  findTenantCentralAda: (tenantId: string, usePurpose: string) => Promise<{ id: string; businessClientId: string; status: string; accountName: string } | undefined>;
  
  relinkTenantAda: (tenantId: string, accountId: string, businessClientId: string) => Promise<void>;
  
  createTenantAda: (
    accountId: string,
    tenantId: string,
    businessClientId: string,
    usePurpose: string,
    accountName: string,
    status: string
  ) => Promise<void>;
  
  findTenantPseudoClient: (tenantId: string) => Promise<{ id: string; onboardingStatus: string } | undefined>;
  
  approveTenantPseudoClient: (tenantId: string, clientId: string) => Promise<void>;

  createTenantPseudoClient: (clientId: string, tenantId: string, legalName: string, correlationId: string) => Promise<void>;
}

export const createTenantActivationRepository = (client: PostgresQueryClient): TenantActivationRepository => ({
  findTenant: async (tenantId) => {
    const result = await client.query(
      `select id, tenant_name, created_at
         from platform_tenants
        where id = $1`,
      [tenantId]
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  findCircleIntegration: async (tenantId) => {
    const result = await client.query(
      `select id,
              platform_tenant_id,
              provider,
              environment,
              wallet_set_id,
              wallet_set_name,
              wallet_blockchain,
              wallet_strategy,
              status,
              activated_at,
              created_at,
              updated_at,
              metadata
         from platform_tenant_circle_integrations
        where platform_tenant_id = $1 and provider = 'circle'
        limit 1`,
      [tenantId]
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  upsertCircleIntegration: async (
    integrationId,
    tenantId,
    environment,
    walletSetId,
    walletSetName,
    walletBlockchain,
    walletStrategy,
    status,
    metadata
  ) => {
    await client.query(
      `insert into platform_tenant_circle_integrations
        (id, platform_tenant_id, provider, environment, wallet_set_id, wallet_set_name, wallet_blockchain, wallet_strategy, status, activated_at, metadata, created_at, updated_at)
       values ($1, $2, 'circle', $3, $4, $5, $6, $7, $8, case when $8 = 'active' then now() else null end, $9::jsonb, now(), now())
       on conflict (platform_tenant_id, provider)
       do update set environment = excluded.environment,
                     wallet_set_id = excluded.wallet_set_id,
                     wallet_set_name = excluded.wallet_set_name,
                     wallet_blockchain = excluded.wallet_blockchain,
                     wallet_strategy = excluded.wallet_strategy,
                     status = excluded.status,
                     activated_at = case when excluded.status = 'active' then coalesce(platform_tenant_circle_integrations.activated_at, now()) else platform_tenant_circle_integrations.activated_at end,
                     metadata = excluded.metadata,
                     updated_at = now()`,
      [
        integrationId,
        tenantId,
        environment,
        walletSetId,
        walletSetName,
        walletBlockchain,
        walletStrategy,
        status,
        JSON.stringify(metadata)
      ]
    );
  },

  findTenantCentralAda: async (tenantId, usePurpose) => {
    const result = await client.query(
      `select id, business_client_id, status, account_name
         from accounts_of_digital_asset
        where platform_tenant_id = $1
          and use_purpose = $2
        order by created_at asc
        limit 1`,
      [tenantId, usePurpose]
    );
    const row = result.rows[0] as { id: string; business_client_id: string; status: string; account_name: string } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      businessClientId: row.business_client_id,
      status: row.status,
      accountName: row.account_name
    };
  },

  relinkTenantAda: async (tenantId, accountId, businessClientId) => {
    await client.query(
      `update accounts_of_digital_asset
          set business_client_id = $3,
              account_name = 'Tenant ADA (central)',
              status = 'active',
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [accountId, tenantId, businessClientId]
    );
  },

  createTenantAda: async (accountId, tenantId, businessClientId, usePurpose, accountName, status) => {
    await client.query(
      `insert into accounts_of_digital_asset
        (id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, correlation_id, created_at, updated_at)
       values ($1, $2, $3, $5, $4, $6, 'USDC', 'circle_internal', null, now(), now())`,
      [accountId, tenantId, businessClientId, usePurpose, accountName, status]
    );
  },

  findTenantPseudoClient: async (tenantId) => {
    const result = await client.query(
      `select id, onboarding_status
         from business_clients
        where platform_tenant_id = $1
          and legal_name = $2
        order by created_at asc
        limit 1`,
      [tenantId, "Platform Internal Treasury Client"]
    );
    const row = result.rows[0] as { id: string; onboarding_status: string } | undefined;
    return row ? { id: row.id, onboardingStatus: row.onboarding_status } : undefined;
  },

  approveTenantPseudoClient: async (tenantId, clientId) => {
    await client.query(
      `update business_clients
          set onboarding_status = 'approved',
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [clientId, tenantId]
    );
  },

  createTenantPseudoClient: async (clientId, tenantId, legalName, correlationId) => {
    await client.query(
      `insert into business_clients
        (id, platform_tenant_id, legal_name, country, onboarding_status, correlation_id, created_at, updated_at)
       values ($1, $2, $3, 'US', 'approved', $4, now(), now())`,
      [clientId, tenantId, legalName, correlationId]
    );
  }
});
