alter table if exists digital_asset_accounts
  rename to accounts_of_digital_asset;

alter table if exists treasury_journal_lines
  rename column digital_asset_account_id to account_of_digital_asset_id;
