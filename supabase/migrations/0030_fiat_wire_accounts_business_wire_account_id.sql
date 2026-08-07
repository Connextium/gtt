alter table public.fiat_wire_accounts
  add column if not exists business_wire_account_id text;
