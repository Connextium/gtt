create table if not exists settlement_advance_transfers (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  circle_transfer_id text,
  circle_credit_line_id text,
  fiat_account_id uuid,
  reserve_amount_minor_units numeric(38, 0) not null,
  currency text not null default 'USD',
  status text not null,
  expires_at timestamptz,
  requested_at timestamptz,
  disbursed_at timestamptz,
  due_date date,
  outstanding_minor_units numeric(38, 0) not null default 0,
  fees_total_minor_units numeric(38, 0) not null default 0,
  fees_unpaid_minor_units numeric(38, 0) not null default 0,
  repayment_status text not null default 'not_due',
  provider_payload_json jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint settlement_advance_reserve_positive check (reserve_amount_minor_units > 0),
  constraint settlement_advance_outstanding_nonnegative check (outstanding_minor_units >= 0),
  constraint settlement_advance_fee_totals_nonnegative check (fees_total_minor_units >= 0 and fees_unpaid_minor_units >= 0)
);

create index if not exists idx_settlement_advance_transfers_tenant_status
  on settlement_advance_transfers(platform_tenant_id, status, created_at desc);

create index if not exists idx_settlement_advance_transfers_circle_transfer
  on settlement_advance_transfers(circle_transfer_id)
  where circle_transfer_id is not null;

create table if not exists settlement_advance_wire_proofs (
  id uuid primary key,
  settlement_advance_transfer_id uuid not null references settlement_advance_transfers(id),
  file_name text not null,
  mime_type text,
  storage_path text,
  checksum text,
  uploaded_by uuid references app_users(id),
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_settlement_advance_wire_proofs_transfer
  on settlement_advance_wire_proofs(settlement_advance_transfer_id, uploaded_at desc);

create table if not exists tenant_disbursements (
  id uuid primary key,
  platform_tenant_id uuid not null references platform_tenants(id),
  business_client_id uuid not null references business_clients(id),
  source_platform_wallet_id text,
  destination_ada_wallet_id text,
  destination_ada_id uuid references accounts_of_digital_asset(id),
  amount_minor_units numeric(38, 0) not null,
  currency text not null default 'USDC',
  status text not null,
  settlement_advance_transfer_id uuid references settlement_advance_transfers(id),
  reason_code text,
  idempotency_key text,
  provider_transfer_id text,
  provider_payload_json jsonb not null default '{}'::jsonb,
  created_by uuid references app_users(id),
  approved_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_disbursement_amount_positive check (amount_minor_units > 0)
);

create index if not exists idx_tenant_disbursements_tenant_status
  on tenant_disbursements(platform_tenant_id, status, created_at desc);

create index if not exists idx_tenant_disbursements_business_client
  on tenant_disbursements(business_client_id, created_at desc);

create index if not exists idx_tenant_disbursements_settlement_advance
  on tenant_disbursements(settlement_advance_transfer_id)
  where settlement_advance_transfer_id is not null;

alter table if exists reconciliation_breaks
  add column if not exists settlement_advance_transfer_id uuid references settlement_advance_transfers(id),
  add column if not exists tenant_disbursement_id uuid references tenant_disbursements(id);

alter table if exists suspense_cases
  add column if not exists settlement_advance_transfer_id uuid references settlement_advance_transfers(id),
  add column if not exists tenant_disbursement_id uuid references tenant_disbursements(id);

create index if not exists idx_reconciliation_breaks_settlement_advance
  on reconciliation_breaks(settlement_advance_transfer_id)
  where settlement_advance_transfer_id is not null;

create index if not exists idx_reconciliation_breaks_tenant_disbursement
  on reconciliation_breaks(tenant_disbursement_id)
  where tenant_disbursement_id is not null;

create index if not exists idx_suspense_cases_settlement_advance
  on suspense_cases(settlement_advance_transfer_id)
  where settlement_advance_transfer_id is not null;

create index if not exists idx_suspense_cases_tenant_disbursement
  on suspense_cases(tenant_disbursement_id)
  where tenant_disbursement_id is not null;
