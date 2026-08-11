alter table wire_funding_instructions
  add column if not exists wire_confirmed_webhook_event_id uuid references provider_webhook_events(id),
  add column if not exists usdc_confirmed_webhook_event_id uuid references provider_webhook_events(id),
  add column if not exists posting_journal_entry_id uuid references treasury_journal_entries(id);

alter table funding_instruction_orders
  add column if not exists completed_webhook_event_id uuid references provider_webhook_events(id),
  add column if not exists journal_entry_id uuid references treasury_journal_entries(id);

create unique index if not exists idx_funding_instruction_orders_unique_stage
  on funding_instruction_orders(platform_tenant_id, funding_instruction_id, order_kind);

create unique index if not exists idx_wire_funding_instructions_wire_webhook
  on wire_funding_instructions(platform_tenant_id, wire_confirmed_webhook_event_id)
  where wire_confirmed_webhook_event_id is not null;

create unique index if not exists idx_wire_funding_instructions_usdc_webhook
  on wire_funding_instructions(platform_tenant_id, usdc_confirmed_webhook_event_id)
  where usdc_confirmed_webhook_event_id is not null;

create unique index if not exists idx_wire_funding_instructions_posting_journal
  on wire_funding_instructions(platform_tenant_id, posting_journal_entry_id)
  where posting_journal_entry_id is not null;