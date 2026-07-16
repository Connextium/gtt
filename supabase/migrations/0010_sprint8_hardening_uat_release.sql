create table if not exists hardening_scenario_results (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  scenario_code text not null,
  scenario_name text not null,
  scenario_group text not null,
  status text not null,
  evidence_uri text,
  executed_by text not null,
  executed_at timestamptz not null default now(),
  unique (platform_tenant_id, scenario_code)
);

create table if not exists resilience_test_results (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  test_code text not null,
  test_name text not null,
  status text not null,
  severity text not null,
  finding_summary text,
  evidence_uri text,
  executed_at timestamptz not null default now(),
  unique (platform_tenant_id, test_code)
);

create table if not exists performance_benchmark_results (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  capability text not null,
  target_description text not null,
  measured_value_ms integer not null,
  target_value_ms integer not null,
  status text not null,
  measured_at timestamptz not null default now()
);

create table if not exists uat_scenario_results (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  scenario_number integer not null,
  scenario_name text not null,
  status text not null,
  owner_role text not null,
  evidence_uri text,
  executed_at timestamptz not null default now(),
  unique (platform_tenant_id, scenario_number)
);

create table if not exists uat_signoffs (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  signer_role text not null,
  signer_name text not null,
  status text not null,
  signed_at timestamptz,
  notes text,
  unique (platform_tenant_id, signer_role)
);

create table if not exists pilot_release_artifacts (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  artifact_type text not null,
  artifact_name text not null,
  artifact_uri text not null,
  approval_status text not null,
  approved_by text,
  approved_at timestamptz,
  unique (platform_tenant_id, artifact_type)
);

create table if not exists known_limitations (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  limitation_code text not null,
  description text not null,
  severity text not null,
  mitigation text not null,
  target_resolution text,
  status text not null,
  unique (platform_tenant_id, limitation_code)
);

create table if not exists pilot_release_decisions (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  release_version text not null,
  decision text not null,
  decided_by text not null,
  decided_at timestamptz not null default now(),
  gate_summary jsonb not null default '{}'::jsonb,
  notes text
);
