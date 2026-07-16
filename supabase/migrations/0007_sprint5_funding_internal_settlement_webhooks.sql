create table if not exists webhook_notifications (
  id uuid primary key,
  provider text not null,
  event_id text not null unique,
  event_type text not null,
  signature_valid boolean not null,
  raw_payload jsonb not null,
  processing_status text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists notification_processing_attempts (
  id uuid primary key,
  webhook_notification_id uuid not null references webhook_notifications(id),
  attempt_number integer not null,
  status text not null,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists wire_funding_instructions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  bank_name text not null,
  routing_number text not null,
  account_number_last4 text not null,
  beneficiary_name text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists funding_deposits (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  webhook_notification_id uuid references webhook_notifications(id),
  amount_minor_units numeric(38, 0) not null,
  status text not null,
  provider_deposit_id text unique,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint funding_deposit_amount_positive check (amount_minor_units > 0)
);

create table if not exists payment_instructions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  destination_account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  settlement_obligation_id uuid references settlement_obligations(id),
  funding_reservation_id uuid references funding_reservations(id),
  amount_minor_units numeric(38, 0) not null,
  route_type text not null,
  status text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  terminal_at timestamptz,
  constraint payment_instruction_amount_positive check (amount_minor_units > 0)
);

create table if not exists payment_instruction_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  payment_instruction_id uuid not null references payment_instructions(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists internal_transfer_executions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  payment_instruction_id uuid not null references payment_instructions(id),
  provider text not null,
  provider_transfer_id text unique,
  status text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_notifications_status
  on webhook_notifications(processing_status);

create index if not exists idx_payment_instructions_tenant_status
  on payment_instructions(platform_tenant_id, status);
