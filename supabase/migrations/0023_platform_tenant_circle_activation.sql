create table if not exists platform_tenant_circle_integrations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  provider text not null default 'circle',
  environment text not null,
  wallet_set_id text,
  wallet_set_name text not null,
  wallet_blockchain text not null,
  wallet_strategy text not null default 'omnibus_custodial_set',
  status text not null default 'draft',
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint platform_tenant_circle_integrations_provider_check check (provider = 'circle'),
  constraint platform_tenant_circle_integrations_environment_check check (environment in ('simulator', 'circle-sandbox', 'circle-production')),
  constraint platform_tenant_circle_integrations_status_check check (status in ('draft', 'activating', 'active', 'failed'))
);

create unique index if not exists platform_tenant_circle_integrations_tenant_provider_uidx
  on platform_tenant_circle_integrations(platform_tenant_id, provider);

create index if not exists platform_tenant_circle_integrations_status_idx
  on platform_tenant_circle_integrations(platform_tenant_id, status, updated_at desc);
