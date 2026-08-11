insert into ledger_accounts (id, account_code, account_name, account_class, normal_balance)
values
  ('00000000-0000-4000-8000-000000010010', '10010', 'Circle Business Account USD Cash', 'Asset', 'debit'),
  ('00000000-0000-4000-8000-000000020500', '20500', 'Customer ADA Liability - Pending Fiat-to-USDC Conversion', 'Liability', 'credit')
on conflict (account_code) do update
set account_name = excluded.account_name,
    account_class = excluded.account_class,
    normal_balance = excluded.normal_balance;