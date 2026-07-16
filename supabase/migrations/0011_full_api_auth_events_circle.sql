create table if not exists api_clients (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  client_name text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  api_client_id uuid not null references api_clients(id),
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default '{}',
  status text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  rotated_from_api_key_id uuid references api_keys(id),
  last_used_at timestamptz,
  last_used_ip text,
  created_at timestamptz not null default now(),
  unique (key_prefix)
);

create table if not exists api_key_audit_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  api_key_id uuid references api_keys(id),
  api_client_id uuid references api_clients(id),
  event_type text not null,
  actor_user_id text,
  request_path text,
  request_method text,
  created_at timestamptz not null default now()
);

create table if not exists api_idempotency_records (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  idempotency_key text not null,
  request_hash text not null,
  response_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (platform_tenant_id, idempotency_key)
);

create table if not exists event_outbox (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists event_inbox (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source text not null,
  source_event_id text not null,
  event_type text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  status text not null,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (platform_tenant_id, source, source_event_id)
);

create table if not exists dead_letter_events (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  source_event_id text not null,
  event_type text not null,
  failure_reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  replayed_at timestamptz
);

create table if not exists circle_api_operations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  operation_type text not null,
  idempotency_key text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  provider_reference_id text,
  status text not null,
  error_code text,
  created_at timestamptz not null default now()
);

create table if not exists circle_webhook_payloads (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  provider_event_id text not null,
  signature_valid boolean not null,
  raw_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  status text not null,
  received_at timestamptz not null default now(),
  unique (platform_tenant_id, provider_event_id)
);
