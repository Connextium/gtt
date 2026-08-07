-- external_reference is deprecated for linked_instruments.
-- Preserve existing values by backfilling provider_reference_id before dropping.

update linked_instruments
   set provider_reference_id = external_reference
 where provider_reference_id is null
   and external_reference is not null;

alter table if exists linked_instruments
  drop column if exists external_reference;
