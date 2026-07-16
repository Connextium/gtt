create extension if not exists pgcrypto;

create table if not exists business_onboarding_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_demo',
  email text not null,
  status text not null check (status in ('requested', 'sent', 'accepted', 'expired', 'cancelled')),
  supabase_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text not null,
  invited_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_business_onboarding_invitations_active_email
  on business_onboarding_invitations (tenant_id, lower(email))
  where status in ('requested', 'sent', 'accepted');

create table if not exists business_user_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_demo',
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'business_user' check (role in ('business_user')),
  status text not null default 'active' check (status in ('invited', 'active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_onboarding_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_demo',
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  current_step text not null default 'step_1' check (current_step in ('step_1', 'step_2', 'step_3', 'step_4', 'pending_review', 'reviewd')),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'pending_review', 'approved', 'rejected')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists onboarding_step_payloads (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_demo',
  application_id uuid not null references business_onboarding_applications(id) on delete cascade,
  step_key text not null,
  payload jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  unique (application_id, step_key)
);

alter table business_onboarding_invitations enable row level security;
alter table business_user_profiles enable row level security;
alter table business_onboarding_applications enable row level security;
alter table onboarding_step_payloads enable row level security;

drop policy if exists "business users read own profile" on business_user_profiles;
create policy "business users read own profile"
  on business_user_profiles
  for select
  using (auth_user_id = auth.uid());

drop policy if exists "business users update own profile" on business_user_profiles;
create policy "business users update own profile"
  on business_user_profiles
  for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "business users read own onboarding application" on business_onboarding_applications;
create policy "business users read own onboarding application"
  on business_onboarding_applications
  for select
  using (auth_user_id = auth.uid());

drop policy if exists "business users update own onboarding application" on business_onboarding_applications;
create policy "business users update own onboarding application"
  on business_onboarding_applications
  for update
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

drop policy if exists "business users read own onboarding step payloads" on onboarding_step_payloads;
create policy "business users read own onboarding step payloads"
  on onboarding_step_payloads
  for select
  using (
    exists (
      select 1
      from business_onboarding_applications applications
      where applications.id = onboarding_step_payloads.application_id
        and applications.auth_user_id = auth.uid()
    )
  );

drop policy if exists "business users manage own onboarding step payloads" on onboarding_step_payloads;
create policy "business users manage own onboarding step payloads"
  on onboarding_step_payloads
  for all
  using (
    exists (
      select 1
      from business_onboarding_applications applications
      where applications.id = onboarding_step_payloads.application_id
        and applications.auth_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from business_onboarding_applications applications
      where applications.id = onboarding_step_payloads.application_id
        and applications.auth_user_id = auth.uid()
    )
  );
