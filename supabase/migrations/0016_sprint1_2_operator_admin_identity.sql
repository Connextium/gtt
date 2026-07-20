create table if not exists app_users (
  id uuid primary key,
  auth_user_id uuid,
  platform_tenant_id uuid not null references platform_tenants(id),
  email text not null,
  display_name text not null,
  user_type text not null default 'internal_user',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform_tenant_id, email)
);

alter table if exists app_users
  add column if not exists auth_user_id uuid,
  add column if not exists user_type text not null default 'internal_user',
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists app_users_auth_user_id_uidx on app_users(auth_user_id) where auth_user_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_user_type_check'
  ) then
    alter table app_users
      add constraint app_users_user_type_check
      check (user_type in ('business_user', 'internal_user'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'app_users_status_check'
  ) then
    alter table app_users
      add constraint app_users_status_check
      check (status in ('invited', 'active', 'disabled'));
  end if;
end;
$$;

create table if not exists roles (
  id uuid primary key,
  role_code text not null unique,
  role_name text not null
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roles_role_code_check'
  ) then
    alter table roles
      add constraint roles_role_code_check
      check (role_code in ('business_user', 'platform_admin', 'platform_operator', 'treasury_operator', 'auditor'));
  end if;
end;
$$;

create table if not exists user_role_assignments (
  user_id uuid not null references app_users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  assigned_by_user_id uuid references app_users(id),
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

alter table if exists user_role_assignments
  add column if not exists assigned_by_user_id uuid references app_users(id);

create table if not exists internal_user_invitations (
  id uuid primary key default gen_random_uuid(),
  platform_tenant_id uuid not null references platform_tenants(id),
  email text not null,
  display_name text not null,
  role_code text not null references roles(role_code),
  status text not null check (status in ('requested', 'sent', 'accepted', 'expired', 'cancelled')),
  supabase_user_id uuid,
  idempotency_key text not null unique,
  invited_by_user_id uuid references app_users(id),
  invited_at timestamptz,
  accepted_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint internal_user_invitations_internal_role check (role_code <> 'business_user')
);

insert into roles (id, role_code, role_name)
values
  ('00000000-0000-4000-8000-000000000004', 'business_user', 'Business User'),
  ('00000000-0000-4000-8000-000000000005', 'platform_admin', 'Platform Admin'),
  ('00000000-0000-4000-8000-000000000001', 'platform_operator', 'Platform Operator'),
  ('00000000-0000-4000-8000-000000000002', 'treasury_operator', 'Treasury Operator'),
  ('00000000-0000-4000-8000-000000000003', 'auditor', 'Auditor')
on conflict (role_code) do update set role_name = excluded.role_name;

create index if not exists app_users_tenant_status_idx on app_users(platform_tenant_id, status);
create index if not exists app_users_tenant_user_type_idx on app_users(platform_tenant_id, user_type);
create index if not exists internal_user_invitations_tenant_status_idx on internal_user_invitations(platform_tenant_id, status);
