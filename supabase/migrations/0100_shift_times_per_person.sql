-- =====================================================================
-- XTEND migration 0100 — working hours belong to the person, not the store
--
-- Clock-in and clock-out times were set on each store, and a person was
-- measured against their home store's. Marketers work across many stores,
-- so the time is now the person's: a marketer due at 9:00 is due at 9:00
-- wherever their first store is, and every store visit after that is
-- recorded with its own check-in and check-out time.
--
--   * profiles.shift_start / shift_end (default 08:00 / 18:00). When the
--     columns are first added, each person gets their home store's current
--     times, so nobody's day changes until the office changes it;
--   * shift_start_for / shift_end_for read the person's times, and so do
--     the late and early flags, the overview, staff analytics, the no-show
--     sweep (marketers with no home store included), Home (my_day.shift)
--     and attendance_detail (its shift_start, shift_end and is_late);
--   * staff cannot change their own hours (profiles_self_guard);
--   * the stores' own shift columns stay, unused, so nothing old breaks.
--
-- Rerunnable: the one-time copy runs only when the columns are added.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'shift_start') then
    alter table public.profiles
      add column shift_start time not null default time '08:00',
      add column shift_end time not null default time '18:00';
    update public.profiles p
       set shift_start = o.shift_start, shift_end = o.shift_end
      from public.outlets o
     where o.id = p.outlet_id and o.shift_start is not null and o.shift_end is not null
       and o.shift_end > o.shift_start;
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_shift_order;
alter table public.profiles add constraint profiles_shift_order check (shift_end > shift_start) not valid;

comment on column public.profiles.shift_start is 'When this person''s working day starts (Lagos time), wherever they clock in (0100).';
comment on column public.profiles.shift_end is 'When this person''s working day ends (Lagos time) (0100).';

create or replace function public.shift_start_for(p_user uuid)
returns time
language sql stable security definer set search_path = public as $$
  select coalesce((select p.shift_start from public.profiles p where p.id = p_user), time '08:00');
$$;

create or replace function public.shift_end_for(p_user uuid)
returns time
language sql stable security definer set search_path = public as $$
  select coalesce((select p.shift_end from public.profiles p where p.id = p_user), time '18:00');
$$;

-- Attendance rows carry the person's hours, and "late" is measured by them.
create or replace view public.attendance_detail
with (security_invoker = true) as
 select a.id,
    a.user_id,
    p.full_name as staff_name,
    p.phone as staff_phone,
    a.attendance_date,
    a.type,
    a.created_at,
    to_char((a.created_at at time zone 'Africa/Lagos'), 'YYYY-MM-DD HH24:MI') as local_time,
    a.outlet_id,
    o.name as outlet_name,
    p.shift_start,
    p.shift_end,
    a.address,
    a.place_name,
    a.place_source,
    coalesce(nullif(trim(both ', ' from concat_ws(', ', a.place_name, nullif(a.address, a.place_name))), ''), a.address,
             ((round((a.lat)::numeric, 5) || ', ') || round((a.lng)::numeric, 5))) as location_label,
    a.lat,
    a.lng,
    a.accuracy_m,
    a.distance_m,
    a.outlet_lat,
    a.outlet_lng,
    a.outlet_radius_m,
    a.status,
    a.selfie_path,
    a.thumb_path,
    a.device_info,
    a.client_captured_at,
    case
      when a.type = 'opening' and p.shift_start is not null
           and (a.created_at at time zone 'Africa/Lagos')::time > p.shift_start then true
      else false
    end as is_late
   from public.attendance a
     join public.profiles p on p.id = a.user_id
     left join public.outlets o on o.id = a.outlet_id;


-- Staff cannot change their own hours.
create or replace function public.profiles_self_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or new.id <> auth.uid() then
    return new;
  end if;
  new.role          := old.role;
  new.staff_role_id := old.staff_role_id;
  new.outlet_id     := old.outlet_id;
  new.supervisor_id := old.supervisor_id;
  new.is_active     := old.is_active;
  new.push_exempt   := old.push_exempt;
  new.app_only      := old.app_only;
  -- 0100: their working hours are set by the office.
  new.shift_start   := old.shift_start;
  new.shift_end     := old.shift_end;
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;

-- Late and early flags against the person's own hours.
create or replace function public.attendance_punctuality()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  shift record;
  -- When the photo was taken, which is when they clocked: a clock-in made
  -- offline and sent later is not late for having waited for signal.
  -- (A phone clock moved to look punctual is flagged by 026.)
  at_local timestamp := (coalesce(new.client_captured_at, new.created_at) at time zone 'Africa/Lagos');
  minutes integer;
begin
  if new.user_id is null then
    return null;
  end if;

  -- 0100: the person's own hours, wherever they clock; the store they
  -- clocked at (or their home store) only names where.
  select p.shift_start, p.shift_end,
         o.id, o.name
    into shift
  from public.profiles p
  left join public.outlets o on o.id = coalesce(new.outlet_id, p.outlet_id)
  where p.id = new.user_id;
  if shift.shift_start is null or shift.shift_end is null then
    return null;
  end if;

  if new.type = 'opening' then
    minutes := floor(extract(epoch from at_local - (new.attendance_date + shift.shift_start)) / 60);
    if minutes > public.punctuality_grace_minutes() then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'late_clock_in', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked in %s late%s (their day starts %s)',
                     public.minutes_label(minutes), coalesce(' at ' || shift.name, ''), to_char(shift.shift_start, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  elsif new.type = 'closing' then
    minutes := floor(extract(epoch from (new.attendance_date + shift.shift_end) - at_local) / 60);
    if minutes > public.punctuality_grace_minutes() then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'early_clock_out', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked out %s early%s (their day ends %s)',
                     public.minutes_label(minutes), coalesce(' at ' || shift.name, ''), to_char(shift.shift_end, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  end if;
  return null;
end;
$$;

-- The overview's late count.
create or replace function public.admin_overview()
returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select public.business_date() as d),
  staff as (
    select p.id, p.full_name, p.shift_start,
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

-- Days late, against the person's own start.
create or replace function public.staff_analytics(p_from date, p_to date)
returns table (user_id uuid, full_name text, outlet_name text, days_present integer,
               days_late integer, days_off_site integer, avg_distance_m double precision)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    o.name,
    count(*) filter (where a.type = 'opening')::int,
    count(*) filter (
      where a.type = 'opening' and p.shift_start is not null
        and (a.created_at at time zone 'Africa/Lagos')::time > p.shift_start
    )::int,
    count(*) filter (where a.type = 'opening' and a.status <> 'on_site')::int,
    round(avg(a.distance_m) filter (where a.type = 'opening')::numeric, 1)::double precision
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  left join public.attendance a
    on a.user_id = p.id and a.attendance_date between p_from and p_to
  where public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id) or public.hr_sees(p.id))
  group by p.id, p.full_name, o.name
  order by p.full_name;
$$;

-- Not clocked in by their own start: marketers with no home store included.
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
    p.shift_start,
    (extract(epoch from ((select ts from now_local) - ((select ts from now_local)::date + p.shift_start))) / 60)::int
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  where p.is_active
    and public.is_field_role(p.role)
    and (o.id is null or o.is_active)
    and (select ts from now_local)
        >= ((select ts from now_local)::date + p.shift_start + make_interval(mins => greatest(0, p_grace_minutes)))
    and public.day_kind(p.id, public.business_date()) = 'working'
    and not exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by o.name nulls last, p.full_name;
$$;

-- Home shows the person's own hours.
create or replace function public.my_day()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'date', public.business_date(),
    'can_file_report', public.can_file_report(),
    -- 0100: the person's own working hours, store or none.
    'shift', (
      select jsonb_build_object('start', p.shift_start, 'end', p.shift_end)
      from public.profiles p where p.id = auth.uid()
    ),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'role', p.role,
        'must_change_password', p.must_change_password, 'is_active', p.is_active
      ) from public.profiles p where p.id = auth.uid()
    ),
    'outlet', (
      select jsonb_build_object(
        'id', o.id, 'name', o.name, 'address', o.address,
        'lat', o.lat, 'lng', o.lng, 'radius_m', o.geofence_radius_m,
        'shift_start', p.shift_start, 'shift_end', p.shift_end
      )
      from public.outlets o
      join public.profiles p on p.outlet_id = o.id
      where p.id = auth.uid()
    ),
    'opening', (
      select jsonb_build_object('id', a.id, 'at', a.created_at, 'status', a.status,
                                'distance_m', a.distance_m, 'address', a.address)
      from public.attendance a
      where a.user_id = auth.uid() and a.attendance_date = public.business_date()
        and a.type = 'opening'
        and not exists (select 1 from public.field_corrections c where c.user_id = auth.uid()
                        and c.status = 'open' and c.action = 'redo_clock_in'
                        and c.correction_date = public.business_date())
    ),
    'closing', (
      select jsonb_build_object('id', a.id, 'at', a.created_at, 'status', a.status,
                                'distance_m', a.distance_m, 'address', a.address)
      from public.attendance a
      where a.user_id = auth.uid() and a.attendance_date = public.business_date()
        and a.type = 'closing'
        and not exists (select 1 from public.field_corrections c where c.user_id = auth.uid()
                        and c.status = 'open' and c.action = 'redo_clock_out'
                        and c.correction_date = public.business_date())
    ),
    'report_filed', exists (
      select 1 from public.reports r
      where r.user_id = auth.uid() and r.report_date = public.business_date()
    ),
    'redo', coalesce((
      select jsonb_agg(jsonb_build_object('action', c.action, 'reason', c.reason, 'at', c.created_at)
                       order by c.created_at)
      from public.field_corrections c
      where c.user_id = auth.uid() and c.status = 'open' and c.action like 'redo_%'
        and c.correction_date = public.business_date()
    ), '[]'::jsonb)
  );
$$;

select 'Working hours per person (0100) installed' as result;
