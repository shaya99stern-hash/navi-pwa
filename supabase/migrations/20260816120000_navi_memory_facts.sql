-- Durable facts, remembered across conversations.
--
-- This table has been referenced by `lib/memory/facts.ts` since facts shipped,
-- and there has never been a migration for it in this repository. The one
-- migration here creates navi_chats, navi_preferences and navi_learned_skills,
-- and its header comment describes the RLS pattern as "same as
-- navi_memory_facts" — a table that, as far as this repo is concerned, did not
-- exist. Anyone recreating the database from these files got a deployment where
-- remembered facts failed on every read and write, silently, forever.
--
-- Same RLS pattern as the rest: every row is keyed to the Clerk JWT subject,
-- so the anon key alone can read nothing.

create table if not exists public.navi_memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  fact text not null check (char_length(fact) >= 1 and char_length(fact) <= 500),
  source_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Targeted by PostgREST's `on_conflict=user_id,fact` in `rememberFact`, so
  -- the columns and their order have to match that string exactly: ON CONFLICT
  -- can only use an index that covers precisely those columns.
  --
  -- Deliberately case-sensitive, and the code comment claiming otherwise is
  -- corrected in the same commit. A `lower(fact)` functional index would fold
  -- case, but ON CONFLICT cannot target one from `on_conflict=user_id,fact` —
  -- so an index that looked more correct here would have made every write fail
  -- instead. The cost is that two facts differing only in case become two rows.
  unique (user_id, fact)
);

alter table public.navi_memory_facts enable row level security;
create policy "read own facts" on public.navi_memory_facts for select using (user_id = (select (auth.jwt() ->> 'sub')));
create policy "insert own facts" on public.navi_memory_facts for insert with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "update own facts" on public.navi_memory_facts for update using (user_id = (select (auth.jwt() ->> 'sub'))) with check (user_id = (select (auth.jwt() ->> 'sub')));
create policy "delete own facts" on public.navi_memory_facts for delete using (user_id = (select (auth.jwt() ->> 'sub')));

-- `listFacts` reads `order=updated_at.desc&limit=60` on every turn that uses
-- memory, which is the hottest query this table has.
create index if not exists navi_memory_facts_recency on public.navi_memory_facts (user_id, updated_at desc);
