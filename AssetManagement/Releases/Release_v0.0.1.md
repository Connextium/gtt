# Release v0.0.1

Date: 2026-07-20

## Summary

Initial GTT product foundation release covering Sprint 1 product/data model completion, internal operations administration, business user onboarding, API key management, and business client review approval workflows.

## Included

- Business user self-registration, login, onboarding draft resume, submission, pending review, and approved welcome states.
- Internal operation/admin identity flows, bootstrap super admin provisioning, internal initialization, login, protected internal routes, and command center.
- Internal user management, user provisioning, invitation resend, user detail update, and logout profile menu.
- API key management and new API key creation under the internal shell.
- Direct database support with `DATABASE_URL` / `SUPABASE_DB_URL` precedence over snapshot-backed state.
- Database-backed API key listing, internal identity listing, and onboarding/business client persistence.
- Business client onboarding review queue and detail view with approve, reject, and request-for-information actions.
- Supabase migrations through `0019_business_onboarding_review_actions.sql`.
- API and web test/build coverage for the release scope.

## Verification

- `npm run check --workspace @gtt/api`
- `npm run test --workspace @gtt/api`
- `npm run build --workspace @gtt/api`
- `npm run check --workspace @gtt/web`
- `npm run build --workspace @gtt/web`

## Notes

- Supabase migration `0019_business_onboarding_review_actions.sql` is required for persisted business onboarding review action history.
- The web build still reports the existing Vite chunk-size warning.
