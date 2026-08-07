alter table wire_funding_instructions
  add column if not exists source_account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  add column if not exists destination_account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  add column if not exists business_client_id uuid references business_clients(id),
  add column if not exists funding_type text,
  add column if not exists instruction_role text,
  add column if not exists transfer_kind text,
  add column if not exists asset_code text,
  add column if not exists currency text,
  add column if not exists amount_minor_units numeric(38, 0),
  add column if not exists pending_usdc_minor_units numeric(38, 0),
  add column if not exists available_usdc_minor_units numeric(38, 0),
  add column if not exists provider text,
  add column if not exists provider_reference_id text,
  add column if not exists idempotency_key text,
  add column if not exists correlation_id text,
  add column if not exists requested_by uuid,
  add column if not exists requested_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists route_evidence_json jsonb;

update wire_funding_instructions
   set source_account_of_digital_asset_id = account_of_digital_asset_id
 where source_account_of_digital_asset_id is null;

update wire_funding_instructions
   set destination_account_of_digital_asset_id = account_of_digital_asset_id
 where destination_account_of_digital_asset_id is null;

update wire_funding_instructions
   set funding_type = coalesce(funding_type, 'wire'),
       instruction_role = coalesce(instruction_role, 'client_exchange'),
       transfer_kind = coalesce(transfer_kind, 'ada_to_ada_payin_underlying'),
       asset_code = coalesce(asset_code, 'USDC'),
       currency = coalesce(currency, 'USD'),
       amount_minor_units = coalesce(amount_minor_units, 0),
       pending_usdc_minor_units = coalesce(pending_usdc_minor_units, 0),
       available_usdc_minor_units = coalesce(available_usdc_minor_units, 0),
       provider = coalesce(provider, 'circle'),
       requested_at = coalesce(requested_at, created_at),
       updated_at = coalesce(updated_at, created_at),
       route_evidence_json = coalesce(route_evidence_json, '{}'::jsonb)
 where funding_type is null
    or instruction_role is null
    or transfer_kind is null
    or asset_code is null
    or currency is null
    or amount_minor_units is null
    or pending_usdc_minor_units is null
    or available_usdc_minor_units is null
    or provider is null
    or requested_at is null
    or updated_at is null
    or route_evidence_json is null;

alter table wire_funding_instructions
  alter column funding_type set default 'wire',
  alter column instruction_role set default 'client_exchange',
  alter column transfer_kind set default 'ada_to_ada_payin_underlying',
  alter column asset_code set default 'USDC',
  alter column currency set default 'USD',
  alter column amount_minor_units set default 0,
  alter column pending_usdc_minor_units set default 0,
  alter column available_usdc_minor_units set default 0,
  alter column provider set default 'circle',
  alter column requested_at set default now(),
  alter column updated_at set default now(),
  alter column route_evidence_json set default '{}'::jsonb;

create table if not exists funding_instruction_orders (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  funding_instruction_id uuid not null references wire_funding_instructions(id),
  order_kind text not null,
  dependency_order_id uuid references funding_instruction_orders(id),
  source_account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  destination_account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  amount_minor_units numeric(38, 0) not null,
  currency text not null,
  status text not null,
  provider_reference_id text,
  provider_payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_funding_instruction_orders_tenant_instruction
  on funding_instruction_orders(platform_tenant_id, funding_instruction_id, created_at);

create index if not exists idx_funding_instruction_orders_dependency
  on funding_instruction_orders(dependency_order_id);

create table if not exists provider_webhook_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  signature_valid boolean not null,
  status text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload_json jsonb not null,
  normalized_json jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  retry_count integer not null default 0,
  unique (platform_tenant_id, provider, provider_event_id)
);

create index if not exists idx_provider_webhook_events_status
  on provider_webhook_events(platform_tenant_id, status, received_at desc);

create table if not exists provider_webhook_dead_letters (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  payload_json jsonb not null,
  error_code text,
  error_message text,
  retry_count integer not null default 0,
  operator_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_provider_webhook_dead_letters_tenant_created
  on provider_webhook_dead_letters(platform_tenant_id, created_at desc);

create table if not exists suspense_cases (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  reason text not null,
  webhook_event_id uuid references provider_webhook_events(id),
  reconciliation_break_id uuid,
  status text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_suspense_cases_tenant_status
  on suspense_cases(platform_tenant_id, status, created_at desc);

alter table reconciliation_breaks
  add column if not exists reason text,
  add column if not exists webhook_event_id uuid references provider_webhook_events(id),
  add column if not exists suspense_case_id uuid references suspense_cases(id),
  add column if not exists updated_at timestamptz;

update reconciliation_breaks
   set reason = coalesce(reason, break_type),
       updated_at = coalesce(updated_at, created_at)
 where reason is null or updated_at is null;

alter table reconciliation_breaks
  alter column updated_at set default now();

create index if not exists idx_reconciliation_breaks_webhook_event_id
  on reconciliation_breaks(webhook_event_id);

create index if not exists idx_reconciliation_breaks_suspense_case_id
  on reconciliation_breaks(suspense_case_id);
