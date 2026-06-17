-- Feedback rate-limit metadata for TypingNote.
--
-- The feedback message body is intentionally not stored here. It is delivered
-- by email only; this table keeps the minimum metadata needed for rate limits.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  login_email text,
  message_length integer not null default 0,
  selected_text_length integer not null default 0,
  included_selection boolean not null default false,
  included_environment boolean not null default false,
  created_at timestamptz not null default now(),

  constraint feedback_submissions_message_length_chk
    check (message_length >= 0 and message_length <= 4000),
  constraint feedback_submissions_selected_text_length_chk
    check (selected_text_length >= 0 and selected_text_length <= 2000)
);

create index if not exists feedback_submissions_user_created_at_idx
  on public.feedback_submissions (user_id, created_at desc);

alter table public.feedback_submissions enable row level security;

revoke all on public.feedback_submissions from anon, authenticated;
