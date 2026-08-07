-- provider_reference_id is deprecated for circle_api_operations.
-- Preserve legacy identifiers by moving any orphaned values into provider_account_id.
update circle_api_operations
   set provider_account_id = provider_reference_id
 where coalesce(provider_account_id, '') = ''
   and coalesce(provider_wallet_id, '') = ''
   and coalesce(provider_address_id, '') = ''
   and provider_reference_id is not null
   and provider_reference_id <> '';

alter table if exists circle_api_operations
  drop column if exists provider_reference_id;
