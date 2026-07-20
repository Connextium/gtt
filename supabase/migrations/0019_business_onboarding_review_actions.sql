do $$
declare
  constraint_name text;
begin
  select conname
  into constraint_name
  from pg_constraint
  where conrelid = 'public.business_onboarding_applications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%';

  if constraint_name is not null then
    execute format('alter table public.business_onboarding_applications drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.business_onboarding_applications
  add constraint business_onboarding_applications_status_check
  check (status in ('draft', 'submitted', 'pending_review', 'needs_information', 'approved', 'rejected'));

create table if not exists public.business_onboarding_review_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_demo',
  application_id uuid not null references public.business_onboarding_applications(id) on delete cascade,
  action text not null check (action in ('approved', 'rejected', 'requested_information')),
  note text,
  requested_fields text[] not null default '{}',
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists idx_business_onboarding_review_actions_application
  on public.business_onboarding_review_actions (application_id, created_at desc);
