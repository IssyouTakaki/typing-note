-- Recoverable account deletion for TypingNote.
--
-- A deletion request blocks normal data access immediately, keeps the Auth user
-- and owned data for 30 days, and is purged later by a scheduled Edge Function.

create extension if not exists pgcrypto with schema extensions;

alter table public.account_email_otp_challenges
  drop constraint if exists account_email_otp_challenges_purpose_chk;

alter table public.account_email_otp_challenges
  drop constraint if exists account_email_otp_purpose_check;

alter table public.account_email_otp_challenges
  add constraint account_email_otp_challenges_purpose_chk
  check (
    purpose in (
      'verify_email',
      'step_up',
      'change_email',
      'change_password',
      'delete_account'
    )
  );

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  normalized_login_email text not null,
  resolved_locale text not null default 'en',
  status text not null default 'preparing',
  otp_verified_at timestamptz not null,
  scheduled_deletion_at timestamptz not null default (now() + interval '30 days'),
  recovery_failed_attempts integer not null default 0,
  recovery_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint account_deletion_requests_email_not_blank_chk
    check (char_length(btrim(normalized_login_email)) > 0),
  constraint account_deletion_requests_locale_chk
    check (resolved_locale in ('ja', 'en')),
  constraint account_deletion_requests_status_chk
    check (status in ('preparing', 'pending', 'restoring', 'purging')),
  constraint account_deletion_requests_schedule_chk
    check (scheduled_deletion_at > created_at),
  constraint account_deletion_requests_attempts_chk
    check (recovery_failed_attempts >= 0)
);

create index if not exists account_deletion_requests_due_idx
  on public.account_deletion_requests (scheduled_deletion_at)
  where status = 'pending';

create index if not exists account_deletion_requests_email_idx
  on public.account_deletion_requests (normalized_login_email)
  where status = 'pending';

drop trigger if exists trg_account_deletion_requests_set_updated_at
  on public.account_deletion_requests;

create trigger trg_account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row
execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;

create table if not exists public.account_deletion_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.account_deletion_requests(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint account_deletion_recovery_codes_hash_not_blank_chk
    check (char_length(btrim(code_hash)) > 0),
  constraint account_deletion_recovery_codes_expiry_chk
    check (expires_at > created_at)
);

create index if not exists account_deletion_recovery_codes_request_idx
  on public.account_deletion_recovery_codes (request_id, created_at desc)
  where consumed_at is null;

alter table public.account_deletion_recovery_codes enable row level security;
revoke all on public.account_deletion_recovery_codes from anon, authenticated;

create or replace function public.is_account_active(check_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.account_deletion_requests request
    where request.user_id = check_user_id
      and request.status in ('pending', 'restoring', 'purging')
  );
$$;

revoke all on function public.is_account_active(uuid) from public;
grant execute on function public.is_account_active(uuid) to anon, authenticated, service_role;

drop policy if exists "Users can delete own account emails"
  on public.account_emails;
drop policy if exists account_emails_delete_own
  on public.account_emails;
create policy account_emails_delete_own
  on public.account_emails
  for delete
  to authenticated
  using (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  );

drop policy if exists account_emails_select_own
  on public.account_emails;
create policy account_emails_select_own
  on public.account_emails
  for select
  to authenticated
  using (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  );

drop policy if exists memos_delete_own on public.memos;
create policy memos_delete_own
  on public.memos
  for delete
  to authenticated
  using (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  );

drop policy if exists memos_insert_own on public.memos;
create policy memos_insert_own
  on public.memos
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  );

drop policy if exists memos_select_own on public.memos;
create policy memos_select_own
  on public.memos
  for select
  to authenticated
  using (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  );

drop policy if exists memos_update_own on public.memos;
create policy memos_update_own
  on public.memos
  for update
  to authenticated
  using (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  )
  with check (
    auth.uid() = user_id
    and public.is_account_active(auth.uid())
  );

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own
  on public.profiles
  for insert
  to authenticated
  with check (
    auth.uid() = id
    and public.is_account_active(auth.uid())
  );

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own
  on public.profiles
  for select
  to authenticated
  using (
    auth.uid() = id
    and public.is_account_active(auth.uid())
  );

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own
  on public.profiles
  for update
  to authenticated
  using (
    auth.uid() = id
    and public.is_account_active(auth.uid())
  )
  with check (
    auth.uid() = id
    and public.is_account_active(auth.uid())
  );

drop policy if exists app_events_insert_anon_or_own on public.app_events;
create policy app_events_insert_anon_or_own
  on public.app_events
  for insert
  to anon, authenticated
  with check (
    anonymous_id is not null
    and session_id is not null
    and (
      (auth.role() = 'anon' and user_id is null)
      or
      (
        auth.role() = 'authenticated'
        and public.is_account_active(auth.uid())
        and (user_id is null or auth.uid() = user_id)
      )
    )
  );
