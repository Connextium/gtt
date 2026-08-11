insert into account_of_digital_asset_balances (
  id,
  platform_tenant_id,
  account_of_digital_asset_id,
  asset_code,
  currency,
  available_minor_units,
  pending_minor_units,
  reserved_minor_units,
  locked_minor_units,
  suspense_minor_units
)
select
  gen_random_uuid(),
  instruction.platform_tenant_id,
  instruction.destination_account_of_digital_asset_id,
  'USDC',
  'USD',
  sum(coalesce(instruction.available_usdc_minor_units, 0::numeric)),
  sum(coalesce(instruction.pending_usdc_minor_units, 0::numeric)),
  0,
  0,
  0
from wire_funding_instructions instruction
where instruction.instruction_role = 'client_exchange'
  and instruction.destination_account_of_digital_asset_id is not null
  and not exists (
    select 1
    from account_of_digital_asset_balances balance
    where balance.account_of_digital_asset_id = instruction.destination_account_of_digital_asset_id
      and balance.asset_code = 'USDC'
      and balance.currency = 'USD'
  )
group by
  instruction.platform_tenant_id,
  instruction.destination_account_of_digital_asset_id
having
  sum(coalesce(instruction.available_usdc_minor_units, 0::numeric)) > 0
  or sum(coalesce(instruction.pending_usdc_minor_units, 0::numeric)) > 0
on conflict (account_of_digital_asset_id, asset_code, currency) do nothing;