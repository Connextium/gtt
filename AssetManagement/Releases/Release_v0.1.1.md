# Release v0.1.1

Date: 2026-07-28

## Summary

Sprint 2 and Sprint 3 execution release covering business client onboarding evidence, internal operations UI support, ADA lifecycle controls, linked instruments, Circle mapping evidence, treasury operations screens, and direct database persistence hardening.

## Included

- Business client onboarding queue, application review, approval success, RFI creation, and business-client RFI response flows.
- Database-backed onboarding review actions, RFI tasks, onboarding status events, and Circle KYB evidence.
- Internal operations command centre, user management, API key management, audit event monitoring, and internal route cleanup.
- Accounts of Digital Asset management, ADA provisioning, ADA detail, linked instruments, link rail, and success flows.
- ADA lifecycle statuses and controls for pending activation, activation, restriction, unrestriction, freeze, unfreeze, and close.
- Circle Managed rail display, Circle mapping/provisioning evidence, and ADA activation gates.
- Treasury/accounting UI support for chart of accounts, active ledgers, ledger registration, posting rules, and opening journal.
- Direct database unit-of-work coverage for domain writes, audit, outbox, idempotency, onboarding, ADA lifecycle, linked instruments, and provider mapping evidence.
- Supabase migrations through `0022_sprint3_ada_lifecycle_circle_mapping.sql`.

## Verification

- `npm test` in `apps/api`: 68/68 passing.
- `npm run check` in `apps/api`: passing.
- `npm run check` in `apps/web`: passing.
- `npm run build` in `apps/web`: passing.

## Notes

- `circle_internal` remains the persisted rail value for compatibility; the UI displays it as `Circle Managed`.
- `CIRCLE_ENVIRONMENT=simulator` remains the default local mode. Real Circle sandbox/production requires Circle API credentials and real webhook signature handling.
- The web build still reports the existing Vite chunk-size warning.
