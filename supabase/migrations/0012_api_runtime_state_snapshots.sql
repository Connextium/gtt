create table if not exists api_runtime_state_snapshots (
  snapshot_name text primary key,
  state_payload jsonb not null,
  schema_version text not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_api_runtime_state_snapshots_updated_at
  on api_runtime_state_snapshots(updated_at);
