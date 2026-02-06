create table if not exists public.memos (
  id uuid primary key default gen_random_uuid(),

  -- 所有者（ログインユーザー）
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 本文（2ペインの state.text を入れる）
  content text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- よく使うのでインデックス（任意だけどおすすめ）
create index if not exists memos_user_id_created_at_idx
  on public.memos (user_id, created_at desc);


alter table public.memos enable row level security;

create policy "memos_insert_own"
    on public.memos
    for insert
    with check (auth.uid() = user_id);

create policy "memos_select_own"
    on public.memos
    for select
    using (auth.uid() = user_id);

create policy "memos_update_own"
    on public.memos
    for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "memos_delete_own"
    on public.memos
    for delete
    using (auth.uid() = user_id);
