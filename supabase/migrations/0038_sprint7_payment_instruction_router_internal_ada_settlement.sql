alter table if exists payment_instructions
  add column if not exists instruction_type text,
  add column if not exists currency text,
  add column if not exists correlation_id text,
  add column if not exists created_by uuid references app_users(id),
  add column if not exists updated_at timestamptz,
  add column if not exists routed_at timestamptz,
  add column if not exists executed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists route_evidence_json jsonb;

update payment_instructions
   set instruction_type = coalesce(
         instruction_type,
         case
           when route_type = 'internal' then 'internal_ada_settlement'
           when route_type = 'external_usdc' then 'external_usdc_payment'
           else 'payment_execution'
         end
       ),
       currency = coalesce(currency, 'USD'),
       updated_at = coalesce(updated_at, created_at, now()),
       route_evidence_json = coalesce(route_evidence_json, '{}'::jsonb)
 where instruction_type is null
    or currency is null
    or updated_at is null
    or route_evidence_json is null;

alter table if exists payment_instructions
  alter column instruction_type set default 'internal_ada_settlement',
  alter column currency set default 'USD',
  alter column updated_at set default now(),
  alter column route_evidence_json set default '{}'::jsonb;

create table if not exists route_profiles (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  profile_code text not null,
  profile_name text not null,
  strategy_type text not null default 'weighted',
  weight_cost numeric(8, 4) not null default 0.25,
  weight_latency numeric(8, 4) not null default 0.25,
  weight_liquidity numeric(8, 4) not null default 0.25,
  weight_reliability numeric(8, 4) not null default 0.25,
  status text not null default 'active',
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint route_profiles_weights_nonnegative check (
    weight_cost >= 0 and weight_latency >= 0 and weight_liquidity >= 0 and weight_reliability >= 0
  ),
  unique (platform_tenant_id, profile_code)
);

create index if not exists idx_route_profiles_tenant_status
  on route_profiles(platform_tenant_id, status, created_at desc);

create table if not exists route_bindings (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  profile_id uuid not null references route_profiles(id),
  route_code text not null,
  binding_scope text not null default 'default',
  match_expression text not null default '*',
  priority integer not null default 100,
  active boolean not null default true,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_tenant_id, route_code)
);

create index if not exists idx_route_bindings_tenant_priority
  on route_bindings(platform_tenant_id, active, priority desc, created_at desc);

create table if not exists routing_decisions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  payment_instruction_id uuid not null references payment_instructions(id),
  selected_route_code text not null,
  selected_profile_id uuid references route_profiles(id),
  decision_reason text not null,
  candidate_scores_json jsonb not null default '{}'::jsonb,
  override_applied boolean not null default false,
  override_reason text,
  decided_by uuid references app_users(id),
  decided_at timestamptz not null default now(),
  unique (platform_tenant_id, payment_instruction_id)
);

create index if not exists idx_routing_decisions_tenant_decided
  on routing_decisions(platform_tenant_id, decided_at desc);

create table if not exists internal_ada_settlements (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  payment_instruction_id uuid not null references payment_instructions(id),
  route_code text not null,
  source_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  destination_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  amount_minor_units numeric(38, 0) not null,
  status text not null,
  failure_reason text,
  provider_reference_id text,
  journal_entry_id uuid references treasury_journal_entries(id),
  started_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_ada_settlement_amount_positive check (amount_minor_units > 0),
  unique (platform_tenant_id, payment_instruction_id)
);

create index if not exists idx_internal_ada_settlements_tenant_status
  on internal_ada_settlements(platform_tenant_id, status, created_at desc);

create table if not exists routing_and_settlement_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  payment_instruction_id uuid not null references payment_instructions(id),
  settlement_id uuid references internal_ada_settlements(id),
  event_type text not null,
  event_payload_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid references app_users(id),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_routing_settlement_events_instruction
  on routing_and_settlement_events(platform_tenant_id, payment_instruction_id, occurred_at desc);

create index if not exists idx_routing_settlement_events_settlement
  on routing_and_settlement_events(platform_tenant_id, settlement_id, occurred_at desc)
  where settlement_id is not null;
