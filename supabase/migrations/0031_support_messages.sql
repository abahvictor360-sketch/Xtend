-- ---------------------------------------------------------------------
-- XTEND: in-app support messages.
--
-- A field member (merchandiser or marketer) raises an issue from the app.
-- The AI assistant reads the thread and answers what it can; when the issue
-- needs a person (an account change, a dispute, anything it is unsure of) it
-- replies briefly and escalates to the office, which then takes over the
-- same thread. Office replies and the AI's replies both reach the staff
-- member through the existing notification inbox.
--
-- Reads are controlled by RLS: a member sees their own threads, a supervisor
-- sees their team's, an admin sees all. Writes go through the RPCs below so
-- nobody can post as someone else or into a thread that is not theirs.
-- ---------------------------------------------------------------------

create type support_status as enum ('open', 'ai_answered', 'escalated', 'resolved');
create type support_sender as enum ('staff', 'ai', 'admin', 'supervisor');

create table public.support_threads (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  outlet_id     uuid references public.outlets(id) on delete set null,
  subject       text not null check (length(subject) between 1 and 160),
  status        support_status not null default 'open',
  escalated_at  timestamptz,
  resolved_by   uuid references public.profiles(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index support_threads_by_user on public.support_threads (user_id, last_message_at desc);
create index support_threads_open on public.support_threads (status, last_message_at desc)
  where status in ('open', 'escalated');

create table public.support_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.support_threads(id) on delete cascade,
  sender_id   uuid references public.profiles(id) on delete set null,
  sender_role support_sender not null,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index support_messages_by_thread on public.support_messages (thread_id, created_at);

alter table public.support_threads  enable row level security;
alter table public.support_messages enable row level security;

-- Reads. The office sees a team member's or anyone's threads; a field
-- member sees only their own.
create policy support_threads_select on public.support_threads
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

create policy support_messages_select on public.support_messages
  for select using (
    exists (
      select 1 from public.support_threads t
      where t.id = thread_id
        and (t.user_id = auth.uid() or public.is_admin() or public.supervises_user(t.user_id))
    )
  );

-- All writes go through the RPCs; no direct table writes from clients.
revoke insert, update, delete, truncate on public.support_threads  from anon, authenticated;
revoke insert, update, delete, truncate on public.support_messages from anon, authenticated;

-- ---------------------------------------------------------------------
-- A field member opens a thread with a first message.
-- ---------------------------------------------------------------------
create or replace function public.open_support_thread(p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  my_outlet uuid;
  tid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Message is empty'; end if;

  select outlet_id into my_outlet from public.profiles where id = uid;

  insert into public.support_threads (user_id, outlet_id, subject)
  values (uid, my_outlet,
          left(coalesce(nullif(btrim(p_subject), ''), 'Issue from the field'), 160))
  returning id into tid;

  insert into public.support_messages (thread_id, sender_id, sender_role, body)
  values (tid, uid, 'staff', left(btrim(p_body), 4000));

  return tid;
end;
$$;

revoke all on function public.open_support_thread(text, text) from public, anon;
grant execute on function public.open_support_thread(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Add a message to an existing thread. The sender role is decided from who
-- is calling, never trusted from the client.
--  - the thread's owner posts as 'staff' and reopens the thread
--  - an admin or the owner's supervisor posts as their office role and the
--    thread moves to resolved unless they are still mid-conversation
-- ---------------------------------------------------------------------
create or replace function public.post_support_message(p_thread uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  t record;
  role_val support_sender;
  caller_role user_role;
  mid uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_body), '') = '' then raise exception 'Message is empty'; end if;

  select * into t from public.support_threads where id = p_thread;
  if t.id is null then raise exception 'No such thread'; end if;

  select role into caller_role from public.profiles where id = uid;

  if t.user_id = uid then
    role_val := 'staff';
  elsif public.is_admin() then
    role_val := 'admin';
  elsif public.supervises_user(t.user_id) then
    role_val := 'supervisor';
  else
    raise exception 'That thread is not yours';
  end if;

  insert into public.support_messages (thread_id, sender_id, sender_role, body)
  values (p_thread, uid, role_val, left(btrim(p_body), 4000))
  returning id into mid;

  update public.support_threads
  set last_message_at = now(),
      -- The member writing again needs attention; the office writing has
      -- given it. Neither auto-resolves: that is an explicit action.
      status = case when role_val = 'staff' then 'open'
                    else 'ai_answered' end
  where id = p_thread;

  return mid;
end;
$$;

revoke all on function public.post_support_message(uuid, text) from public, anon;
grant execute on function public.post_support_message(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The office marks a thread resolved.
-- ---------------------------------------------------------------------
create or replace function public.resolve_support_thread(p_thread uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t record;
begin
  select * into t from public.support_threads where id = p_thread;
  if t.id is null then raise exception 'No such thread'; end if;
  if not (public.is_admin() or public.supervises_user(t.user_id)) then
    raise exception 'That thread is not yours to resolve';
  end if;

  update public.support_threads
  set status = 'resolved', resolved_by = auth.uid(), resolved_at = now()
  where id = p_thread;
end;
$$;

revoke all on function public.resolve_support_thread(uuid) from public, anon;
grant execute on function public.resolve_support_thread(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- A reading view for the office list: who, where, counts, last snippet.
-- ---------------------------------------------------------------------
create or replace view public.support_thread_detail
with (security_invoker = true) as
  select t.id, t.user_id, p.full_name as staff_name, p.role as staff_role,
         t.subject, t.status, t.outlet_id, o.name as outlet_name,
         t.created_at, t.last_message_at, t.escalated_at, t.resolved_at,
         rb.full_name as resolved_by_name,
         (select count(*) from public.support_messages m where m.thread_id = t.id) as message_count,
         (select m.body from public.support_messages m
          where m.thread_id = t.id order by m.created_at desc limit 1) as last_body
  from public.support_threads t
  join public.profiles p on p.id = t.user_id
  left join public.outlets o on o.id = t.outlet_id
  left join public.profiles rb on rb.id = t.resolved_by;

grant select on public.support_thread_detail to authenticated;
