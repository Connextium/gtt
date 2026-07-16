create table if not exists business_clients (
  id uuid primary key,
  legal_name text not null,
  country text not null,
  onboarding_status text not null,
  circle_client_entity_id text unique,
  circle_application_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists digital_asset_accounts (
  id uuid primary key,
  business_client_id uuid not null references business_clients(id),
  account_name text not null,
  use_purpose text not null,
  status text not null,
  circle_account_id text unique,
  circle_sub_account_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ledger_accounts (
  id uuid primary key,
  account_code text not null unique,
  account_name text not null,
  account_class text not null,
  normal_balance text not null,
  created_at timestamptz not null default now()
);

create table if not exists treasury_journal_entries (
  id uuid primary key,
  source_event_id text not null unique,
  description text not null,
  posted_at timestamptz not null default now(),
  reversal_of_journal_entry_id uuid references treasury_journal_entries(id)
);

create table if not exists treasury_journal_lines (
  id uuid primary key,
  journal_entry_id uuid not null references treasury_journal_entries(id),
  ledger_account_id uuid not null references ledger_accounts(id),
  digital_asset_account_id uuid references digital_asset_accounts(id),
  party_id uuid,
  asset_code text not null default 'USDC',
  currency text not null default 'USD',
  debit_minor_units numeric(38, 0) not null default 0,
  credit_minor_units numeric(38, 0) not null default 0,
  created_at timestamptz not null default now(),
  constraint journal_line_single_sided check (
    (debit_minor_units > 0 and credit_minor_units = 0)
    or (credit_minor_units > 0 and debit_minor_units = 0)
  )
);

create table if not exists idempotency_keys (
  idempotency_key text primary key,
  request_hash text not null,
  response_body jsonb,
  created_at timestamptz not null default now()
);

create table if not exists inbound_events (
  event_id text primary key,
  source text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists outbox_events (
  id uuid primary key,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
