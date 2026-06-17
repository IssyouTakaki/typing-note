-- Account security support tables for TypingNote.
--
-- Review this migration against the live Supabase project before applying it.
-- It intentionally contains no secrets.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.account_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  normalized_email text generated always as (lower(btrim(email))) stored,
  is_verified boolean not null default false,
  use_for_2fa boolean not null default false,
  use_for_recovery boolean not null default true,
  use_for_notification boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_emails_email_not_blank_chk
    check (char_length(btrim(email)) > 0),
  constraint account_emails_verified_at_chk
    check (
      (is_verified = false and verified_at is null)
      or
      (is_verified = true and verified_at is not null)
    )
);

create unique index if not exists account_emails_user_normalized_email_uidx
  on public.account_emails (user_id, normalized_email);

create index if not exists account_emails_user_verified_2fa_idx
  on public.account_emails (user_id, is_verified, use_for_2fa, verified_at);

drop trigger if exists trg_account_emails_set_updated_at on public.account_emails;
create trigger trg_account_emails_set_updated_at
before update on public.account_emails
for each row
execute function public.set_updated_at();

alter table public.account_emails enable row level security;

drop policy if exists account_emails_select_own on public.account_emails;
create policy account_emails_select_own
  on public.account_emails
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists account_emails_delete_own on public.account_emails;
create policy account_emails_delete_own
  on public.account_emails
  for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, delete on public.account_emails to authenticated;

create table if not exists public.account_email_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_email_id uuid references public.account_emails(id) on delete cascade,
  normalized_email text not null,
  purpose text not null,
  otp_hash text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint account_email_otp_challenges_purpose_chk
    check (purpose in ('verify_email', 'step_up', 'change_email', 'change_password')),
  constraint account_email_otp_challenges_attempts_chk
    check (attempts >= 0 and max_attempts > 0)
);

create index if not exists account_email_otp_challenges_lookup_idx
  on public.account_email_otp_challenges (
    user_id,
    account_email_id,
    purpose,
    normalized_email,
    created_at desc
  )
  where consumed_at is null;

create index if not exists account_email_otp_challenges_rate_limit_idx
  on public.account_email_otp_challenges (
    user_id,
    purpose,
    normalized_email,
    created_at desc
  );

alter table public.account_email_otp_challenges enable row level security;

revoke all on public.account_email_otp_challenges from anon, authenticated;

create table if not exists public.account_trusted_browsers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  browser_secret_hash text not null,
  label text,
  last_verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_trusted_browsers_secret_not_blank_chk
    check (char_length(btrim(browser_secret_hash)) > 0)
);

create unique index if not exists account_trusted_browsers_user_secret_uidx
  on public.account_trusted_browsers (user_id, browser_secret_hash);

create index if not exists account_trusted_browsers_user_verified_idx
  on public.account_trusted_browsers (user_id, last_verified_at desc)
  where revoked_at is null;

drop trigger if exists trg_account_trusted_browsers_set_updated_at on public.account_trusted_browsers;
create trigger trg_account_trusted_browsers_set_updated_at
before update on public.account_trusted_browsers
for each row
execute function public.set_updated_at();

alter table public.account_trusted_browsers enable row level security;

revoke all on public.account_trusted_browsers from anon, authenticated;
