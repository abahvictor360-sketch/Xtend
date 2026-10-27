-- =====================================================================
-- 0070: Follow live
--
-- "Just like a delivery app shows the real-time location of the dispatch
-- rider on the map." An admin (anyone) or a supervisor (their own team)
-- opens /admin/follow/<person> from Movement and watches one person who
-- is clocked in move on the map, a few seconds behind.
--
--   * follow_sessions: who follows whom, from when, until when, and the
--     latest live position. Admins read all; supervisors their team's;
--     staff nothing; nobody writes it directly (functions only).
--   * Only people clocked in today and not clocked out can be followed.
--     A session ends by itself at clock-out (trigger on attendance), after
--     30 minutes (the page offers "Keep following": another 30), or when
--     the page stops checking in (no heartbeat for 60 seconds). A Stop
--     button ends it at once.
--   * Only the followed phone speeds up: follow_interval_for(user) gives
--     the fast interval (8 s) while an active session exists, else null.
--     The location endpoints add it to their answer; the web heartbeat and
--     the native trackers obey it and drop back when it is gone.
--   * Fast positions are NOT stored as location_pings rows: each one goes
--     through follow_live_position_for(), which keeps only the latest on
--     the session row and broadcasts it on the private Realtime topic
--     `follow:<session id>`, readable only by the person following (RLS on
--     realtime.messages, as 0058 does for `field:<uid>`). The normal
--     5-minute / 2.5-minute pings are stored exactly as before, with every
--     integrity check (0055 still refuses positions after clock-out).
--   * At most system_settings.follow_max_sessions (20) active sessions at
--     once across the whole system; more are refused with a plain message.
--   * Staff are never told: the only thing their phone gets is a silent
--     "sync" on their own topic, carrying nothing, so an open app sends a
--     position at once instead of within 5 minutes.
--   * Every start, extension and stop is audited (follow.start,
--     follow.extend, follow.stop).
-- =====================================================================

do $$
begin
  if to_regprocedure('public.claim_shift_soon_reminders(timestamptz)') is null then
    raise exception 'Run the five-minute shift heads-ups update (069) first, then this file';
  end if;
end $$;

-- How many people may be followed live at once, system-wide. Change with
-- SQL: update public.system_settings set follow_max_sessions = 30;
alter table public.system_settings
  add column if not exists follow_max_sessions integer not null default 20
  check (follow_max_sessions between 1 and 200);

-- ---------------------------------------------------------------------
-- The fixed numbers, in one place.
-- ---------------------------------------------------------------------
create or replace function public.follow_fast_interval_ms()
returns integer language sql immutable as $$ select 8000 $$;
create or replace function public.follow_window()
returns interval language sql immutable as $$ select interval '30 minutes' $$;
create or replace function public.follow_heartbeat_grace()
returns interval language sql immutable as $$ select interval '60 seconds' $$;

create or replace function public.follow_topic(p_session uuid)
returns text language sql immutable as $$ select 'follow:' || p_session::text $$;

-- ---------------------------------------------------------------------
-- The table.
-- ---------------------------------------------------------------------
create table if not exists public.follow_sessions (
  id              uuid primary key default gen_random_uuid(),
  watcher_id      uuid not null references public.profiles(id) on delete cascade,
  subject_id      uuid not null references public.profiles(id) on delete cascade,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  last_seen_at    timestamptz not null default now(),
  ended_at        timestamptz,
  end_reason      text check (end_reason in ('stopped', 'closed', 'expired', 'clocked_out')),
  extended        integer not null default 0,
  -- The latest live position (one row updated, never a history).
  last_lat        double precision check (last_lat is null or last_lat between -90 and 90),
  last_lng        double precision check (last_lng is null or last_lng between -180 and 180),
  last_accuracy_m double precision check (last_accuracy_m is null or last_accuracy_m >= 0),
  last_heading    double precision,
  last_speed_mps  double precision,
  last_at         timestamptz,
  check (watcher_id <> subject_id),
  check ((ended_at is null) = (end_reason is null))
);
create index if not exists follow_sessions_open_by_subject
  on public.follow_sessions (subject_id) where ended_at is null;
create index if not exists follow_sessions_by_watcher
  on public.follow_sessions (watcher_id, started_at desc);

alter table public.follow_sessions enable row level security;
drop policy if exists follow_sessions_read on public.follow_sessions;
create policy follow_sessions_read on public.follow_sessions
  for select to authenticated
  using (public.is_admin() or public.supervises_user(subject_id));
revoke insert, update, delete, truncate on public.follow_sessions from anon, authenticated;

-- ---------------------------------------------------------------------
-- Rules.
-- ---------------------------------------------------------------------

-- Clocked in today (Lagos) and not clocked out; an active field account.
create or replace function public.follow_on_shift(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
           select 1 from public.profiles p
           where p.id = p_user and p.is_active and public.is_field_role(p.role))
     and exists (
           select 1 from public.attendance a
           where a.user_id = p_user and a.attendance_date = public.business_date() and a.type = 'opening')
     and not exists (
           select 1 from public.attendance a
           where a.user_id = p_user and a.attendance_date = public.business_date() and a.type = 'closing');
$$;
revoke all on function public.follow_on_shift(uuid) from public, anon, authenticated;

-- A session is live while it has not ended, has not run out, the page
-- following it still checks in, and the person is still on shift.
create or replace function public.follow_session_live(s public.follow_sessions)
returns boolean language sql stable security definer set search_path = public as $$
  select s.ended_at is null
     and s.expires_at > now()
     and s.last_seen_at > now() - public.follow_heartbeat_grace()
     and public.follow_on_shift(s.subject_id);
$$;
revoke all on function public.follow_session_live(public.follow_sessions) from public, anon, authenticated;

-- Closes sessions that have run their course, with the reason.
create or replace function public.follow_tidy()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.follow_sessions s
     set ended_at = now(),
         end_reason = case
           when not public.follow_on_shift(s.subject_id) then 'clocked_out'
           when s.expires_at <= now() then 'expired'
           else 'closed' end
   where s.ended_at is null
     and not public.follow_session_live(s);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.follow_tidy() from public, anon, authenticated;

create or replace function public.follow_active_count()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.follow_sessions s
  where s.ended_at is null and public.follow_session_live(s);
$$;
revoke all on function public.follow_active_count() from public, anon, authenticated;

-- What the page shows about a session.
create or replace function public.follow_state(p_session uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', s.id,
    'subject_id', s.subject_id,
    'active', public.follow_session_live(s),
    'started_at', s.started_at,
    'expires_at', s.expires_at,
    'ended_at', s.ended_at,
    'end_reason', s.end_reason,
    'extended', s.extended,
    'interval_ms', public.follow_fast_interval_ms(),
    'topic', public.follow_topic(s.id),
    'server_now', now(),
    'clocked_out_at', (select a.created_at from public.attendance a
                       where a.user_id = s.subject_id and a.attendance_date = public.business_date()
                         and a.type = 'closing' order by a.created_at limit 1),
    'live', case when s.last_at is null then null else jsonb_build_object(
      'lat', s.last_lat, 'lng', s.last_lng, 'accuracy_m', s.last_accuracy_m,
      'heading', s.last_heading, 'speed_mps', s.last_speed_mps, 'at', s.last_at) end,
    'last_ping', (select jsonb_build_object('lat', p.lat, 'lng', p.lng, 'accuracy_m', p.accuracy_m,
                                            'at', p.created_at, 'place_name', p.place_name)
                  from public.location_pings p
                  where p.user_id = s.subject_id
                    and p.created_at >= (public.business_date()::timestamp at time zone 'Africa/Lagos')
                  order by p.created_at desc limit 1),
    'last_place', (select p.place_name from public.location_pings p
                   where p.user_id = s.subject_id and p.place_name is not null
                     and p.created_at >= (public.business_date()::timestamp at time zone 'Africa/Lagos')
                   order by p.created_at desc limit 1)
  )
  from public.follow_sessions s where s.id = p_session;
$$;
revoke all on function public.follow_state(uuid) from public, anon, authenticated;

-- The session, if the caller is the one following.
create or replace function public.follow_mine(p_session uuid)
returns public.follow_sessions language plpgsql stable security definer set search_path = public as $$
declare s public.follow_sessions;
begin
  select * into s from public.follow_sessions where id = p_session and watcher_id = auth.uid();
  if s.id is null then
    raise exception 'This live view is not yours, or no longer exists' using hint = 'follow_not_found';
  end if;
  return s;
end;
$$;
revoke all on function public.follow_mine(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Start, check in, keep following, stop: for the person following.
-- ---------------------------------------------------------------------
create or replace function public.follow_start(p_subject uuid)
returns jsonb language plpgsql security definer set search_path = public, realtime as $$
declare
  me uuid := auth.uid();
  s public.follow_sessions;
  cap integer;
  who text;
begin
  if me is null or not exists (
       select 1 from public.profiles where id = me and is_active and role in ('admin', 'supervisor')) then
    raise exception 'Only admins and supervisors can follow someone live' using hint = 'follow_forbidden';
  end if;
  if not (public.is_admin() or public.supervises_user(p_subject)) then
    raise exception 'You can only follow people on your own team' using hint = 'follow_forbidden';
  end if;
  perform public.follow_tidy();
  if not public.follow_on_shift(p_subject) then
    raise exception 'They are not clocked in, so they cannot be followed live' using hint = 'not_on_shift';
  end if;

  -- The same person already followed from this account: carry on with it.
  select * into s from public.follow_sessions
  where watcher_id = me and subject_id = p_subject and ended_at is null
  order by started_at desc limit 1;
  if s.id is not null then
    update public.follow_sessions set last_seen_at = now() where id = s.id;
    return public.follow_state(s.id) || jsonb_build_object('resumed', true);
  end if;

  select follow_max_sessions into cap from public.system_settings limit 1;
  cap := coalesce(cap, 20);
  if public.follow_active_count() >= cap then
    raise exception 'Too many people are being followed live right now (% at most). Try again in a few minutes.', cap
      using hint = 'follow_cap';
  end if;

  insert into public.follow_sessions (watcher_id, subject_id, expires_at)
  values (me, p_subject, now() + public.follow_window())
  returning * into s;

  select full_name into who from public.profiles where id = p_subject;
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (me, 'follow.start', 'profiles', p_subject,
          jsonb_build_object('session_id', s.id, 'name', who, 'until', s.expires_at));

  -- Nudge their phone, if the app is open, to send a position now. The
  -- event carries nothing.
  perform realtime.send('{}'::jsonb, 'sync', public.field_topic(p_subject), true);

  return public.follow_state(s.id) || jsonb_build_object('resumed', false);
end;
$$;
revoke all on function public.follow_start(uuid) from public, anon;
grant execute on function public.follow_start(uuid) to authenticated;

-- The follow page checks in every ~20 seconds; the answer says whether it
-- is still on, and the latest positions (for when Realtime is not there).
create or replace function public.follow_heartbeat(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.follow_sessions := public.follow_mine(p_session);
begin
  perform public.follow_tidy();
  update public.follow_sessions set last_seen_at = now()
  where id = s.id and ended_at is null;
  return public.follow_state(s.id);
end;
$$;
revoke all on function public.follow_heartbeat(uuid) from public, anon;
grant execute on function public.follow_heartbeat(uuid) to authenticated;

-- "Keep following": another 30 minutes from now. Works while it is on, or
-- once it has run out; not after a stop, a closed page or a clock-out.
create or replace function public.follow_extend(p_session uuid)
returns jsonb language plpgsql security definer set search_path = public, realtime as $$
declare
  s public.follow_sessions := public.follow_mine(p_session);
  cap integer;
begin
  perform public.follow_tidy();
  select * into s from public.follow_sessions where id = s.id;
  if not public.follow_on_shift(s.subject_id) then
    raise exception 'They have clocked out, so they cannot be followed live' using hint = 'not_on_shift';
  end if;
  if s.ended_at is not null and s.end_reason <> 'expired' then
    raise exception 'This live view has ended. Start following again.' using hint = 'follow_ended';
  end if;
  if s.ended_at is not null then
    select follow_max_sessions into cap from public.system_settings limit 1;
    if public.follow_active_count() >= coalesce(cap, 20) then
      raise exception 'Too many people are being followed live right now (% at most). Try again in a few minutes.',
        coalesce(cap, 20) using hint = 'follow_cap';
    end if;
  end if;
  update public.follow_sessions
     set expires_at = now() + public.follow_window(), last_seen_at = now(),
         ended_at = null, end_reason = null, extended = extended + 1
   where id = s.id
  returning * into s;
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'follow.extend', 'profiles', s.subject_id,
          jsonb_build_object('session_id', s.id, 'until', s.expires_at, 'times', s.extended));
  perform realtime.send('{}'::jsonb, 'sync', public.field_topic(s.subject_id), true);
  return public.follow_state(s.id);
end;
$$;
revoke all on function public.follow_extend(uuid) from public, anon;
grant execute on function public.follow_extend(uuid) to authenticated;

-- Stop button ('stopped') or the page being closed ('closed').
create or replace function public.follow_stop(p_session uuid, p_reason text default 'stopped')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.follow_sessions := public.follow_mine(p_session);
  why text := case when p_reason = 'closed' then 'closed' else 'stopped' end;
begin
  if s.ended_at is null then
    update public.follow_sessions set ended_at = now(), end_reason = why where id = s.id;
    insert into public.audit_log (actor_id, action, target_table, target_id, meta)
    values (auth.uid(), 'follow.stop', 'profiles', s.subject_id,
            jsonb_build_object('session_id', s.id, 'reason', why,
                               'minutes', round(extract(epoch from (now() - s.started_at)) / 60.0, 1)));
  end if;
  return public.follow_state(s.id);
end;
$$;
revoke all on function public.follow_stop(uuid, text) from public, anon;
grant execute on function public.follow_stop(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- The phone's side (service role: the location routes).
-- ---------------------------------------------------------------------

-- The fast interval while someone follows this person live, else null.
create or replace function public.follow_interval_for(p_user uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from public.follow_sessions s
    where s.subject_id = p_user and s.ended_at is null and public.follow_session_live(s)
  ) then public.follow_fast_interval_ms() end;
$$;
revoke all on function public.follow_interval_for(uuid) from public, anon, authenticated;
grant execute on function public.follow_interval_for(uuid) to service_role;

-- One fast position: kept on the live session(s) and broadcast to the
-- person following; never a location_pings row. Returns the interval to
-- keep sending at, or null to go back to normal.
create or replace function public.follow_live_position_for(
  p_user uuid, p_lat double precision, p_lng double precision, p_accuracy_m double precision,
  p_heading double precision default null, p_speed_mps double precision default null,
  p_captured_at timestamptz default null, p_is_mock boolean default false
) returns integer
language plpgsql security definer set search_path = public, realtime as $$
declare
  fast integer := public.follow_interval_for(p_user);
  taken timestamptz := least(coalesce(p_captured_at, now()), now());
  s record;
  msg jsonb;
begin
  if fast is null then return null; end if;
  -- A fake-location reading, a nonsense one or an old one is not shown.
  if coalesce(p_is_mock, false)
     or p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180
     or p_accuracy_m is null or p_accuracy_m < 0
     or taken < now() - interval '2 minutes' then
    return fast;
  end if;
  -- Two senders on one phone (the open page and the native tracker):
  -- one position every few seconds is plenty.
  if exists (select 1 from public.follow_sessions x
             where x.subject_id = p_user and x.ended_at is null
               and x.last_at > now() - interval '3 seconds') then
    return fast;
  end if;
  msg := jsonb_build_object(
    'lat', p_lat, 'lng', p_lng, 'accuracy_m', p_accuracy_m,
    'heading', case when p_heading between 0 and 360 then p_heading end,
    'speed_mps', case when p_speed_mps >= 0 and p_speed_mps < 100 then p_speed_mps end,
    'at', taken);
  for s in
    update public.follow_sessions x
       set last_lat = p_lat, last_lng = p_lng, last_accuracy_m = p_accuracy_m,
           last_heading = (msg->>'heading')::float8, last_speed_mps = (msg->>'speed_mps')::float8,
           last_at = taken
     where x.subject_id = p_user and x.ended_at is null and public.follow_session_live(x)
    returning x.id
  loop
    perform realtime.send(msg, 'position', public.follow_topic(s.id), true);
  end loop;
  return fast;
end;
$$;
revoke all on function public.follow_live_position_for(uuid, double precision, double precision, double precision,
  double precision, double precision, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.follow_live_position_for(uuid, double precision, double precision, double precision,
  double precision, double precision, timestamptz, boolean) to service_role;

-- ---------------------------------------------------------------------
-- Clock-out ends every live view of the person, and tells the page.
-- ---------------------------------------------------------------------
create or replace function public.follow_end_at_clock_out()
returns trigger language plpgsql security definer set search_path = public, realtime as $$
declare s record;
begin
  if new.type = 'closing' then
    for s in
      update public.follow_sessions
         set ended_at = now(), end_reason = 'clocked_out'
       where subject_id = new.user_id and ended_at is null
      returning id
    loop
      perform realtime.send(jsonb_build_object('reason', 'clocked_out', 'at', new.created_at),
                            'ended', public.follow_topic(s.id), true);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists trg_follow_end_at_clock_out on public.attendance;
create trigger trg_follow_end_at_clock_out
  after insert on public.attendance
  for each row execute function public.follow_end_at_clock_out();

-- ---------------------------------------------------------------------
-- Realtime: only the person following hears `follow:<session id>`.
-- ---------------------------------------------------------------------
create or replace function public.can_hear_follow(p_topic text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_topic like 'follow:%' and exists (
    select 1 from public.follow_sessions s
    where public.follow_topic(s.id) = p_topic and s.watcher_id = auth.uid());
$$;
revoke all on function public.can_hear_follow(text) from public, anon;
grant execute on function public.can_hear_follow(text) to authenticated;

drop policy if exists "Followers read their own follow topic" on realtime.messages;
create policy "Followers read their own follow topic"
  on realtime.messages
  for select
  to authenticated
  using ( public.can_hear_follow(realtime.topic()) );

-- ---------------------------------------------------------------------
-- Test-mode reset (0066): live views go with clock-ins and locations.
-- ---------------------------------------------------------------------
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
    'leave_schedules:work_patterns', 'support:support_messages', 'support:support_threads',
    'notifications:notification_deliveries', 'notifications:scheduled_notifications',
    'notifications:notifications', 'activity:user_activity', 'ask:assistant_conversations',
    'stores:xm_stores', 'stores:outlets', 'audit:audit_log'
  ]) with ordinality as v(x, n);
$$;

select 'follow live (0070) installed' as result;
