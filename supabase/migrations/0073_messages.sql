-- =====================================================================
-- XTEND migration 0073 — messages between staff and their supervisor
--
-- Every merchandiser and marketer has one conversation. On the other side
-- is whoever supervises them (supervises_user), plus admins and HR, who
-- can read and reply in any conversation. Support (020) stays for problems
-- with the app; this is for day-to-day work talk.
--
--   * message_threads: one per staff member, made by their first message
--     (or the office's).
--   * messages: never edited or deleted, like every other record.
--   * message_reads: when each person last read a conversation, for the
--     unread counts on both sides.
--   * send_message() is the only way in. It checks who may write, saves
--     the message and marks it read for the sender. The server then sends
--     the push to the other side.
--   * Realtime: the staff member's own topic (0058) hears a 'messages'
--     change; the office pages follow the table through RLS.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.hr_sees(uuid)') is null then
    raise exception 'Run the HR role update (0072) first, then this file';
  end if;
end $$;

create table if not exists public.message_threads (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null unique references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_sender_id  uuid references public.profiles(id) on delete set null
);
create index if not exists message_threads_latest on public.message_threads (last_message_at desc);

create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references public.message_threads(id) on delete cascade,
  -- Kept if the sender's account is ever removed (only a test reset does that).
  sender_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists messages_by_thread on public.messages (thread_id, created_at);

create table if not exists public.message_reads (
  thread_id uuid not null references public.message_threads(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  read_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

-- Who may take part in a staff member's conversation: the person
-- themselves, their supervisor, admins and HR.
create or replace function public.can_message(p_staff uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles s
    where s.id = p_staff and public.is_field_role(s.role)
      and (s.id = auth.uid() or public.is_admin() or public.is_hr() or public.supervises_user(s.id)));
$$;
revoke all on function public.can_message(uuid) from public, anon;
grant execute on function public.can_message(uuid) to authenticated, service_role;

alter table public.message_threads enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;

create policy message_threads_read on public.message_threads
  for select using (public.can_message(staff_id));
create policy messages_read on public.messages
  for select using (exists (select 1 from public.message_threads t
                            where t.id = thread_id and public.can_message(t.staff_id)));
create policy message_reads_own on public.message_reads
  for select using (user_id = auth.uid());

revoke insert, update, delete, truncate on public.message_threads, public.messages, public.message_reads
  from anon, authenticated;

-- Send a message in a staff member's conversation. A staff member always
-- writes in their own, whatever p_staff says.
create or replace function public.send_message(p_staff uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  staff uuid;
  clean text := btrim(coalesce(p_body, ''));
  t uuid;
  m uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.is_active then
    raise exception 'Sign in first';
  end if;
  staff := case when public.is_field_role(me.role) then me.id else p_staff end;
  if staff is null or not public.can_message(staff) then
    raise exception 'You can only message your own team';
  end if;
  if not exists (select 1 from public.profiles where id = staff and is_active) then
    raise exception 'That person''s account is not active';
  end if;
  if length(clean) < 1 then
    raise exception 'Write your message first';
  end if;
  if length(clean) > 2000 then
    raise exception 'Keep the message under 2,000 characters';
  end if;

  insert into public.message_threads (staff_id) values (staff)
  on conflict (staff_id) do nothing;
  select id into t from public.message_threads where staff_id = staff;

  insert into public.messages (thread_id, sender_id, body) values (t, me.id, clean)
  returning id into m;
  update public.message_threads set last_message_at = now(), last_sender_id = me.id where id = t;
  insert into public.message_reads (thread_id, user_id, read_at) values (t, me.id, clock_timestamp())
  on conflict (thread_id, user_id) do update set read_at = excluded.read_at;

  return jsonb_build_object('message_id', m, 'thread_id', t, 'staff_id', staff,
                            'from_staff', staff = me.id,
                            'supervisor_id', (select supervisor_id from public.profiles where id = staff));
end;
$$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

-- Mark a conversation read for the signed-in person.
create or replace function public.read_messages(p_staff uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    return;
  end if;
  select id into t from public.message_threads
  where staff_id = case when public.is_field_role(me.role) then me.id else p_staff end;
  if t is null or not public.can_message(case when public.is_field_role(me.role) then me.id else p_staff end) then
    return;
  end if;
  insert into public.message_reads (thread_id, user_id, read_at) values (t, me.id, clock_timestamp())
  on conflict (thread_id, user_id) do update set read_at = excluded.read_at;
end;
$$;
revoke all on function public.read_messages(uuid) from public, anon;
grant execute on function public.read_messages(uuid) to authenticated;

-- Unread messages for the signed-in person: their own conversation for
-- staff; every conversation they can see for the office.
create or replace function public.unread_messages()
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from public.messages m
  join public.message_threads t on t.id = m.thread_id
  left join public.message_reads r on r.thread_id = t.id and r.user_id = auth.uid()
  where public.can_message(t.staff_id)
    and m.sender_id is distinct from auth.uid()
    and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz);
$$;
revoke all on function public.unread_messages() from public, anon;
grant execute on function public.unread_messages() to authenticated;

-- One conversation, oldest first, with who wrote each message. A staff
-- member always gets their own, whatever p_staff says. Names come from
-- here because staff cannot read the office's profiles.
create or replace function public.conversation(p_staff uuid)
returns table (id uuid, body text, created_at timestamptz, sender_name text,
               from_staff boolean, mine boolean)
language sql stable security definer set search_path = public as $$
  with who as (
    select case when public.is_field_role(public.current_user_role()) then auth.uid() else p_staff end as staff
  )
  select m.id, m.body, m.created_at, coalesce(s.full_name, 'Former staff'),
         m.sender_id = t.staff_id, m.sender_id = auth.uid()
  from who
  join public.message_threads t on t.staff_id = who.staff
  join public.messages m on m.thread_id = t.id
  left join public.profiles s on s.id = m.sender_id
  where public.can_message(who.staff)
  order by m.created_at
  limit 500;
$$;
revoke all on function public.conversation(uuid) from public, anon;
grant execute on function public.conversation(uuid) to authenticated;

-- Who a staff member is writing to: their supervisor's name, if they have one.
create or replace function public.my_supervisor_name()
returns text
language sql stable security definer set search_path = public as $$
  select s.full_name from public.profiles me
  join public.profiles s on s.id = me.supervisor_id and s.is_active
  where me.id = auth.uid();
$$;
revoke all on function public.my_supervisor_name() from public, anon;
grant execute on function public.my_supervisor_name() to authenticated;

-- The office inbox: every merchandiser and marketer the caller may message,
-- with their conversation's latest message and unread count. People with
-- no messages yet are listed too, so the office can start one.
create or replace function public.message_inbox()
returns table (staff_id uuid, full_name text, role user_role, outlet_name text,
               supervisor_name text, last_message_at timestamptz, last_body text,
               last_from_staff boolean, unread integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, o.name, sup.full_name,
         t.last_message_at,
         (select m.body from public.messages m where m.thread_id = t.id order by m.created_at desc limit 1),
         t.last_sender_id = p.id,
         coalesce((select count(*)::integer from public.messages m
                   left join public.message_reads r on r.thread_id = t.id and r.user_id = auth.uid()
                   where m.thread_id = t.id and m.sender_id is distinct from auth.uid()
                     and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)), 0)
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  left join public.profiles sup on sup.id = p.supervisor_id
  left join public.message_threads t on t.staff_id = p.id
  where p.is_active and public.is_field_role(p.role) and p.id <> auth.uid()
    and public.can_message(p.id)
  order by t.last_message_at desc nulls last, p.full_name;
$$;
revoke all on function public.message_inbox() from public, anon;
grant execute on function public.message_inbox() to authenticated;

-- Realtime: tell the staff member's phone; the office follows the table.
create or replace function public.realtime_notify_message()
returns trigger
language plpgsql security definer set search_path = public, realtime as $$
declare
  owner uuid;
begin
  select staff_id into owner from public.message_threads where id = new.thread_id;
  if owner is not null then
    perform realtime.send(jsonb_build_object('table', 'messages', 'op', tg_op),
                          'change', public.field_topic(owner), true);
  end if;
  return null;
end;
$$;
create trigger realtime_broadcast
  after insert on public.messages
  for each row execute function public.realtime_notify_message();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- Test-mode reset (0066): messages go with support.
create or replace function public.reset_category_tables()
returns table (category text, table_name text, step integer)
language sql immutable as $$
  select split_part(v.x, ':', 1), split_part(v.x, ':', 2), v.n::integer
  from unnest(array[
    'teams:staff_outlets', 'xm:xm_reconciliations', 'xm:xm_expiry_alerts', 'xm:xm_count_lines',
    'xm:xm_counts', 'xm:xm_sale_lines', 'xm:xm_sales', 'xm:xm_policy_reads',
    'xm:xm_monthly_grades', 'xm:xm_targets', 'xm:xm_supplies', 'xm:xm_supply_imports',
    'stock_counts:store_count_sheets', 'stock_counts:store_counts',
    'stock_counts:count_request_targets', 'stock_counts:count_requests', 'reports:report_files',
    'reports:report_photos', 'reports:reports', 'visits_places:place_naming_due',
    'visits_places:store_visits', 'visits_places:known_places', 'clock_ins:follow_sessions',
    'clock_ins:location_alerts',
    'clock_ins:location_pings', 'clock_ins:excuse_checks', 'clock_ins:phone_checks',
    'clock_ins:photo_checks', 'clock_ins:device_beacons', 'clock_ins:clock_out_reminders',
    'clock_ins:tracking_tokens', 'clock_ins:integrity_flags', 'clock_ins:attendance',
    'leave_schedules:leave_requests', 'leave_schedules:schedule_overrides',
    'leave_schedules:work_patterns', 'support:message_reads', 'support:messages',
    'support:message_threads', 'support:support_messages', 'support:support_threads',
    'notifications:notification_deliveries', 'notifications:scheduled_notifications',
    'notifications:notifications', 'activity:user_activity', 'ask:assistant_conversations',
    'stores:xm_stores', 'stores:outlets', 'audit:audit_log'
  ]) with ordinality as v(x, n);
$$;

select 'Messages (0073) installed' as result;
