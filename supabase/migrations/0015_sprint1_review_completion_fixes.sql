alter table if exists posting_rules
  add column if not exists debit_ledger_account_code text references ledger_accounts(account_code),
  add column if not exists credit_ledger_account_code text references ledger_accounts(account_code);

insert into ledger_accounts (id, account_code, account_name, account_class, normal_balance)
values
  ('00000000-0000-4000-8000-000000020430', '20430', 'Customer ADA Liability - Available', 'Liability', 'credit'),
  ('00000000-0000-4000-8000-000000020440', '20440', 'Customer ADA Liability - Reserved', 'Liability', 'credit')
on conflict (account_code) do nothing;

update posting_rules
set
  debit_ledger_account_code = '10020',
  credit_ledger_account_code = '20400'
where event_type = 'treasury.opening_journal.posted';

update posting_rules
set
  debit_ledger_account_code = coalesce(debit_ledger_account_code, '10020'),
  credit_ledger_account_code = coalesce(credit_ledger_account_code, '20400')
where status = 'active'
  and (debit_ledger_account_code is null or credit_ledger_account_code is null);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'posting_rules_active_accounts_required'
  ) then
    alter table posting_rules
      add constraint posting_rules_active_accounts_required
      check (
        status <> 'active'
        or (debit_ledger_account_code is not null and credit_ledger_account_code is not null)
      );
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'business_clients_onboarding_status_check'
  ) then
    alter table business_clients
      add constraint business_clients_onboarding_status_check
      check (onboarding_status in ('draft', 'submitted', 'approved', 'restricted', 'closed'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'accounts_of_digital_asset_status_check'
  ) then
    alter table accounts_of_digital_asset
      add constraint accounts_of_digital_asset_status_check
      check (status in ('draft', 'active', 'restricted', 'closed'));
  end if;
end;
$$;
