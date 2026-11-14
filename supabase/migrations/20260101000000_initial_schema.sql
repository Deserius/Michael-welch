-- =============================================================================
-- Da RoastBox! — initial schema
-- =============================================================================
-- Reconstructed from the queries in /api/*.js (V4 had no migrations at all).
--
-- Security model
-- --------------
-- Every table has RLS enabled. Users may read their OWN rows via the anon key,
-- but they can NEVER write credits/payments/roasts directly -- all writes go
-- through the Vercel API using the service-role key, which bypasses RLS.
-- That keeps the credit ledger and Stripe reconciliation server-authoritative.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user. The source of truth for the credit balance.
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null unique references auth.users (id) on delete cascade,
  email             text,
  credits           integer not null default 10 check (credits >= 0),
  subscription_tier text check (
                      subscription_tier is null
                      or subscription_tier in ('premium_personas', 'premium_voices', 'all_access')
                    ),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);

-- -----------------------------------------------------------------------------
-- credit_transactions: append-only audit ledger of every credit movement.
-- -----------------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  amount      integer not null,
  type        text not null check (type in ('starter', 'roast', 'purchase', 'subscription', 'refund', 'bonus', 'adjustment')),
  description text,
  created_at  timestamptz not null default now()
);

create index if not exists credit_transactions_user_created_idx
  on public.credit_transactions (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- roasts: saved roast sessions (the history page).
-- -----------------------------------------------------------------------------
create table if not exists public.roasts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  subject_name text,
  persona_ids  text[] not null default '{}',
  transcript   jsonb not null default '[]'::jsonb,
  duration_min integer,
  created_at   timestamptz not null default now()
);

create index if not exists roasts_user_created_idx
  on public.roasts (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- payment_transactions: one row per checkout attempt, reconciled by webhook.
-- -----------------------------------------------------------------------------
create table if not exists public.payment_transactions (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  pack_id           text,
  amount_usd        numeric(10, 2) not null default 0,
  credits           integer not null default 0,
  payment_status    text not null default 'pending'
                      check (payment_status in ('pending', 'paid', 'failed', 'refunded', 'canceled')),
  stripe_session_id text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists payment_transactions_user_idx
  on public.payment_transactions (user_id, created_at desc);

-- A Stripe session must map to at most one payment row, otherwise a webhook
-- replay can double-grant credits.
create unique index if not exists payment_transactions_stripe_session_uidx
  on public.payment_transactions (stripe_session_id)
  where stripe_session_id is not null;

-- -----------------------------------------------------------------------------
-- byok_keys: per-user "bring your own key" overrides.
-- -----------------------------------------------------------------------------
create table if not exists public.byok_keys (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  openai_key     text,
  elevenlabs_key text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- global_settings: singleton row (id = 1) holding app-wide API keys.
-- Only the service role may touch this table (see RLS below) -- previously any
-- authenticated user could overwrite the owner's OpenAI/ElevenLabs keys.
-- -----------------------------------------------------------------------------
create table if not exists public.global_settings (
  id             integer primary key default 1 check (id = 1),
  openai_key     text,
  elevenlabs_key text,
  updated_by     uuid references auth.users (id) on delete set null,
  updated_at     timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists payment_transactions_touch_updated_at on public.payment_transactions;
create trigger payment_transactions_touch_updated_at
  before update on public.payment_transactions
  for each row execute function public.touch_updated_at();

drop trigger if exists byok_keys_touch_updated_at on public.byok_keys;
create trigger byok_keys_touch_updated_at
  before update on public.byok_keys
  for each row execute function public.touch_updated_at();

drop trigger if exists global_settings_touch_updated_at on public.global_settings;
create trigger global_settings_touch_updated_at
  before update on public.global_settings
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles             enable row level security;
alter table public.credit_transactions  enable row level security;
alter table public.roasts               enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.byok_keys            enable row level security;
alter table public.global_settings      enable row level security;

-- profiles: read own row only. All writes are service-role only.
drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = user_id);

-- credit_transactions: read own ledger only.
drop policy if exists "credit_transactions: read own" on public.credit_transactions;
create policy "credit_transactions: read own"
  on public.credit_transactions for select
  to authenticated
  using (auth.uid() = user_id);

-- roasts: read own history only.
drop policy if exists "roasts: read own" on public.roasts;
create policy "roasts: read own"
  on public.roasts for select
  to authenticated
  using (auth.uid() = user_id);

-- payment_transactions: read own receipts only.
drop policy if exists "payment_transactions: read own" on public.payment_transactions;
create policy "payment_transactions: read own"
  on public.payment_transactions for select
  to authenticated
  using (auth.uid() = user_id);

-- byok_keys: never readable through the anon/authenticated key. The API only
-- ever returns booleans ("has_byok_openai"), so no policy at all is the safest.
drop policy if exists "byok_keys: read own" on public.byok_keys;

-- global_settings: service role only. No policies => no client access.

-- =============================================================================
-- Privileges: revoke default write grants so RLS isn't the only guard.
-- =============================================================================
revoke insert, update, delete on public.profiles             from anon, authenticated;
revoke insert, update, delete on public.credit_transactions  from anon, authenticated;
revoke insert, update, delete on public.roasts               from anon, authenticated;
revoke insert, update, delete on public.payment_transactions from anon, authenticated;
revoke insert, update, delete on public.byok_keys            from anon, authenticated;
revoke all    on public.global_settings                      from anon, authenticated;
