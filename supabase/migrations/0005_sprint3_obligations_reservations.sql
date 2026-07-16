create table if not exists settlement_obligations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  obligation_type text not null,
  buyer_business_client_id uuid not null references business_clients(id),
  supplier_business_client_id uuid not null references business_clients(id),
  amount_minor_units numeric(38, 0) not null,
  disputed_minor_units numeric(38, 0) not null default 0,
  currency text not null default 'USD',
  status text not null,
  due_date date not null,
  external_reference text,
  version integer not null default 1,
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_obligation_amounts_valid check (
    amount_minor_units > 0
    and disputed_minor_units >= 0
    and disputed_minor_units <= amount_minor_units
  )
);

create table if not exists settlement_obligation_audit_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  settlement_obligation_id uuid not null references settlement_obligations(id),
  event_type text not null,
  reason_code text,
  actor_user_id uuid,
  actor_roles text[] not null default '{}',
  correlation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists reservation_reason_codes (
  reason_code text primary key,
  reason_name text not null,
  applies_to text not null
);

create table if not exists funding_reservations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  settlement_obligation_id uuid not null references settlement_obligations(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  amount_minor_units numeric(38, 0) not null,
  consumed_minor_units numeric(38, 0) not null default 0,
  priority integer not null default 100,
  status text not null,
  reason_code text references reservation_reason_codes(reason_code),
  expires_at timestamptz,
  activated_at timestamptz,
  released_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_reservation_amounts_valid check (
    amount_minor_units > 0
    and consumed_minor_units >= 0
    and consumed_minor_units <= amount_minor_units
  )
);

create table if not exists funding_reservation_allocations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  funding_reservation_id uuid not null references funding_reservations(id),
  settlement_obligation_id uuid not null references settlement_obligations(id),
  allocated_minor_units numeric(38, 0) not null,
  created_at timestamptz not null default now(),
  constraint funding_reservation_allocation_positive check (allocated_minor_units > 0)
);

create table if not exists reservation_concurrency_locks (
  account_of_digital_asset_id uuid primary key references accounts_of_digital_asset(id),
  platform_tenant_id uuid not null references platform_tenants(id),
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

insert into reservation_reason_codes (reason_code, reason_name, applies_to)
values
  ('buyer_dispute', 'Buyer dispute', 'release'),
  ('supplier_request', 'Supplier request', 'release'),
  ('operator_error', 'Operator error', 'release_cancel_expire'),
  ('reservation_expired', 'Reservation expired', 'expire'),
  ('obligation_cancelled', 'Obligation cancelled', 'cancel')
on conflict (reason_code) do nothing;

insert into posting_rules (event_type, rule_name, status)
values
  ('settlement_obligation.approved', 'Recognize approved trade payable', 'draft'),
  ('funding_reservation.activated', 'Reserve ADA funding', 'active'),
  ('funding_reservation.released', 'Release ADA funding reservation', 'active'),
  ('funding_reservation.expired', 'Expire ADA funding reservation', 'active'),
  ('funding_reservation.cancelled', 'Cancel ADA funding reservation', 'active')
on conflict (event_type) do nothing;

create index if not exists idx_settlement_obligations_tenant_status
  on settlement_obligations(platform_tenant_id, status);

create index if not exists idx_funding_reservations_tenant_obligation
  on funding_reservations(platform_tenant_id, settlement_obligation_id);

create index if not exists idx_funding_reservations_account_status
  on funding_reservations(account_of_digital_asset_id, status);
