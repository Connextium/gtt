alter table if exists business_clients
  add column if not exists circle_wallet_set_id text;

create index if not exists business_clients_tenant_circle_wallet_set_idx
  on business_clients(platform_tenant_id, circle_wallet_set_id);
