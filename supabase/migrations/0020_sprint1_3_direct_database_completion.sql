create table if not exists business_client_lifecycle_transitions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  business_client_id uuid not null references business_clients(id),
  from_status text not null,
  to_status text not null,
  reason text,
  actor_user_id uuid,
  actor_role text,
  correlation_id text not null,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create table if not exists account_of_digital_asset_lifecycle_transitions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  from_status text not null,
  to_status text not null,
  reason text,
  actor_user_id uuid,
  actor_role text,
  correlation_id text not null,
  idempotency_key text,
  created_at timestamptz not null default now()
);

alter table if exists event_outbox
  add column if not exists last_error text,
  add column if not exists published_at timestamptz;

alter table if exists event_inbox
  add column if not exists last_error text;

create index if not exists business_client_lifecycle_transitions_client_idx
  on business_client_lifecycle_transitions(platform_tenant_id, business_client_id, created_at desc);

create index if not exists account_of_digital_asset_lifecycle_transitions_account_idx
  on account_of_digital_asset_lifecycle_transitions(platform_tenant_id, account_of_digital_asset_id, created_at desc);

create index if not exists event_outbox_status_idx
  on event_outbox(platform_tenant_id, status, created_at desc);

create index if not exists event_inbox_status_idx
  on event_inbox(platform_tenant_id, status, created_at desc);
