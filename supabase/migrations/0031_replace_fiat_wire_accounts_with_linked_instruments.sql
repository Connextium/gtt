-- Replace legacy fiat_wire_accounts usage with linked_instruments-backed fiat rails.

alter table if exists redemption_instructions
  add column if not exists linked_instrument_id uuid;

insert into asset_rails (rail_code, asset_code, rail_name, status)
select distinct
  lower('fiat_wire_' || fwa.routing_number || '_' || fwa.account_number_last4) as rail_code,
  'USDC' as asset_code,
  fwa.bank_name as rail_name,
  'active' as status
from fiat_wire_accounts fwa
on conflict (rail_code) do update
  set rail_name = excluded.rail_name,
      status = excluded.status;

-- Transient CTE for one-shot backfill from legacy fiat wire rows.
with legacy_wire_accounts_cte as (
  select
    fwa.id as linked_instrument_id,
    fwa.platform_tenant_id,
    coalesce(
      (
        select ri.source_account_of_digital_asset_id
        from redemption_instructions ri
        where ri.fiat_wire_account_id = fwa.id
        order by ri.created_at desc
        limit 1
      ),
      (
        select ada.id
        from accounts_of_digital_asset ada
        where ada.platform_tenant_id = fwa.platform_tenant_id
          and ada.business_client_id = fwa.business_client_id
          and ada.status in ('pending_activation', 'active')
        order by case when ada.use_purpose = 'tenant_central' then 0 else 1 end,
                 ada.created_at desc
        limit 1
      )
    ) as account_of_digital_asset_id,
    fwa.bank_name,
    fwa.account_number_last4,
    fwa.routing_number,
    fwa.business_wire_account_id,
    fwa.status,
    fwa.created_at
  from fiat_wire_accounts fwa
)
insert into linked_instruments
  (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, currency, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
select
  legacy.linked_instrument_id,
  legacy.account_of_digital_asset_id,
  legacy.platform_tenant_id,
  'fiat_wire_bank_account' as instrument_type,
  legacy.status,
  'USDC' as asset_code,
  'USD' as currency,
  'fiat' as rail_type,
  'minting' as purpose,
  'bank' as provider,
  'verified' as verification_status,
  jsonb_strip_nulls(
    jsonb_build_object(
      'bankName', legacy.bank_name,
      'accountNumberLast4', legacy.account_number_last4,
      'routingNumber', legacy.routing_number,
      'businessWireAccountId', legacy.business_wire_account_id,
      'migratedFrom', 'fiat_wire_accounts'
    )
  ) as metadata,
  lower('fiat_wire_' || legacy.routing_number || '_' || legacy.account_number_last4) as network_code,
  false as is_default,
  legacy.created_at,
  now() as updated_at
from legacy_wire_accounts_cte legacy
where legacy.account_of_digital_asset_id is not null
on conflict (id) do update
  set account_of_digital_asset_id = excluded.account_of_digital_asset_id,
      platform_tenant_id = excluded.platform_tenant_id,
      status = excluded.status,
      metadata = excluded.metadata,
      network_code = excluded.network_code,
      updated_at = now();

insert into linked_instruments
  (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, currency, rail_type, purpose, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
select distinct
  ri.fiat_wire_account_id as id,
  ri.source_account_of_digital_asset_id as account_of_digital_asset_id,
  ri.platform_tenant_id,
  'fiat_wire_bank_account' as instrument_type,
  'active' as status,
  'USDC' as asset_code,
  'USD' as currency,
  'fiat' as rail_type,
  'minting' as purpose,
  'bank' as provider,
  'verified' as verification_status,
  jsonb_build_object('migratedFrom', 'redemption_instructions') as metadata,
  null as network_code,
  false as is_default,
  now() as created_at,
  now() as updated_at
from redemption_instructions ri
left join linked_instruments linked
  on linked.id = ri.fiat_wire_account_id
where linked.id is null;

update redemption_instructions ri
   set linked_instrument_id = ri.fiat_wire_account_id
 where ri.linked_instrument_id is null;

alter table if exists redemption_instructions
  drop constraint if exists redemption_instructions_linked_instrument_id_fkey;

alter table if exists redemption_instructions
  add constraint redemption_instructions_linked_instrument_id_fkey
  foreign key (linked_instrument_id) references linked_instruments(id);

alter table if exists redemption_instructions
  alter column linked_instrument_id set not null;

alter table if exists redemption_instructions
  drop constraint if exists redemption_instructions_fiat_wire_account_id_fkey,
  drop column if exists fiat_wire_account_id;

drop table if exists fiat_wire_accounts;
