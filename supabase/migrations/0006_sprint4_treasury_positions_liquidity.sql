create table if not exists treasury_position_snapshots (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  scope_type text not null,
  scope_id text not null,
  account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  business_client_id uuid references business_clients(id),
  asset_code text not null default 'USDC',
  currency text not null default 'USD',
  current_minor_units numeric(38, 0) not null default 0,
  deployable_minor_units numeric(38, 0) not null default 0,
  projected_minor_units numeric(38, 0) not null default 0,
  pending_inbound_minor_units numeric(38, 0) not null default 0,
  pending_outbound_minor_units numeric(38, 0) not null default 0,
  expected_payable_minor_units numeric(38, 0) not null default 0,
  expected_receivable_minor_units numeric(38, 0) not null default 0,
  minimum_buffer_minor_units numeric(38, 0) not null default 0,
  source_balance_version integer not null,
  position_version integer not null,
  freshness_status text not null,
  calculated_at timestamptz not null default now(),
  stale_after timestamptz not null,
  constraint treasury_position_amounts_non_negative check (
    current_minor_units >= 0
    and deployable_minor_units >= 0
    and pending_inbound_minor_units >= 0
    and pending_outbound_minor_units >= 0
    and expected_payable_minor_units >= 0
    and expected_receivable_minor_units >= 0
    and minimum_buffer_minor_units >= 0
  )
);

create table if not exists liquidity_policies (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  scope_type text not null,
  scope_id text not null,
  minimum_balance_minor_units numeric(38, 0) not null default 0,
  target_balance_minor_units numeric(38, 0) not null default 0,
  maximum_balance_minor_units numeric(38, 0) not null default 0,
  approval_threshold_minor_units numeric(38, 0) not null default 0,
  stale_after_seconds integer not null default 300,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_tenant_id, scope_type, scope_id),
  constraint liquidity_policy_amounts_valid check (
    minimum_balance_minor_units >= 0
    and target_balance_minor_units >= minimum_balance_minor_units
    and maximum_balance_minor_units >= target_balance_minor_units
    and approval_threshold_minor_units >= 0
  )
);

create table if not exists liquidity_policy_accounts (
  id uuid primary key,
  liquidity_policy_id uuid not null references liquidity_policies(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  direction text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists liquidity_alerts (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  treasury_position_snapshot_id uuid not null references treasury_position_snapshots(id),
  alert_type text not null,
  amount_minor_units numeric(38, 0) not null default 0,
  severity text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_treasury_position_snapshots_tenant_scope
  on treasury_position_snapshots(platform_tenant_id, scope_type, scope_id, calculated_at desc);

create index if not exists idx_liquidity_alerts_tenant_status
  on liquidity_alerts(platform_tenant_id, status);
