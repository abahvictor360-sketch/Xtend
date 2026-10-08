-- =====================================================================
-- XTEND migration 054 — Integrity and Ask Xtend, advanced
--
--  A. Several integrity flags marked reviewed at once, with one note.
--     The same rule as review_integrity_flag() (022): an admin reviews
--     anybody's, a supervisor only their own team's. Flags already
--     reviewed keep the first reviewer and note.
--  B. Ask Xtend conversations are kept, so an admin or supervisor can come
--     back to an earlier chat. Each person sees and changes only their own.
-- =====================================================================

-- 054 builds on 022. Say so plainly rather than fail halfway.
do $$
begin
  if to_regclass('public.integrity_flags') is null then
    raise exception 'Run the integrity checks update (022) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- A. Review in bulk.
-- ---------------------------------------------------------------------
create or replace function public.review_integrity_flags(p_ids uuid[], p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  done integer;
begin
  if auth.uid() is null or coalesce(public.current_user_role()::text, '') not in ('admin', 'supervisor') then
    raise exception 'Only admins and supervisors review flags';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'Pick at least one flag';
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'Review at most 200 flags at a time';
  end if;
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  update public.integrity_flags f
  set reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_note, '')), '')
  where f.id = any(p_ids)
    and f.reviewed_at is null
    and (public.is_admin() or public.supervises_user(f.user_id));
  get diagnostics done = row_count;
  return done;
end;
$$;

revoke all on function public.review_integrity_flags(uuid[], text) from public, anon;
grant execute on function public.review_integrity_flags(uuid[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- B. Ask Xtend conversations.
-- ---------------------------------------------------------------------
create table if not exists public.assistant_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title      text not null default 'New conversation'
             check (length(btrim(title)) between 1 and 120),
  -- The chat as the page shows it: questions, answers, report and page
  -- buttons. Proposed actions are kept as words only, never re-applied.
  turns      jsonb not null default '[]'::jsonb
             check (jsonb_typeof(turns) = 'array' and octet_length(turns::text) <= 1500000),
  turn_count integer generated always as (jsonb_array_length(turns)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists assistant_conversations_by_user
  on public.assistant_conversations (user_id, updated_at desc);

-- Whose it is never changes, and updated_at follows every edit.
create or replace function public.assistant_conversation_touch()
returns trigger language plpgsql as $$
begin
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_assistant_conversation_touch on public.assistant_conversations;
create trigger trg_assistant_conversation_touch
  before update on public.assistant_conversations
  for each row execute function public.assistant_conversation_touch();

alter table public.assistant_conversations enable row level security;

drop policy if exists assistant_conversations_select on public.assistant_conversations;
create policy assistant_conversations_select on public.assistant_conversations
  for select using (user_id = auth.uid());

drop policy if exists assistant_conversations_insert on public.assistant_conversations;
create policy assistant_conversations_insert on public.assistant_conversations
  for insert with check (
    user_id = auth.uid()
    and coalesce(public.current_user_role()::text, '') in ('admin', 'supervisor')
  );

drop policy if exists assistant_conversations_update on public.assistant_conversations;
create policy assistant_conversations_update on public.assistant_conversations
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists assistant_conversations_delete on public.assistant_conversations;
create policy assistant_conversations_delete on public.assistant_conversations
  for delete using (user_id = auth.uid());

revoke all on public.assistant_conversations from anon;
grant select, insert, update, delete on public.assistant_conversations to authenticated;
grant select, insert, update, delete on public.assistant_conversations to service_role;

select 'Integrity and Ask Xtend, advanced (054) installed' as result;
