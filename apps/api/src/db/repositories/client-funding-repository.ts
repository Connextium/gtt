import type { PostgresQueryClient } from "../postgres-route-types.js";

export interface ClientFundingIdentity {
  businessClientId: string;
  businessClientName: string;
}

export interface ClientFundingAccount {
  id: string;
  businessClientId: string;
  accountName: string;
  status: string;
  assetCode: string;
}

export interface ClientFundingInstructionSeed {
  id: string;
  tenantId: string;
  businessClientId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinorUnits: string;
  idempotencyKey: string;
  correlationId: string;
  requestedBy: string;
  requestedAt: string;
  routeEvidence: Record<string, unknown>;
  wireOrderId: string;
  usdcOrderId: string;
}

export interface ClientFundingRepository {
  resolveIdentity: (tenantId: string, authUserId: string) => Promise<ClientFundingIdentity | undefined>;
  findOwnedAccount: (tenantId: string, businessClientId: string, accountId: string) => Promise<ClientFundingAccount | undefined>;
  findEligibleLinkedInstrument: (
    tenantId: string,
    accountId: string,
    capability: "fiat" | "usdc"
  ) => Promise<Record<string, unknown> | undefined>;
  createInstruction: (seed: ClientFundingInstructionSeed) => Promise<void>;
  listInstructions: (tenantId: string, businessClientId: string, filters: Record<string, string>) => Promise<Record<string, unknown>[]>;
  getInstruction: (tenantId: string, businessClientId: string, instructionId: string) => Promise<Record<string, unknown> | undefined>;
  listOrders: (tenantId: string, businessClientId: string, instructionId: string) => Promise<Record<string, unknown>[]>;
  writeAuditAndOutbox: (
    tenantId: string,
    eventType: string,
    correlationId: string,
    idempotencyKey: string,
    payload: Record<string, unknown>,
    auditId: string,
    outboxId: string
  ) => Promise<void>;
}

export const createClientFundingRepository = (client: PostgresQueryClient): ClientFundingRepository => ({
  resolveIdentity: async (tenantId, authUserId) => {
    const result = await client.query(
      `select business_client.id, business_client.legal_name
         from business_onboarding_applications application
         join business_clients business_client
           on business_client.platform_tenant_id = $1
          and (
            business_client.id = application.id
            or business_client.correlation_id = 'business_onboarding:' || application.id::text
          )
        where application.auth_user_id = $2::uuid
          and application.status = 'approved'
        order by business_client.created_at desc
        limit 1`,
      [tenantId, authUserId]
    );
    const row = result.rows[0];
    return row ? {
      businessClientId: String(row.id),
      businessClientName: String(row.legal_name)
    } : undefined;
  },

  findOwnedAccount: async (tenantId, businessClientId, accountId) => {
    const result = await client.query(
      `select id, business_client_id, account_name, status, coalesce(asset_code, 'USDC') as asset_code
         from accounts_of_digital_asset
        where platform_tenant_id = $1
          and business_client_id = $2
          and id = $3`,
      [tenantId, businessClientId, accountId]
    );
    const row = result.rows[0];
    return row ? {
      id: String(row.id),
      businessClientId: String(row.business_client_id),
      accountName: String(row.account_name),
      status: String(row.status),
      assetCode: String(row.asset_code)
    } : undefined;
  },

  findEligibleLinkedInstrument: async (tenantId, accountId, capability) => {
    const result = await client.query(
      `select id, instrument_type, rail_type, purpose, provider, network_code, metadata
         from linked_instruments
        where platform_tenant_id = $1
          and account_of_digital_asset_id = $2
          and status = 'active'
          and verification_status = 'verified'
          and (
            ($3 = 'fiat' and rail_type = 'fiat' and purpose in ('minting', 'bidirectional', 'payment'))
            or ($3 = 'usdc' and instrument_type = 'circle_wallet')
          )
        order by is_default desc, created_at asc, id asc
        limit 1`,
      [tenantId, accountId, capability]
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      instrumentType: row.instrument_type,
      railType: row.rail_type,
      purpose: row.purpose,
      provider: row.provider,
      networkCode: row.network_code,
      metadata: row.metadata ?? {}
    } : undefined;
  },

  createInstruction: async (seed) => {
    await client.query(
      `insert into wire_funding_instructions
        (id, platform_tenant_id, account_of_digital_asset_id, source_account_of_digital_asset_id,
         destination_account_of_digital_asset_id, business_client_id, funding_type, instruction_role,
         transfer_kind, asset_code, currency, amount_minor_units, pending_usdc_minor_units,
         available_usdc_minor_units, status, provider, idempotency_key, correlation_id, requested_by,
         requested_at, updated_at, bank_name, routing_number, account_number_last4, beneficiary_name,
         route_evidence_json)
       values
        ($1, $2, $3, $4, $3, $5, 'usdc_payin', 'client_exchange',
         'ada_to_ada_payin_underlying', 'USDC', 'USD', $6, 0, 0, 'created', 'circle', $7, $8,
         $9::uuid, $10, $10, 'CIRCLE', '000000000', '0000', 'Client USDC Funding', $11::jsonb)`,
      [
        seed.id,
        seed.tenantId,
        seed.destinationAccountId,
        seed.sourceAccountId,
        seed.businessClientId,
        seed.amountMinorUnits,
        seed.idempotencyKey,
        seed.correlationId,
        seed.requestedBy,
        seed.requestedAt,
        JSON.stringify(seed.routeEvidence)
      ]
    );
    await client.query(
      `insert into funding_instruction_orders
        (id, platform_tenant_id, funding_instruction_id, order_kind, source_account_of_digital_asset_id,
         destination_account_of_digital_asset_id, amount_minor_units, currency, status, provider_payload_json)
       values ($1, $2, $3, 'ada_wire_transfer', $4, null, $5, 'USD', 'created', '{}'::jsonb)`,
      [seed.wireOrderId, seed.tenantId, seed.id, seed.sourceAccountId, seed.amountMinorUnits]
    );
    await client.query(
      `insert into funding_instruction_orders
        (id, platform_tenant_id, funding_instruction_id, order_kind, dependency_order_id,
         source_account_of_digital_asset_id, destination_account_of_digital_asset_id,
         amount_minor_units, currency, status, provider_payload_json)
       values ($1, $2, $3, 'ada_usdc_transfer', $4, null, $5, $6, 'USD', 'blocked_dependency', '{}'::jsonb)`,
      [seed.usdcOrderId, seed.tenantId, seed.id, seed.wireOrderId, seed.destinationAccountId, seed.amountMinorUnits]
    );
  },

  listInstructions: async (tenantId, businessClientId, filters) => {
    const values: unknown[] = [tenantId, businessClientId];
    const clauses = [
      "instruction.platform_tenant_id = $1",
      "instruction.business_client_id = $2",
      "instruction.instruction_role = 'client_exchange'"
    ];
    if (filters.status) {
      values.push(filters.status);
      clauses.push(`instruction.status = $${values.length}`);
    }
    if (filters.from) {
      values.push(filters.from);
      clauses.push(`coalesce(instruction.requested_at, instruction.created_at) >= $${values.length}::timestamptz`);
    }
    if (filters.to) {
      values.push(filters.to);
      clauses.push(`coalesce(instruction.requested_at, instruction.created_at) < $${values.length}::timestamptz + interval '1 day'`);
    }
    const result = await client.query(
      `${clientInstructionSelect}
        where ${clauses.join(" and ")}
        order by coalesce(instruction.requested_at, instruction.created_at) desc
        limit 200`,
      values
    );
    return result.rows as Record<string, unknown>[];
  },

  getInstruction: async (tenantId, businessClientId, instructionId) => {
    const result = await client.query(
      `${clientInstructionSelect}
        where instruction.platform_tenant_id = $1
          and instruction.business_client_id = $2
          and instruction.id = $3
          and instruction.instruction_role = 'client_exchange'`,
      [tenantId, businessClientId, instructionId]
    );
    return result.rows[0] as Record<string, unknown> | undefined;
  },

  listOrders: async (tenantId, businessClientId, instructionId) => {
    const result = await client.query(
      `select orders.id, orders.order_kind, orders.dependency_order_id, orders.amount_minor_units,
              orders.currency, orders.status, orders.created_at, orders.updated_at,
              orders.completed_webhook_event_id, orders.journal_entry_id
         from funding_instruction_orders orders
         join wire_funding_instructions instruction
           on instruction.id = orders.funding_instruction_id
          and instruction.platform_tenant_id = orders.platform_tenant_id
        where orders.platform_tenant_id = $1
          and instruction.business_client_id = $2
          and instruction.id = $3
          and instruction.instruction_role = 'client_exchange'
        order by orders.created_at asc, orders.order_kind asc`,
      [tenantId, businessClientId, instructionId]
    );
    return result.rows as Record<string, unknown>[];
  },

  writeAuditAndOutbox: async (tenantId, eventType, correlationId, idempotencyKey, payload, auditId, outboxId) => {
    await client.query(
      `insert into audit_events
        (id, platform_tenant_id, event_type, request_path, request_method, correlation_id, idempotency_key, payload)
       values ($1, $2, $3, '/business/me/funding-instructions', 'POST', $4, $5, $6::jsonb)`,
      [auditId, tenantId, eventType, correlationId, idempotencyKey, JSON.stringify(payload)]
    );
    await client.query(
      `insert into event_outbox
        (id, platform_tenant_id, event_type, payload, status, attempt_count)
       values ($1, $2, $3, $4::jsonb, 'pending', 0)`,
      [outboxId, tenantId, eventType, JSON.stringify({ ...payload, outboxEventId: outboxId })]
    );
  }
});

const clientInstructionSelect = `select instruction.id,
       instruction.source_account_of_digital_asset_id,
       instruction.destination_account_of_digital_asset_id,
       source.account_name as source_account_name,
       source.use_purpose as source_use_purpose,
       coalesce(source.asset_code, 'USDC') as source_asset_code,
       destination.account_name as destination_account_name,
       destination.use_purpose as destination_use_purpose,
       coalesce(destination.asset_code, 'USDC') as destination_asset_code,
       instruction.amount_minor_units,
       instruction.pending_usdc_minor_units,
       instruction.available_usdc_minor_units,
       instruction.status,
       instruction.posting_journal_entry_id,
       coalesce(instruction.requested_at, instruction.created_at) as created_at,
       coalesce(instruction.updated_at, instruction.created_at) as updated_at
  from wire_funding_instructions instruction
  left join accounts_of_digital_asset source
    on source.id = instruction.source_account_of_digital_asset_id
   and source.platform_tenant_id = instruction.platform_tenant_id
  left join accounts_of_digital_asset destination
    on destination.id = instruction.destination_account_of_digital_asset_id
   and destination.platform_tenant_id = instruction.platform_tenant_id`;
