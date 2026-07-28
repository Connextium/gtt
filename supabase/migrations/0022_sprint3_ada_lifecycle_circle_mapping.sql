alter table if exists accounts_of_digital_asset
  drop constraint if exists accounts_of_digital_asset_status_check;

alter table if exists accounts_of_digital_asset
  add constraint accounts_of_digital_asset_status_check
  check (status in ('draft', 'pending_activation', 'active', 'restricted', 'frozen', 'closed'));

alter table if exists linked_instruments
  add column if not exists platform_tenant_id uuid references platform_tenants(id),
  add column if not exists asset_code text not null default 'USDC',
  add column if not exists currency text not null default 'USD',
  add column if not exists rail_type text,
  add column if not exists purpose text,
  add column if not exists provider text,
  add column if not exists provider_reference_id text,
  add column if not exists verification_status text not null default 'verified',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

update linked_instruments linked
   set platform_tenant_id = account.platform_tenant_id
  from accounts_of_digital_asset account
 where linked.account_of_digital_asset_id = account.id
   and linked.platform_tenant_id is null;

alter table if exists circle_api_operations
  add column if not exists account_of_digital_asset_id uuid references accounts_of_digital_asset(id),
  add column if not exists linked_instrument_id uuid references linked_instruments(id),
  add column if not exists provider_wallet_id text,
  add column if not exists provider_account_id text,
  add column if not exists provider_address_id text;

create index if not exists linked_instruments_account_status_idx
  on linked_instruments(account_of_digital_asset_id, status, verification_status, created_at desc);

create unique index if not exists linked_instruments_provider_reference_uidx
  on linked_instruments(platform_tenant_id, provider, provider_reference_id)
  where provider is not null and provider_reference_id is not null;

create index if not exists circle_api_operations_ada_idx
  on circle_api_operations(platform_tenant_id, account_of_digital_asset_id, created_at desc);

create unique index if not exists circle_api_operations_ada_idempotency_uidx
  on circle_api_operations(platform_tenant_id, account_of_digital_asset_id, operation_type, idempotency_key)
  where account_of_digital_asset_id is not null and idempotency_key is not null;
