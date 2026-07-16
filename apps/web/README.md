# Web App

Operations Console UI for Global Trade Treasury.

## Commands

```bash
npm run dev --workspace @gtt/web
npm run build --workspace @gtt/web
npm run preview --workspace @gtt/web
npm run check --workspace @gtt/web
```

From the repo root:

```bash
npm run web:dev
npm run web:build
npm run web:preview
```

The current UI uses typed local mock data for operations views and API-backed Sprint 0 self-registration for business user onboarding.

## Sprint 0 Self-Registration

The business user onboarding flow starts at `/register`.

Required browser environment variables:

```bash
VITE_API_BASE_URL=http://localhost:4000
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

Flow:

1. `/register` submits email only to `apps/api`.
2. `apps/api` sends Supabase Auth invitation email.
3. Invitation link redirects to `/auth/set-password`.
4. Password is set through Supabase Auth.
5. Web calls `GET /onboarding/me` to create or resume the onboarding draft.
6. User continues to `/onboarding/step-1`.
7. Step 4 submission calls `POST /onboarding/me/submit` and redirects to `/pending`.
