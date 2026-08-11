import { randomUUID } from "node:crypto";
import type { PostgresQueryClient } from "../postgres-route-types.js";

export interface AdaCircleProvisionRepository {
  findAccountWithClient: (tenantId: string, accountId: string) => Promise<{
    id: string;
    status: string;
    businessClientId: string;
    usePurpose: string;
    onboardingStatus: string;
    circleWalletSetId?: string;
    legalName?: string;
  } | undefined>;
  
  findExistingCircleWallet: (tenantId: string, accountId: string, walletSetId?: string) => Promise<Record<string, unknown> | undefined>;
  
  findSuccessfulMappingOperation: (tenantId: string, accountId: string, walletSetId?: string) => Promise<Record<string, unknown> | undefined>;
  
  findReplayedOperation: (tenantId: string, accountId: string, idempotencyKey: string) => Promise<Record<string, unknown> | undefined>;
  
  insertCircleOperation: (
    operationId: string,
    tenantId: string,
    accountId: string,
    businessClientId: string,
    idempotencyKey: string,
    correlationId: string,
    requestPayload: Record<string, unknown>,
    responsePayload: Record<string, unknown>,
    providerAccountId: string | undefined,
    providerWalletId: string | undefined,
    providerAddressId: string | undefined,
    status: string,
    errorCode: string | undefined
  ) => Promise<void>;
  
  insertLinkedInstrument: (
    instrumentId: string,
    accountId: string,
    tenantId: string,
    assetCode: string,
    usePurpose: string,
    metadata: Record<string, unknown>,
    blockchain: string
  ) => Promise<Record<string, unknown>>;
  
  updateLinkedInstrumentCircleOperationId: (operationId: string, linkedInstrumentId: string) => Promise<void>;
  
  updateBusinessClientWalletSetId: (tenantId: string, businessClientId: string, walletSetId: string) => Promise<void>;
}

export const createAdaCircleProvisionRepository = (client: PostgresQueryClient): AdaCircleProvisionRepository => ({
  findAccountWithClient: async (tenantId, accountId) => {
    const result = await client.query(
      `select account.id, account.status, account.business_client_id, account.use_purpose, 
              client.onboarding_status, client.circle_wallet_set_id, client.legal_name
         from accounts_of_digital_asset account
         join business_clients client on client.id = account.business_client_id and client.platform_tenant_id = account.platform_tenant_id
        where account.id = $1 and account.platform_tenant_id = $2
        for update`,
      [accountId, tenantId]
    );
    const row = result.rows[0] as {
      id: string;
      status: string;
      business_client_id: string;
      use_purpose: string;
      onboarding_status: string;
      circle_wallet_set_id?: string;
      legal_name?: string;
    } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      status: row.status,
      businessClientId: row.business_client_id,
      usePurpose: row.use_purpose,
      onboardingStatus: row.onboarding_status,
      circleWalletSetId: row.circle_wallet_set_id,
      legalName: row.legal_name
    };
  },

  findExistingCircleWallet: async (tenantId, accountId, walletSetId) => {
    const result = await client.query(
      `select id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at
         from linked_instruments
        where platform_tenant_id = $1
          and account_of_digital_asset_id = $2
          and instrument_type = 'circle_wallet'
          and provider = 'circle'
          and status in ('active', 'verified')
          and verification_status = 'verified'
        order by created_at desc
        limit 1`,
      [tenantId, accountId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    
    // If walletSetId is provided, verify it matches
    if (walletSetId) {
      const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : undefined;
      const rowWalletSetId = typeof metadata?.walletSetId === "string" ? metadata.walletSetId : undefined;
      if (rowWalletSetId !== walletSetId) return undefined;
    }
    
    return row;
  },

  findSuccessfulMappingOperation: async (tenantId, accountId, walletSetId) => {
    const result = await client.query(
      `select id, operation_type, idempotency_key, correlation_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at
         from circle_api_operations
        where platform_tenant_id = $1
          and account_of_digital_asset_id = $2
          and operation_type = 'ada_circle_mapping'
          and status = 'succeeded'
        order by created_at desc
        limit 1`,
      [tenantId, accountId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    
    // If walletSetId is provided, verify it matches
    if (walletSetId) {
      const rowWalletSetId = typeof row.provider_account_id === "string" ? row.provider_account_id : undefined;
      if (rowWalletSetId !== walletSetId) return undefined;
    }
    
    return row;
  },

  findReplayedOperation: async (tenantId, accountId, idempotencyKey) => {
    const result = await client.query(
      `select id, operation_type, provider_account_id, provider_wallet_id, provider_address_id, status, request_payload, response_payload, created_at
         from circle_api_operations
        where platform_tenant_id = $1
          and account_of_digital_asset_id = $2
          and operation_type = 'ada_circle_mapping'
          and idempotency_key = $3
        order by created_at desc
        limit 1`,
      [tenantId, accountId, idempotencyKey]
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  insertCircleOperation: async (
    operationId,
    tenantId,
    accountId,
    businessClientId,
    idempotencyKey,
    correlationId,
    requestPayload,
    responsePayload,
    providerAccountId,
    providerWalletId,
    providerAddressId,
    status,
    errorCode
  ) => {
    await client.query(
      `insert into circle_api_operations
        (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, account_of_digital_asset_id, business_client_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at)
       values ($1, $2, 'ada_circle_mapping', $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, now())`,
      [
        operationId,
        tenantId,
        idempotencyKey,
        correlationId,
        accountId,
        businessClientId,
        JSON.stringify(requestPayload),
        JSON.stringify(responsePayload),
        providerAccountId,
        providerWalletId,
        providerAddressId,
        status,
        errorCode
      ]
    );
  },

  insertLinkedInstrument: async (instrumentId, accountId, tenantId, assetCode, usePurpose, metadata, blockchain) => {
    const result = await client.query(
      `insert into linked_instruments
        (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
       values ($1, $2, $3, 'circle_wallet', 'active', $4, 'on-chain', $5, 'circle', 'verified', $6::jsonb, $7, true, now(), now())
       returning id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, network_code, is_default, metadata, created_at`,
      [
        instrumentId,
        accountId,
        tenantId,
        assetCode,
        usePurpose,
        JSON.stringify(metadata),
        blockchain
      ]
    );
    return result.rows[0] as Record<string, unknown>;
  },

  updateLinkedInstrumentCircleOperationId: async (operationId, linkedInstrumentId) => {
    await client.query(
      `update circle_api_operations set linked_instrument_id = $2 where id = $1`,
      [operationId, linkedInstrumentId]
    );
  },

  updateBusinessClientWalletSetId: async (tenantId, businessClientId, walletSetId) => {
    await client.query(
      `update business_clients
          set circle_wallet_set_id = $3,
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [businessClientId, tenantId, walletSetId]
    );
  }
});
