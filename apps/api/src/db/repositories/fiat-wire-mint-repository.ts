import type { PostgresQueryClient } from "../postgres-route-types.js";

export interface FiatWireMintRepository {
  findWireAccount: (tenantId: string, wireAccountId: string) => Promise<Record<string, unknown> | undefined>;
  
  findTargetAccount: (tenantId: string, accountId: string) => Promise<Record<string, unknown> | undefined>;
  
  findDefaultFiatWireLinkedInstrument: (tenantId: string, accountId: string) => Promise<Record<string, unknown> | undefined>;
  
  findLatestVerifiedCircleWalletLinkedInstrument: (tenantId: string, accountId: string) => Promise<Record<string, unknown> | undefined>;
  
  insertMintCircleOperation: (
    operationId: string,
    tenantId: string,
    targetAccountId: string,
    businessClientId: string,
    linkedInstrumentId: string,
    idempotencyKey: string,
    correlationId: string,
    requestPayload: Record<string, unknown>,
    responsePayload: Record<string, unknown>,
    providerWalletId: string | undefined,
    providerAddressId: string | undefined,
    status: string,
    errorCode: string | undefined
  ) => Promise<void>;
  
  updateLinkedInstrumentMetadata: (tenantId: string, linkedInstrumentId: string, metadata: Record<string, unknown>) => Promise<void>;
  
  findFundingInstruction: (tenantId: string, fundingInstructionId: string) => Promise<{ id: string; instructionRole: string; status: string } | undefined>;
  
  updateFundingInstructionStatus: (tenantId: string, fundingInstructionId: string, status: string) => Promise<void>;
  
  updateFundingInstructionOrders: (tenantId: string, fundingInstructionId: string, status: string) => Promise<void>;
}

export const createFiatWireMintRepository = (client: PostgresQueryClient): FiatWireMintRepository => ({
  findWireAccount: async (tenantId, wireAccountId) => {
    const result = await client.query(
      `select linked.id,
              account.business_client_id,
              coalesce(rail.rail_name, linked.instrument_type) as bank_name,
              coalesce(linked.metadata->>'accountNumberLast4', '----') as account_number_last4,
              coalesce(linked.network_code, linked.metadata->>'routingNumber') as routing_number,
              coalesce(linked.metadata->>'businessWireAccountId', linked.metadata->>'wireAccountId') as business_wire_account_id,
              linked.status,
              linked.account_of_digital_asset_id,
              linked.created_at
         from linked_instruments linked
         join accounts_of_digital_asset account on account.id = linked.account_of_digital_asset_id
         left join asset_rails rail on rail.rail_code = linked.network_code
        where linked.id = $1 and linked.platform_tenant_id = $2
          and linked.rail_type = 'fiat'`,
      [wireAccountId, tenantId]
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? {
      id: row.id,
      accountOfDigitalAssetId: row.account_of_digital_asset_id,
      businessClientId: row.business_client_id,
      bankName: row.bank_name,
      accountNumberLast4: row.account_number_last4,
      routingNumber: row.routing_number,
      businessWireAccountId: row.business_wire_account_id,
      status: row.status,
      createdAt: row.created_at
    } : undefined;
  },

  findTargetAccount: async (tenantId, accountId) => {
    const result = await client.query(
      `select id, business_client_id, use_purpose, status, account_name
         from accounts_of_digital_asset
        where id = $1 and platform_tenant_id = $2`,
      [accountId, tenantId]
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  findDefaultFiatWireLinkedInstrument: async (tenantId, accountId) => {
    const result = await client.query(
      `select id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at
         from linked_instruments
        where platform_tenant_id = $1
          and account_of_digital_asset_id = $2
          and instrument_type = 'fiat_wire'
          and provider = 'circle'
          and status = 'active'
          and is_default = true
        order by created_at desc
        limit 1`,
      [tenantId, accountId]
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  findLatestVerifiedCircleWalletLinkedInstrument: async (tenantId, accountId) => {
    const result = await client.query(
      `select id, account_of_digital_asset_id, instrument_type, status, asset_code, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at
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
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  insertMintCircleOperation: async (
    operationId,
    tenantId,
    targetAccountId,
    businessClientId,
    linkedInstrumentId,
    idempotencyKey,
    correlationId,
    requestPayload,
    responsePayload,
    providerWalletId,
    providerAddressId,
    status,
    errorCode
  ) => {
    await client.query(
      `insert into circle_api_operations
        (id, platform_tenant_id, operation_type, idempotency_key, correlation_id, account_of_digital_asset_id, business_client_id, linked_instrument_id, request_payload, response_payload, provider_account_id, provider_wallet_id, provider_address_id, status, error_code, created_at)
       values ($1, $2, 'fiat_wire_mint', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $14, now())`,
      [
        operationId,
        tenantId,
        idempotencyKey,
        correlationId,
        targetAccountId,
        businessClientId,
        linkedInstrumentId,
        JSON.stringify(requestPayload),
        JSON.stringify(responsePayload),
        undefined,
        providerWalletId,
        providerAddressId,
        status,
        errorCode
      ]
    );
  },

  updateLinkedInstrumentMetadata: async (tenantId, linkedInstrumentId, metadata) => {
    await client.query(
      `update linked_instruments
          set metadata = coalesce(metadata, '{}'::jsonb) || $3::jsonb,
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [linkedInstrumentId, tenantId, JSON.stringify(metadata)]
    );
  },

  findFundingInstruction: async (tenantId, fundingInstructionId) => {
    const result = await client.query(
      `select id, instruction_role, status
         from wire_funding_instructions
        where id = $1 and platform_tenant_id = $2
        limit 1
        for update`,
      [fundingInstructionId, tenantId]
    );
    const row = result.rows[0] as { id: string; instruction_role: string; status: string } | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      instructionRole: row.instruction_role,
      status: row.status
    };
  },

  updateFundingInstructionStatus: async (tenantId, fundingInstructionId, status) => {
    await client.query(
      `update wire_funding_instructions
          set status = $3,
              updated_at = now()
        where id = $1 and platform_tenant_id = $2`,
      [fundingInstructionId, tenantId, status]
    );
  },

  updateFundingInstructionOrders: async (tenantId, fundingInstructionId, status) => {
    await client.query(
      `update funding_instruction_orders
          set status = $3,
              updated_at = now()
        where platform_tenant_id = $1
          and funding_instruction_id = $2
          and order_kind = 'internal_mint_ada_transfer'
          and status in ('created', 'route_resolved', 'route_assigned', 'failed', 'exception')`,
      [tenantId, fundingInstructionId, status]
    );
  }
});
