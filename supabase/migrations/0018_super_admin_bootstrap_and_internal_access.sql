do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'roles_role_code_check'
  ) then
    alter table roles drop constraint roles_role_code_check;
  end if;
end;
$$;

alter table roles
  add constraint roles_role_code_check
  check (role_code in ('business_user', 'super_admin', 'platform_admin', 'platform_operator', 'treasury_operator', 'auditor'));

insert into roles (id, role_code, role_name)
values ('00000000-0000-4000-8000-000000000006', 'super_admin', 'Super Admin')
on conflict (role_code) do update set role_name = excluded.role_name;

create table if not exists internal_access_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references app_users(id) on delete cascade,
  invitation_id uuid references internal_user_invitations(id) on delete cascade,
  email text,
  setup_token_hash text,
  password_hash text,
  initialized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists internal_access_secrets
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists invitation_id uuid references internal_user_invitations(id) on delete cascade,
  add column if not exists email text;

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    where tc.table_name = 'internal_access_secrets'
      and tc.constraint_type = 'PRIMARY KEY'
      and kcu.column_name = 'user_id'
  ) then
    alter table internal_access_secrets drop constraint internal_access_secrets_pkey;
  end if;

  update internal_access_secrets set id = gen_random_uuid() where id is null;
  alter table internal_access_secrets alter column id set not null;

  if not exists (
    select 1
    from information_schema.table_constraints
    where table_name = 'internal_access_secrets'
      and constraint_type = 'PRIMARY KEY'
  ) then
    alter table internal_access_secrets add constraint internal_access_secrets_pkey primary key (id);
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_name = 'internal_access_secrets'
      and column_name = 'user_id'
      and is_nullable = 'NO'
  ) then
    alter table internal_access_secrets alter column user_id drop not null;
  end if;
end;
$$;

create unique index if not exists internal_access_secrets_user_uidx
  on internal_access_secrets(user_id)
  where user_id is not null;

create unique index if not exists internal_access_secrets_invitation_uidx
  on internal_access_secrets(invitation_id)
  where invitation_id is not null;
