-- Privacy-preserving first-party product analytics for TypingNote.
--
-- This table intentionally stores only manual event names and small allowlisted
-- metadata. Memo bodies, selected text, search terms, and memo IDs should never
-- be inserted here.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id uuid not null,
  session_id uuid not null,
  event_name text not null,
  metadata jsonb not null default '{}'::jsonb,
  page_path text,
  created_at timestamptz not null default now(),

  constraint app_events_event_name_chk
    check (
      event_name in (
        'memo_saved',
        'memo_created',
        'memo_updated',
        'explorer_opened',
        'dust_opened',
        'search_used',
        'feedback_sent',
        'auth_signin_succeeded'
      )
    ),
  constraint app_events_metadata_object_chk
    check (jsonb_typeof(metadata) = 'object'),
  constraint app_events_metadata_size_chk
    check (octet_length(metadata::text) <= 2048),
  constraint app_events_page_path_length_chk
    check (page_path is null or char_length(page_path) <= 200)
);

create index if not exists app_events_created_at_idx
  on public.app_events (created_at desc);

create index if not exists app_events_event_created_at_idx
  on public.app_events (event_name, created_at desc);

create index if not exists app_events_user_created_at_idx
  on public.app_events (user_id, created_at desc)
  where user_id is not null;

create index if not exists app_events_anonymous_created_at_idx
  on public.app_events (anonymous_id, created_at desc);

alter table public.app_events enable row level security;

revoke all on public.app_events from anon, authenticated;

drop policy if exists app_events_insert_anon_or_own
  on public.app_events;

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
      (auth.role() = 'authenticated' and (user_id is null or auth.uid() = user_id))
    )
  );

grant insert on public.app_events to anon, authenticated;
