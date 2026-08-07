-- Cloud memory: chats, preferences, and learned skills follow the person,
-- not the device. Same RLS pattern as navi_memory_facts: every row is keyed
-- to the Clerk JWT subject, so the anon key alone can read nothing.
--
-- Applied to the NaviOS Supabase project on 2026-08-07; kept here as the
-- record of what the database looks like and how to recreate it.

create table if not exists public.navi_chats (
  user_id text not null,
  chat_id text not null,
  title text not null default 'New chat',
  preview text not null default '',
  pinned boolean not null default false,
  summary text,
  project_id text,
  updated_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (user_id, chat_id)
);
alter table public.navi_chats enable row level security;
create policy "read own chats" on public.navi_chats for select using (user_id = (select (auth.jwt() ->> 'sub')));
create policy "insert own chats" on public.navi_chats for insert with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "update own chats" on public.navi_chats for update using (user_id = (select (auth.jwt() ->> 'sub'))) with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "delete own chats" on public.navi_chats for delete using (user_id = (select (auth.jwt() ->> 'sub')));
create index if not exists navi_chats_recency on public.navi_chats (user_id, updated_at desc);

create table if not exists public.navi_preferences (
  user_id text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.navi_preferences enable row level security;
create policy "read own preferences" on public.navi_preferences for select using (user_id = (select (auth.jwt() ->> 'sub')));
create policy "insert own preferences" on public.navi_preferences for insert with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "update own preferences" on public.navi_preferences for update using (user_id = (select (auth.jwt() ->> 'sub'))) with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "delete own preferences" on public.navi_preferences for delete using (user_id = (select (auth.jwt() ->> 'sub')));

create table if not exists public.navi_learned_skills (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null check (char_length(name) >= 1 and char_length(name) <= 120),
  description text not null default '' check (char_length(description) <= 500),
  instructions text not null check (char_length(instructions) >= 1 and char_length(instructions) <= 24000),
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
alter table public.navi_learned_skills enable row level security;
create policy "read own skills" on public.navi_learned_skills for select using (user_id = (select (auth.jwt() ->> 'sub')));
create policy "insert own skills" on public.navi_learned_skills for insert with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "update own skills" on public.navi_learned_skills for update using (user_id = (select (auth.jwt() ->> 'sub'))) with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "delete own skills" on public.navi_learned_skills for delete using (user_id = (select (auth.jwt() ->> 'sub')));
