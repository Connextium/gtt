-- Durable business auth sessions for first-party access/refresh token exchange.

create table if not exists business_auth_sessions (
  session_id uuid primary key,
  auth_user_id text not null,
  email text not null,
  access_jti uuid not null unique,
  access_expires_at timestamptz not null,
  refresh_jti uuid not null unique,
  refresh_expires_at timestamptz not null,
  supabase_access_token text not null,
  supabase_refresh_token text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_auth_sessions_access_jti_idx
  on business_auth_sessions (access_jti)
  where revoked_at is null;

create index if not exists business_auth_sessions_refresh_jti_idx
  on business_auth_sessions (refresh_jti)
  where revoked_at is null;

create index if not exists business_auth_sessions_auth_user_idx
  on business_auth_sessions (auth_user_id, created_at desc);

create index if not exists business_auth_sessions_active_expiry_idx
  on business_auth_sessions (access_expires_at, refresh_expires_at)
  where revoked_at is null;
