-- Enable business-first linked instrument registration (unassigned before ADA binding).

alter table if exists linked_instruments
  add column if not exists business_client_id uuid references business_clients(id);

update linked_instruments linked
   set business_client_id = account.business_client_id
  from accounts_of_digital_asset account
 where linked.account_of_digital_asset_id = account.id
   and linked.business_client_id is null;

alter table if exists linked_instruments
  alter column business_client_id set not null;

alter table if exists linked_instruments
  alter column account_of_digital_asset_id drop not null;

drop index if exists linked_instruments_ada_default_purpose_uidx;

create unique index if not exists linked_instruments_ada_default_purpose_uidx
  on linked_instruments(account_of_digital_asset_id, purpose, rail_type)
  where account_of_digital_asset_id is not null
    and is_default = true
    and status in ('active', 'verified');

create index if not exists linked_instruments_tenant_business_idx
  on linked_instruments(platform_tenant_id, business_client_id, created_at desc);

create index if not exists linked_instruments_tenant_business_unassigned_idx
  on linked_instruments(platform_tenant_id, business_client_id, created_at desc)
  where account_of_digital_asset_id is null;
