create table if not exists account_of_digital_asset_balances (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  asset_code text not null default 'USDC',
  currency text not null default 'USD',
  available_minor_units numeric(38, 0) not null default 0,
  pending_minor_units numeric(38, 0) not null default 0,
  reserved_minor_units numeric(38, 0) not null default 0,
  locked_minor_units numeric(38, 0) not null default 0,
  suspense_minor_units numeric(38, 0) not null default 0,
  version integer not null default 1,
  projected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_of_digital_asset_id, asset_code, currency),
  constraint ada_balance_non_negative check (
    available_minor_units >= 0
    and pending_minor_units >= 0
    and reserved_minor_units >= 0
    and locked_minor_units >= 0
    and suspense_minor_units >= 0
  )
);

create table if not exists balance_projection_runs (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  source_journal_count integer not null default 0
);

create table if not exists onboarding_applications (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  business_client_id uuid not null references business_clients(id),
  provider text not null,
  provider_application_id text unique,
  provider_client_entity_id text unique,
  status text not null,
  submitted_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding_schema_snapshots (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  onboarding_application_id uuid not null references onboarding_applications(id),
  provider text not null,
  schema_version text not null,
  schema_body jsonb not null,
  retrieved_at timestamptz not null default now()
);

create table if not exists onboarding_section_responses (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  onboarding_application_id uuid not null references onboarding_applications(id),
  section_key text not null,
  response_body jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  unique (onboarding_application_id, section_key)
);

create table if not exists onboarding_documents (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  onboarding_application_id uuid not null references onboarding_applications(id),
  document_type text not null,
  file_name text not null,
  status text not null,
  external_reference text,
  created_at timestamptz not null default now()
);

create table if not exists webhook_endpoint_configs (
  id uuid primary key,
  provider text not null,
  event_family text not null,
  endpoint_path text not null,
  status text not null,
  created_at timestamptz not null default now(),
  unique (provider, event_family)
);

create index if not exists idx_ada_balances_tenant_account
  on account_of_digital_asset_balances(platform_tenant_id, account_of_digital_asset_id);

create index if not exists idx_onboarding_applications_tenant_client
  on onboarding_applications(platform_tenant_id, business_client_id);

create index if not exists idx_onboarding_sections_application
  on onboarding_section_responses(onboarding_application_id);

insert into webhook_endpoint_configs (id, provider, event_family, endpoint_path, status)
values (
  '00000000-0000-4000-8000-000000000101',
  'circle',
  'onboarding',
  '/webhooks/circle/onboarding',
  'draft'
)
on conflict (provider, event_family) do nothing;
