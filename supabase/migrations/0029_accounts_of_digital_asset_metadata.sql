alter table if exists accounts_of_digital_asset
  add column if not exists metadata jsonb not null default '{}'::jsonb;
