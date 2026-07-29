# Release v0.1.2

Date: 2026-07-29

## Summary

Patch release focused on authentication flow reliability and onboarding timestamp normalization.

## Included

- Fixed onboarding timestamp normalization for database-hydrated records to ensure persisted values remain ISO-8601 compatible.
- Resolved reset-password follow-up failure caused by Postgres parsing issues with `GMT-0700` style timezone strings.
- Hardened sign-in navigation to reliably route authenticated users to the correct landing path when session/onboarding lookup timing is delayed.
- Added graceful route fallback to `/welcome` when onboarding route resolution is temporarily unavailable.

## Verification

- `npm run check` in `apps/api`: passing.
- `npm run build` in `apps/web`: passing.

## Notes

- This release is backward compatible and contains no schema changes.
- Existing Vite chunk-size warnings remain unchanged.
