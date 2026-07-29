# Release v0.1.4

Date: 2026-07-29

## Summary

Feature and stability release for GTT API/Web and Circle integration workflows.

## Included

- Circle integration expansion with tenant activation, sandbox diagnostics, and wallet-set provisioning support.
- ADA linked-instrument model enhancements and Circle wallet mapping behavior updates.
- Internal UI updates for tenant activation, API management, ADA lifecycle, and ledger operation views.
- Authentication/onboarding reliability fix for timestamp normalization and login routing fallback behavior.
- Additional direct-database migrations and runtime/test coverage updates for new Sprint 3.2 capabilities.

## Verification

- `npm run check` in `apps/api`.
- `npm run build` in `apps/web`.
- Targeted API/web route and module test updates included in this release.

## Notes

- Release tag: `v0.1.4`.
- Existing chunk-size warning behavior in web build remains unchanged.
