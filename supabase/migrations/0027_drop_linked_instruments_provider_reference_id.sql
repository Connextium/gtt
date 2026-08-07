-- provider_reference_id is deprecated for linked_instruments.
-- Preserve existing values by backfilling metadata.reference and metadata.walletId before dropping.

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'linked_instruments'
       and column_name = 'provider_reference_id'
  ) then
    update linked_instruments
       set metadata = jsonb_set(
         jsonb_set(coalesce(metadata, '{}'::jsonb), '{reference}', to_jsonb(provider_reference_id), true),
         '{walletId}',
         to_jsonb(provider_reference_id),
         true
       )
     where provider_reference_id is not null
       and provider_reference_id <> ''
       and (
         coalesce(metadata->>'reference', '') = ''
         or coalesce(metadata->>'walletId', '') = ''
       );
  end if;
end $$;

drop index if exists linked_instruments_provider_reference_uidx;
drop index if exists linked_instruments_ada_provider_reference_uidx;

alter table if exists linked_instruments
  drop column if exists provider_reference_id;
