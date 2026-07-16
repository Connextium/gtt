do $$
declare
  constraint_name text;
begin
  select conname
    into constraint_name
  from pg_constraint
  where conrelid = 'public.business_onboarding_applications'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%current_step%';

  if constraint_name is not null then
    execute format('alter table public.business_onboarding_applications drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.business_onboarding_applications
  add constraint business_onboarding_applications_current_step_check
  check (current_step in ('step_1', 'step_2', 'step_3', 'step_4', 'pending_review', 'reviewd'));
