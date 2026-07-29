-- Sprint 3-2 uses linked_instruments as the single ADA route model.
-- Existing test data is intentionally cleaned before this migration is applied.

alter table if exists linked_instruments
  add column if not exists network_code text,
  add column if not exists is_default boolean not null default false,
  add column if not exists created_by_user_id uuid references app_users(id);

alter table if exists linked_instruments
  drop constraint if exists linked_instruments_instrument_type_check;

alter table if exists linked_instruments
  add constraint linked_instruments_instrument_type_check
  check (instrument_type in ('circle_wallet', 'external_wallet_address', 'fiat_wire_bank_account', 'on_chain_wallet', 'on_chain'));

alter table if exists linked_instruments
  drop constraint if exists linked_instruments_rail_type_check;

alter table if exists linked_instruments
  add constraint linked_instruments_rail_type_check
  check (rail_type is null or rail_type in ('on-chain', 'fiat'));

alter table if exists linked_instruments
  drop constraint if exists linked_instruments_verification_status_check;

alter table if exists linked_instruments
  add constraint linked_instruments_verification_status_check
  check (verification_status in ('draft', 'pending_verification', 'verified', 'restricted', 'disabled', 'closed'));

create unique index if not exists linked_instruments_ada_provider_reference_uidx
  on linked_instruments(platform_tenant_id, account_of_digital_asset_id, provider, provider_reference_id)
  where provider is not null and provider_reference_id is not null;

create unique index if not exists linked_instruments_ada_default_purpose_uidx
  on linked_instruments(account_of_digital_asset_id, purpose, rail_type)
  where is_default = true and status in ('active', 'verified');

alter table if exists accounts_of_digital_asset
  drop column if exists circle_account_id,
  drop column if exists circle_sub_account_id;
