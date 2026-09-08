alter table if exists settlement_obligations
  add column if not exists business_client_id uuid references business_clients(id),
  add column if not exists principal_minor_units numeric(38, 0),
  add column if not exists fulfilled_minor_units numeric(38, 0) not null default 0,
  add column if not exists source_reference_id text,
  add column if not exists source_reference_type text,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid references app_users(id),
  add column if not exists due_at timestamptz,
  add column if not exists cancelled_reason text,
  add column if not exists failed_reason text,
  add column if not exists expired_at timestamptz,
  add column if not exists fulfilled_at timestamptz;

update settlement_obligations
   set principal_minor_units = amount_minor_units
 where principal_minor_units is null;

update settlement_obligations
   set business_client_id = coalesce(business_client_id, supplier_business_client_id, buyer_business_client_id)
 where business_client_id is null;

update settlement_obligations
   set due_at = coalesce(due_at, (due_date::timestamptz + interval '12 hours'))
 where due_at is null and due_date is not null;

alter table if exists settlement_obligations
  alter column principal_minor_units set not null,
  add constraint settlement_obligations_principal_positive check (principal_minor_units > 0),
  add constraint settlement_obligations_fulfilled_range check (
    fulfilled_minor_units >= 0
    and fulfilled_minor_units <= principal_minor_units
  );

create table if not exists obligation_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  obligation_id uuid not null references settlement_obligations(id),
  reservation_id uuid references funding_reservations(id),
  event_type text not null,
  event_payload_json jsonb not null default '{}'::jsonb,
  actor_user_id uuid references app_users(id),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_obligation_events_obligation
  on obligation_events(platform_tenant_id, obligation_id, occurred_at desc);

create table if not exists obligation_journal_links (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  obligation_id uuid not null references settlement_obligations(id),
  journal_entry_id uuid not null references treasury_journal_entries(id),
  journal_status text not null default 'posted',
  created_at timestamptz not null default now()
);

create index if not exists idx_obligation_journal_links_obligation
  on obligation_journal_links(platform_tenant_id, obligation_id, created_at desc);

create unique index if not exists idx_obligation_journal_links_unique
  on obligation_journal_links(platform_tenant_id, obligation_id, journal_entry_id);

alter table if exists funding_reservations
  add column if not exists available_minor_units_snapshot numeric(38, 0),
  add column if not exists provider_reference_id text,
  add column if not exists idempotency_key text,
  add column if not exists created_by uuid references app_users(id),
  add column if not exists consumed_at timestamptz,
  add column if not exists status_reason text;

create index if not exists idx_funding_reservations_status
  on funding_reservations(platform_tenant_id, status, created_at desc);

insert into posting_rules (
  event_type,
  rule_name,
  status,
  debit_ledger_account_code,
  credit_ledger_account_code
)
values
  ('settlement_obligation.created', 'Track obligation creation', 'active', '10020', '20400'),
  ('settlement_obligation.fulfilled', 'Track obligation fulfillment', 'active', '10020', '20400'),
  ('settlement_obligation.cancelled', 'Track obligation cancellation', 'active', '10020', '20400'),
  ('funding_reservation.consumed', 'Consume ADA funding reservation', 'active', '10020', '20400')
on conflict (event_type) do nothing;
