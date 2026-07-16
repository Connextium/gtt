create table if not exists external_recipients (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  label text not null,
  asset_code text not null default 'USDC',
  chain text not null,
  address text not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique (platform_tenant_id, chain, address)
);

create table if not exists external_payment_executions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  external_recipient_id uuid not null references external_recipients(id),
  settlement_obligation_id uuid references settlement_obligations(id),
  funding_reservation_id uuid references funding_reservations(id),
  amount_minor_units numeric(38, 0) not null,
  fee_minor_units numeric(38, 0) not null default 0,
  idempotency_key text not null unique,
  status text not null,
  provider_transfer_id text unique,
  blockchain_tx_hash text,
  failure_code text,
  created_at timestamptz not null default now(),
  terminal_at timestamptz,
  constraint external_payment_amount_positive check (amount_minor_units > 0 and fee_minor_units >= 0)
);

create table if not exists fiat_wire_accounts (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  business_client_id uuid not null references business_clients(id),
  bank_name text not null,
  account_number_last4 text not null,
  routing_number text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists redemption_instructions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  fiat_wire_account_id uuid not null references fiat_wire_accounts(id),
  amount_minor_units numeric(38, 0) not null,
  idempotency_key text not null unique,
  status text not null,
  provider_withdrawal_id text unique,
  suspense_reason text,
  created_at timestamptz not null default now(),
  terminal_at timestamptz,
  constraint redemption_amount_positive check (amount_minor_units > 0)
);

create table if not exists redemption_execution_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  redemption_instruction_id uuid not null references redemption_instructions(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists execution_reversal_obligations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source_execution_id text not null,
  source_execution_type text not null,
  reason_code text not null,
  status text not null,
  created_at timestamptz not null default now()
);
