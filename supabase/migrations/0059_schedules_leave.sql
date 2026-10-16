-- =====================================================================
-- 0059: Work schedules (days on, days off) and leave
--
--   * work_patterns: the weekdays each merchandiser or marketer works.
--     Nobody listed works Monday to Saturday (default_work_days()).
--   * schedule_overrides: one date made a working day or a day off, with
--     an optional note.
--   * leave_requests: leave a member of staff asks for in the app, and
--     the supervisor's or an admin's decision.
--   * day_kind(user, day): 'leave', 'off' or 'working', from approved
--     leave, then an override, then the weekly pattern. Everything that
--     decides absence uses it: is_working_day(), my_calendar(), the
--     no-show sweep, the absentee list and the overview count.
--
-- Admins set schedules for anyone; a supervisor for their own team
-- (supervises_user). Staff read their own schedule and leave only. Every
-- write goes through a SECURITY DEFINER function below, and every change
-- made by an admin or supervisor writes an audit row in the same
-- transaction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.work_patterns (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Days of the week worked, as extract(dow): 0 = Sunday … 6 = Saturday.
  days smallint[] not null
    check (days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[] and cardinality(days) <= 7),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.work_patterns enable row level security;

create table if not exists public.schedule_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  -- true: an extra day in; false: an extra day off.
  working boolean not null,
  note text not null default '' check (length(note) <= 300),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists schedule_overrides_by_day on public.schedule_overrides (day);
alter table public.schedule_overrides enable row level security;

create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('annual', 'sick', 'casual', 'other')),
  from_date date not null,
  to_date date not null,
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (length(decision_note) <= 500),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  check (to_date >= from_date)
);
create index if not exists leave_requests_by_user on public.leave_requests (user_id, from_date);
create index if not exists leave_requests_by_status on public.leave_requests (status, from_date);
alter table public.leave_requests enable row level security;

-- Admins everything; a supervisor their own team; anyone their own rows.
-- Nobody writes directly: only the functions below do.
drop policy if exists work_patterns_read on public.work_patterns;
create policy work_patterns_read on public.work_patterns
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));

drop policy if exists schedule_overrides_read on public.schedule_overrides;
create policy schedule_overrides_read on public.schedule_overrides
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));

drop policy if exists leave_requests_read on public.leave_requests;
create policy leave_requests_read on public.leave_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));

revoke all on public.work_patterns, public.schedule_overrides, public.leave_requests from anon, authenticated;
grant select on public.work_patterns, public.schedule_overrides, public.leave_requests to authenticated;

-- The leave list on the dashboard: the request with the person's name and
-- store, and who decided it. security_invoker, so RLS above applies.
create or replace view public.leave_request_detail
with (security_invoker = true) as
  select l.*,
         p.full_name as staff_name,
         p.role as staff_role,
         o.name as outlet_name,
         p.supervisor_id,
         d.full_name as decided_by_name,
         (l.to_date - l.from_date + 1) as days
  from public.leave_requests l
  join public.profiles p on p.id = l.user_id
  left join public.outlets o on o.id = p.outlet_id
  left join public.profiles d on d.id = l.decided_by;
grant select on public.leave_request_detail to authenticated;

-- ---------------------------------------------------------------------
-- What a day is for someone
-- ---------------------------------------------------------------------
create or replace function public.default_work_days()
returns smallint[] language sql immutable as $$
  select array[1, 2, 3, 4, 5, 6]::smallint[];
$$;
grant execute on function public.default_work_days() to authenticated, service_role;

-- 'leave' (approved leave covers it), else the override, else the weekly
-- pattern ('working' or 'off'). No permission check: only other SECURITY
-- DEFINER functions and the service role call it.
create or replace function public.day_kind(p_user uuid, p_day date)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.leave_requests l
                 where l.user_id = p_user and l.status = 'approved'
                   and p_day between l.from_date and l.to_date)
      then 'leave'
    else coalesce(
      (select case when o.working then 'working' else 'off' end
         from public.schedule_overrides o
        where o.user_id = p_user and o.day = p_day),
      case when extract(dow from p_day)::smallint = any (
             coalesce((select w.days from public.work_patterns w where w.user_id = p_user),
                      public.default_work_days()))
           then 'working' else 'off' end)
  end;
$$;
revoke all on function public.day_kind(uuid, date) from public, anon, authenticated;
grant execute on function public.day_kind(uuid, date) to service_role;

-- Whether someone is expected at work on a day. Null for a person the
-- caller may not see (someone else, outside a supervisor's team).
create or replace function public.is_working_day(p_user uuid, p_day date)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_user = auth.uid() or public.is_admin() or public.supervises_user(p_user)
      then public.day_kind(p_user, p_day) = 'working'
  end;
$$;
revoke all on function public.is_working_day(uuid, date) from public, anon;
grant execute on function public.is_working_day(uuid, date) to authenticated, service_role;

-- The signed-in person's own days, for the calendars in the staff app.
-- missed: a past working day (not today), on or after the day the account
-- was made, with no clock-in.
create or replace function public.my_calendar(p_from date, p_to date)
returns table (day date, kind text, clocked_in boolean, missed boolean)
language sql stable security definer set search_path = public as $$
  with me as (
    select p.id, (p.created_at at time zone 'Africa/Lagos')::date as since
    from public.profiles p where p.id = auth.uid()
  ),
  days as (
    select d::date as day
    from generate_series(p_from, least(p_to, p_from + 92), interval '1 day') d
  )
  select d.day,
         public.day_kind(me.id, d.day),
         exists (select 1 from public.attendance a
                 where a.user_id = me.id and a.attendance_date = d.day and a.type = 'opening'),
         (d.day < public.business_date()
          and d.day >= me.since
          and public.day_kind(me.id, d.day) = 'working'
          and not exists (select 1 from public.attendance a
                          where a.user_id = me.id and a.attendance_date = d.day and a.type = 'opening'))
  from days d cross join me
  where p_from is not null and p_to is not null and p_to >= p_from
  order by d.day;
$$;
revoke all on function public.my_calendar(date, date) from public, anon;
grant execute on function public.my_calendar(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Who may set someone's schedule or decide their leave
-- ---------------------------------------------------------------------
create or replace function public.can_manage_schedule(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.is_field_role(p.role)
            and (public.is_admin() or public.supervises_user(p.id))
       from public.profiles p where p.id = p_user),
    false);
$$;
revoke all on function public.can_manage_schedule(uuid) from public, anon;
grant execute on function public.can_manage_schedule(uuid) to authenticated, service_role;

-- Shared checks for the schedule writers.
create or replace function public.schedule_guard(p_user uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
declare
  target_role user_role;
begin
  if not (public.is_admin() or public.current_user_role() = 'supervisor') then
    raise exception 'Only admins and supervisors set schedules';
  end if;
  select role into target_role from public.profiles where id = p_user;
  if target_role is null then
    raise exception 'That person was not found';
  end if;
  if not public.is_field_role(target_role) then
    raise exception 'Schedules are for merchandisers and marketers';
  end if;
  if not public.can_manage_schedule(p_user) then
    raise exception 'You can only set schedules for your own team';
  end if;
end;
$$;
revoke all on function public.schedule_guard(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Weekly pattern: one set of weekdays for one or many people at once.
-- p_days null puts them back on the default (Monday to Saturday).
-- ---------------------------------------------------------------------
create or replace function public.set_work_pattern(p_users uuid[], p_days smallint[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  t uuid;
  clean smallint[];
  before smallint[];
  n integer := 0;
begin
  if p_users is null or cardinality(p_users) = 0 then
    raise exception 'Pick at least one person';
  end if;
  if cardinality(p_users) > 500 then
    raise exception 'Set at most 500 people at a time';
  end if;
  if p_days is not null then
    if not (p_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]) then
      raise exception 'Days of the week run from Sunday (0) to Saturday (6)';
    end if;
    select coalesce(array_agg(distinct d order by d), '{}') into clean from unnest(p_days) d;
  end if;

  -- All or nothing: check everyone before changing anyone.
  foreach t in array p_users loop
    perform public.schedule_guard(t);
  end loop;

  for t in select distinct u from unnest(p_users) u loop
    select days into before from public.work_patterns where user_id = t;
    if p_days is null then
      delete from public.work_patterns where user_id = t;
    else
      insert into public.work_patterns (user_id, days, updated_by, updated_at)
      values (t, clean, auth.uid(), now())
      on conflict (user_id) do update
        set days = excluded.days, updated_by = excluded.updated_by, updated_at = now();
    end if;
    insert into public.audit_log (actor_id, action, target_table, target_id, meta)
    values (auth.uid(), 'schedule.pattern', 'profiles', t,
            jsonb_build_object('days', coalesce(to_jsonb(clean), to_jsonb(public.default_work_days())),
                               'default', p_days is null,
                               'before', coalesce(to_jsonb(before), to_jsonb(public.default_work_days())),
                               'people', cardinality(p_users)));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.set_work_pattern(uuid[], smallint[]) from public, anon;
grant execute on function public.set_work_pattern(uuid[], smallint[]) to authenticated;

-- ---------------------------------------------------------------------
-- One date: an extra day in, or an extra day off. Replaces any override
-- already on that date. From 60 days back to a year ahead.
-- ---------------------------------------------------------------------
create or replace function public.set_schedule_override(
  p_user uuid, p_day date, p_working boolean, p_note text default ''
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  clean text := btrim(coalesce(p_note, ''));
begin
  perform public.schedule_guard(p_user);
  if p_day is null or p_working is null then
    raise exception 'Pick a date and whether it is a working day or a day off';
  end if;
  if p_day < public.business_date() - 60 then
    raise exception 'That date is too far in the past';
  end if;
  if p_day > public.business_date() + 366 then
    raise exception 'Pick a date within the next year';
  end if;
  if length(clean) > 300 then
    raise exception 'Keep the note under 300 characters';
  end if;

  insert into public.schedule_overrides (user_id, day, working, note, created_by, created_at)
  values (p_user, p_day, p_working, clean, auth.uid(), now())
  on conflict (user_id, day) do update
    set working = excluded.working, note = excluded.note,
        created_by = excluded.created_by, created_at = now()
  returning id into new_id;

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'schedule.override', 'profiles', p_user,
          jsonb_build_object('day', p_day, 'working', p_working, 'note', clean, 'override_id', new_id));
  return new_id;
end;
$$;
revoke all on function public.set_schedule_override(uuid, date, boolean, text) from public, anon;
grant execute on function public.set_schedule_override(uuid, date, boolean, text) to authenticated;

create or replace function public.remove_schedule_override(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  o public.schedule_overrides;
begin
  select * into o from public.schedule_overrides where id = p_id;
  if o.id is null then
    raise exception 'That date change was not found';
  end if;
  perform public.schedule_guard(o.user_id);
  delete from public.schedule_overrides where id = p_id;
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'schedule.override_remove', 'profiles', o.user_id,
          jsonb_build_object('day', o.day, 'working', o.working, 'note', o.note));
end;
$$;
revoke all on function public.remove_schedule_override(uuid) from public, anon;
grant execute on function public.remove_schedule_override(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------

-- A member of staff asks for leave. Dates are whole days, both included;
-- the start may be up to 7 days back (sick leave is often asked for after),
-- the end at most a year ahead, and one request covers at most 60 days.
-- Refused when it overlaps a request still waiting or already approved.
create or replace function public.apply_leave(
  p_kind text, p_from date, p_to date, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  today date := public.business_date();
  clean text := btrim(coalesce(p_reason, ''));
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.is_active then
    raise exception 'Sign in again to ask for leave';
  end if;
  if not public.is_field_role(me.role) then
    raise exception 'Leave requests are for merchandisers and marketers';
  end if;
  if p_kind is null or p_kind not in ('annual', 'sick', 'casual', 'other') then
    raise exception 'Pick the type of leave';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Pick the first and last day of your leave';
  end if;
  if p_to < p_from then
    raise exception 'The last day cannot be before the first day';
  end if;
  if p_from < today - 7 then
    raise exception 'Leave can start at most 7 days ago';
  end if;
  if p_to > today + 365 then
    raise exception 'Pick dates within the next year';
  end if;
  if p_to - p_from + 1 > 60 then
    raise exception 'One request can cover at most 60 days';
  end if;
  if length(clean) < 3 then
    raise exception 'Say why you need the leave';
  end if;
  if length(clean) > 1000 then
    raise exception 'Keep the reason under 1000 characters';
  end if;

  -- One at a time per person, so two requests sent together cannot both pass.
  perform 1 from public.profiles where id = me.id for update;
  if exists (select 1 from public.leave_requests l
             where l.user_id = me.id and l.status in ('pending', 'approved')
               and l.from_date <= p_to and l.to_date >= p_from) then
    raise exception 'You already have leave asked for or approved on some of those days';
  end if;

  insert into public.leave_requests (user_id, kind, from_date, to_date, reason)
  values (me.id, p_kind, p_from, p_to, clean)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.apply_leave(text, date, date, text) from public, anon;
grant execute on function public.apply_leave(text, date, date, text) to authenticated;

-- The person who asked may withdraw a request still waiting.
create or replace function public.cancel_leave(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_requests;
begin
  select * into l from public.leave_requests where id = p_id for update;
  if l.id is null or l.user_id <> auth.uid() then
    raise exception 'That request was not found';
  end if;
  if l.status <> 'pending' then
    raise exception 'Only a request still waiting can be cancelled';
  end if;
  update public.leave_requests set status = 'cancelled', cancelled_at = now() where id = p_id;
end;
$$;
revoke all on function public.cancel_leave(uuid) from public, anon;
grant execute on function public.cancel_leave(uuid) to authenticated;

-- The person's supervisor or any admin approves or rejects. Never their
-- own. Returns what the route needs to tell the person.
create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_requests;
  clean text := btrim(coalesce(p_note, ''));
  outcome text;
begin
  if not (public.is_admin() or public.current_user_role() = 'supervisor') then
    raise exception 'Only admins and supervisors decide leave';
  end if;
  if p_approve is null then
    raise exception 'Approve or reject the request';
  end if;
  select * into l from public.leave_requests where id = p_id for update;
  if l.id is null then
    raise exception 'That request was not found';
  end if;
  if l.user_id = auth.uid() then
    raise exception 'You cannot decide your own leave';
  end if;
  if not (public.is_admin() or public.supervises_user(l.user_id)) then
    raise exception 'You can only decide leave for your own team';
  end if;
  if l.status = 'cancelled' then
    raise exception 'That request was cancelled';
  end if;
  if l.status <> 'pending' then
    raise exception 'That request has already been decided';
  end if;
  if length(clean) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  outcome := case when p_approve then 'approved' else 'rejected' end;
  update public.leave_requests
     set status = outcome, decided_by = auth.uid(), decided_at = now(), decision_note = clean
   where id = p_id;

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), case when p_approve then 'leave.approve' else 'leave.reject' end,
          'leave_requests', p_id,
          jsonb_build_object('user_id', l.user_id, 'kind', l.kind, 'from', l.from_date,
                             'to', l.to_date, 'note', clean));

  return jsonb_build_object('id', l.id, 'user_id', l.user_id, 'status', outcome, 'kind', l.kind,
                            'from_date', l.from_date, 'to_date', l.to_date, 'note', clean);
end;
$$;
revoke all on function public.decide_leave(uuid, boolean, text) from public, anon;
grant execute on function public.decide_leave(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------
-- Absence follows the schedule: nobody is a no-show, an absentee or
-- counted absent on a day off or on leave.
-- ---------------------------------------------------------------------
create or replace function public.staff_no_show(p_grace_minutes integer default 30)
returns table (
  user_id uuid,
  full_name text,
  phone text,
  outlet_id uuid,
  outlet_name text,
  shift_start time,
  minutes_late integer
)
language sql stable security definer set search_path = public as $$
  with now_local as (
    select (now() at time zone 'Africa/Lagos') as ts
  )
  select
    p.id,
    p.full_name,
    p.phone,
    o.id,
    o.name,
    o.shift_start,
    (extract(epoch from ((select ts from now_local) - ((select ts from now_local)::date + o.shift_start))) / 60)::int
  from public.profiles p
  join public.outlets o on o.id = p.outlet_id
  where p.is_active
    and public.is_field_role(p.role)
    and o.is_active
    and (select ts from now_local)
        >= ((select ts from now_local)::date + o.shift_start + make_interval(mins => greatest(0, p_grace_minutes)))
    and public.day_kind(p.id, public.business_date()) = 'working'
    and not exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by o.name, p.full_name;
$$;
revoke all on function public.staff_no_show(integer) from public, anon;
grant execute on function public.staff_no_show(integer) to authenticated, service_role;

create or replace function public.absentees_today()
returns table (user_id uuid, full_name text, phone text, outlet_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone, o.name
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  where p.is_active
    and public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id))
    and public.day_kind(p.id, public.business_date()) = 'working'
    and not exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by p.full_name;
$$;

create or replace function public.admin_overview()
returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select public.business_date() as d),
  staff as (
    select p.id, p.full_name, o.shift_start,
           public.day_kind(p.id, (select d from today)) = 'working' as expected
    from public.profiles p
    left join public.outlets o on o.id = p.outlet_id
    where p.is_active and public.is_field_role(p.role)
  ),
  openings as (
    select a.user_id, a.created_at, a.status
    from public.attendance a, today
    where a.attendance_date = today.d and a.type = 'opening'
  ),
  closings as (
    select a.user_id from public.attendance a, today
    where a.attendance_date = today.d and a.type = 'closing'
  )
  select jsonb_build_object(
    'date',            (select d from today),
    'staff_total',     (select count(*) from staff),
    'clocked_in',      (select count(*) from openings),
    'clocked_out',     (select count(*) from closings),
    'still_on_shift',  (select count(*) from openings o
                        where not exists (select 1 from closings c where c.user_id = o.user_id)),
    'absent',          (select count(*) from staff s
                        where s.expected
                          and not exists (select 1 from openings o where o.user_id = s.id)),
    'not_expected',    (select count(*) from staff s where not s.expected),
    'late',            (select count(*) from openings o
                        join staff s on s.id = o.user_id
                        where s.shift_start is not null
                          and (o.created_at at time zone 'Africa/Lagos')::time > s.shift_start),
    'off_site',        (select count(*) from openings where status <> 'on_site'),
    'open_alerts',     (select count(*) from public.location_alerts where not is_resolved)
  )
  where public.is_admin() or public.current_user_role() = 'supervisor';
$$;

select 'Work schedules and leave (059) installed' as result;
