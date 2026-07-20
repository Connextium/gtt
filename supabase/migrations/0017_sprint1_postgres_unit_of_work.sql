create table if not exists audit_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  event_type text not null,
  request_path text,
  request_method text,
  api_key_id uuid,
  api_client_id uuid,
  actor_user_id uuid,
  correlation_id text not null,
  idempotency_key text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists business_clients
  alter column onboarding_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'business_clients_onboarding_status_check'
  ) then
    alter table business_clients
      add constraint business_clients_onboarding_status_check
      check (onboarding_status in ('draft', 'submitted', 'approved', 'restricted', 'closed'));
  end if;
end;
$$;

alter table if exists accounts_of_digital_asset
  alter column status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_of_digital_asset_status_check'
  ) then
    alter table accounts_of_digital_asset
      add constraint accounts_of_digital_asset_status_check
      check (status in ('draft', 'active', 'restricted', 'closed'));
  end if;
end;
$$;

alter table if exists api_idempotency_records
  add column if not exists request_path text,
  add column if not exists request_method text,
  add column if not exists correlation_id text;

create index if not exists audit_events_tenant_correlation_idx on audit_events(platform_tenant_id, correlation_id);
create index if not exists audit_events_tenant_idempotency_idx on audit_events(platform_tenant_id, idempotency_key);
