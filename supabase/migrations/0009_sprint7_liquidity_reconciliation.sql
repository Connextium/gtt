create table if not exists liquidity_rebalancing_instructions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  destination_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  amount_minor_units numeric(38, 0) not null,
  estimated_fee_minor_units numeric(38, 0) not null default 0,
  route_type text not null,
  route_explanation text not null,
  recommendation_reason text not null,
  source_position_snapshot_id text not null,
  destination_position_snapshot_id text not null,
  approval_required boolean not null,
  approved_by text,
  approved_at timestamptz,
  executed_at timestamptz,
  status text not null,
  created_at timestamptz not null default now(),
  constraint liquidity_rebalance_amount_positive check (amount_minor_units > 0 and estimated_fee_minor_units >= 0)
);

create table if not exists liquidity_rebalancing_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  liquidity_rebalancing_instruction_id uuid not null references liquidity_rebalancing_instructions(id),
  event_type text not null,
  actor_user_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists circle_balance_snapshots (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  asset_code text not null default 'USDC',
  available_minor_units numeric(38, 0) not null,
  snapshot_source text not null,
  captured_at timestamptz not null default now()
);

create table if not exists circle_transaction_snapshots (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  provider_transaction_id text not null,
  transaction_type text not null,
  amount_minor_units numeric(38, 0) not null,
  status text not null,
  captured_at timestamptz not null default now(),
  unique (platform_tenant_id, provider_transaction_id)
);

create table if not exists reconciliation_runs (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  run_type text not null,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists reconciliation_breaks (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  reconciliation_run_id uuid not null references reconciliation_runs(id),
  account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  break_type text not null,
  severity text not null,
  platform_amount_minor_units numeric(38, 0) not null,
  circle_amount_minor_units numeric(38, 0) not null,
  delta_minor_units numeric(38, 0) not null,
  assigned_to text,
  resolution_type text,
  resolution_note text,
  evidence_uri text,
  status text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists reconciliation_break_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  reconciliation_break_id uuid not null references reconciliation_breaks(id),
  event_type text not null,
  actor_user_id text not null,
  note text,
  evidence_uri text,
  created_at timestamptz not null default now()
);

create table if not exists daily_close_reports (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  close_date date not null,
  status text not null,
  open_break_count integer not null default 0,
  trial_balance_debit_minor_units numeric(38, 0) not null,
  trial_balance_credit_minor_units numeric(38, 0) not null,
  customer_liability_minor_units numeric(38, 0) not null,
  circle_custody_minor_units numeric(38, 0) not null,
  suspense_minor_units numeric(38, 0) not null,
  generated_at timestamptz not null default now(),
  unique (platform_tenant_id, close_date)
);
