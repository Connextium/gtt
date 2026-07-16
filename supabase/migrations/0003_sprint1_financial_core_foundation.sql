create table if not exists platform_tenants (
  id uuid primary key,
  tenant_name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  email text not null unique,
  display_name text not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists roles (
  id uuid primary key,
  role_code text not null unique,
  role_name text not null
);

create table if not exists user_role_assignments (
  user_id uuid not null references app_users(id),
  role_id uuid not null references roles(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

alter table if exists business_clients
  add column if not exists platform_tenant_id uuid references platform_tenants(id),
  add column if not exists created_by_user_id uuid references app_users(id),
  add column if not exists correlation_id text;

alter table if exists accounts_of_digital_asset
  add column if not exists platform_tenant_id uuid references platform_tenants(id),
  add column if not exists asset_code text not null default 'USDC',
  add column if not exists asset_rail text not null default 'circle_internal',
  add column if not exists created_by_user_id uuid references app_users(id),
  add column if not exists correlation_id text;

create table if not exists assets (
  asset_code text primary key,
  asset_name text not null,
  minor_unit_scale integer not null,
  status text not null
);

create table if not exists asset_rails (
  rail_code text primary key,
  asset_code text not null references assets(asset_code),
  rail_name text not null,
  status text not null
);

create table if not exists linked_instruments (
  id uuid primary key,
  account_of_digital_asset_id uuid not null references accounts_of_digital_asset(id),
  instrument_type text not null,
  status text not null,
  external_reference text,
  created_at timestamptz not null default now()
);

alter table if exists treasury_journal_entries
  add column if not exists platform_tenant_id uuid references platform_tenants(id),
  add column if not exists accounting_event_type text,
  add column if not exists idempotency_key text references idempotency_keys(idempotency_key),
  add column if not exists created_by_user_id uuid references app_users(id),
  add column if not exists correlation_id text;

create table if not exists posting_rules (
  event_type text primary key,
  rule_name text not null,
  status text not null,
  created_at timestamptz not null default now()
);

insert into assets (asset_code, asset_name, minor_unit_scale, status)
values ('USDC', 'USD Coin', 6, 'active')
on conflict (asset_code) do nothing;

insert into asset_rails (rail_code, asset_code, rail_name, status)
values
  ('circle_internal', 'USDC', 'Circle internal account movement', 'active'),
  ('external_usdc', 'USDC', 'External USDC blockchain movement', 'draft')
on conflict (rail_code) do nothing;

insert into roles (id, role_code, role_name)
values
  ('00000000-0000-4000-8000-000000000001', 'platform_operator', 'Platform Operator'),
  ('00000000-0000-4000-8000-000000000002', 'treasury_operator', 'Treasury Operator'),
  ('00000000-0000-4000-8000-000000000003', 'auditor', 'Auditor')
on conflict (role_code) do nothing;

insert into ledger_accounts (id, account_code, account_name, account_class, normal_balance)
values
  ('00000000-0000-4000-8000-000000010000', '10000', 'Platform Treasury USDC', 'Asset', 'debit'),
  ('00000000-0000-4000-8000-000000010020', '10020', 'Circle Business Account USDC', 'Asset', 'debit'),
  ('00000000-0000-4000-8000-000000010100', '10100', 'Escrow USDC Asset', 'Asset', 'debit'),
  ('00000000-0000-4000-8000-000000010150', '10150', 'Circle Settlement Suspense', 'Asset', 'debit'),
  ('00000000-0000-4000-8000-000000011000', '11000', 'Accepted Due Value Receivable', 'Asset', 'debit'),
  ('00000000-0000-4000-8000-000000020100', '20100', 'Supplier Advance Payable', 'Liability', 'credit'),
  ('00000000-0000-4000-8000-000000020200', '20200', 'Buyer Accepted Payable Clearing', 'Liability', 'credit'),
  ('00000000-0000-4000-8000-000000020400', '20400', 'Escrow Liability - Investor Funds', 'Liability', 'credit'),
  ('00000000-0000-4000-8000-000000040000', '40000', 'Platform Facilitation Fee Revenue', 'Revenue', 'credit'),
  ('00000000-0000-4000-8000-000000050000', '50000', 'Circle Transaction Fees Expense', 'Cost of revenue', 'debit')
on conflict (account_code) do nothing;

insert into posting_rules (event_type, rule_name, status)
values ('treasury.opening_journal.posted', 'Opening ADA journal', 'active')
on conflict (event_type) do nothing;

create or replace function reject_posted_journal_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'posted_journals_are_append_only';
end;
$$;

drop trigger if exists treasury_journal_entries_append_only_update on treasury_journal_entries;
create trigger treasury_journal_entries_append_only_update
before update on treasury_journal_entries
for each row execute function reject_posted_journal_mutation();

drop trigger if exists treasury_journal_entries_append_only_delete on treasury_journal_entries;
create trigger treasury_journal_entries_append_only_delete
before delete on treasury_journal_entries
for each row execute function reject_posted_journal_mutation();

drop trigger if exists treasury_journal_lines_append_only_update on treasury_journal_lines;
create trigger treasury_journal_lines_append_only_update
before update on treasury_journal_lines
for each row execute function reject_posted_journal_mutation();

drop trigger if exists treasury_journal_lines_append_only_delete on treasury_journal_lines;
create trigger treasury_journal_lines_append_only_delete
before delete on treasury_journal_lines
for each row execute function reject_posted_journal_mutation();
