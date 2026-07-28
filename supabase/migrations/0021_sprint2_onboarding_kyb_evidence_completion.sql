create table if not exists onboarding_rfi_tasks (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  onboarding_application_id uuid not null references business_onboarding_applications(id) on delete cascade,
  business_client_id uuid references business_clients(id),
  status text not null check (status in ('open', 'responded', 'closed', 'cancelled')),
  requested_fields text[] not null default '{}',
  note text,
  requester_email text,
  assignee_email text,
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding_status_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  onboarding_application_id uuid not null references business_onboarding_applications(id) on delete cascade,
  business_client_id uuid references business_clients(id),
  previous_status text,
  next_status text not null,
  source text not null check (source in ('applicant', 'internal_review', 'circle_webhook', 'circle_poll')),
  provider text,
  provider_event_id text,
  event_type text,
  idempotency_key text,
  actor_email text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists circle_kyb_evidence (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  onboarding_application_id uuid not null references business_onboarding_applications(id) on delete cascade,
  business_client_id uuid references business_clients(id),
  operation_type text not null check (operation_type in ('kyb_application_create', 'kyb_status_poll', 'kyb_status_webhook')),
  provider text not null default 'circle',
  provider_application_id text,
  provider_client_entity_id text,
  provider_event_id text,
  provider_status text not null,
  idempotency_key text,
  correlation_id text not null,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table if exists circle_api_operations
  add column if not exists onboarding_application_id uuid references business_onboarding_applications(id),
  add column if not exists business_client_id uuid references business_clients(id),
  add column if not exists correlation_id text;

create index if not exists onboarding_rfi_tasks_application_idx
  on onboarding_rfi_tasks(platform_tenant_id, onboarding_application_id, status, created_at desc);

create index if not exists onboarding_status_events_application_idx
  on onboarding_status_events(platform_tenant_id, onboarding_application_id, created_at desc);

create unique index if not exists onboarding_status_events_provider_event_uidx
  on onboarding_status_events(platform_tenant_id, provider, provider_event_id, event_type)
  where provider_event_id is not null;

create index if not exists circle_kyb_evidence_application_idx
  on circle_kyb_evidence(platform_tenant_id, onboarding_application_id, created_at desc);

create unique index if not exists circle_kyb_evidence_provider_event_uidx
  on circle_kyb_evidence(platform_tenant_id, provider, provider_event_id, operation_type)
  where provider_event_id is not null;
