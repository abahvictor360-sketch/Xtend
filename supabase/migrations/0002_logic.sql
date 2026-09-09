-- =====================================================================
-- XTEND migration 002
-- Everything the app needs that migration 001 did not carry: supervisor
-- visibility, the heartbeat/geofence rules, audit helpers, dashboard
-- aggregates and the read views the exports use.
--
-- Architectural rule: business logic lives here, not in React.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PROFILES: email is mirrored from auth.users so admin lists, CSV import
-- and phone-based login can be served without a service-role round trip.
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_key on public.profiles (lower(email));
create unique index if not exists profiles_phone_key on public.profiles (phone) where phone is not null;

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_reports_touch on public.reports;
create trigger trg_reports_touch before update on public.reports
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------

-- A supervisor sees the outlet they are assigned to, and nothing else.
create or replace function public.supervises_user(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles them on them.id = target
    where me.id = auth.uid()
      and me.role = 'supervisor'
      and me.outlet_id is not null
      and them.outlet_id = me.outlet_id
  );
$$;

-- Server-side audit trail. actor_id is never taken from the client.
create or replace function public.write_audit(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), p_action, p_target_table, p_target_id, coalesce(p_meta, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

-- The Lagos business day, server-side. Device clocks are untrusted.
create or replace function public.business_date()
returns date language sql stable as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;

-- ---------------------------------------------------------------------
-- SUPERVISOR READ POLICIES
-- ---------------------------------------------------------------------
drop policy if exists profiles_supervisor_select on public.profiles;
create policy profiles_supervisor_select on public.profiles
  for select using (public.supervises_user(id));

drop policy if exists attendance_supervisor_select on public.attendance;
create policy attendance_supervisor_select on public.attendance
  for select using (public.supervises_user(user_id));

drop policy if exists reports_supervisor_select on public.reports;
create policy reports_supervisor_select on public.reports
  for select using (public.supervises_user(user_id));

drop policy if exists pings_supervisor_select on public.location_pings;
create policy pings_supervisor_select on public.location_pings
  for select using (public.supervises_user(user_id));

drop policy if exists alerts_supervisor_select on public.location_alerts;
create policy alerts_supervisor_select on public.location_alerts
  for select using (public.supervises_user(user_id));

-- ---------------------------------------------------------------------
-- LOCATION GATE: a blocked attempt is evidence, so it is recorded.
-- The alerts table is admin-only for writes, hence SECURITY DEFINER.
-- ---------------------------------------------------------------------
create or replace function public.log_location_block(
  p_reason text,
  p_accuracy_m double precision default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  kind alert_type;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  kind := case when p_reason = 'low_accuracy' then 'low_accuracy'::alert_type
               else 'permission_denied'::alert_type end;

  -- One row per user per reason per 15 minutes. A retry loop must not
  -- flood the admin queue.
  select id into new_id
  from public.location_alerts
  where user_id = auth.uid()
    and alert_type = kind
    and created_at > now() - interval '15 minutes'
  limit 1;

  if new_id is not null then
    return new_id;
  end if;

  insert into public.location_alerts (user_id, alert_type, distance_m)
  values (auth.uid(), kind, p_accuracy_m)
  returning id into new_id;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- HEARTBEAT: the client sends a fix, the server decides what it means.
-- ---------------------------------------------------------------------
create or replace function public.ping_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  open_shift record;
begin
  new.user_id    := auth.uid();
  new.created_at := now();

  -- Anchor to today's opening event; a ping without an open shift is kept
  -- but carries no distance.
  select a.id, a.lat, a.lng into open_shift
  from public.attendance a
  where a.user_id = new.user_id
    and a.attendance_date = public.business_date()
    and a.type = 'opening'
  limit 1;

  if open_shift.id is not null then
    new.attendance_id := open_shift.id;
    new.distance_m := public.distance_metres(new.lat, new.lng, open_shift.lat, open_shift.lng);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ping_enforce on public.location_pings;
create trigger trg_ping_enforce before insert on public.location_pings
  for each row execute function public.ping_enforce();

create or replace function public.ping_alert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.distance_m is not null and new.distance_m > 300 then
    -- One left_geofence alert per shift per 30 minutes.
    if not exists (
      select 1 from public.location_alerts
      where user_id = new.user_id
        and alert_type = 'left_geofence'
        and created_at > now() - interval '30 minutes'
    ) then
      insert into public.location_alerts (user_id, attendance_id, alert_type, distance_m)
      values (new.user_id, new.attendance_id, 'left_geofence', new.distance_m);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ping_alert on public.location_pings;
create trigger trg_ping_alert after insert on public.location_pings
  for each row execute function public.ping_alert();

-- ---------------------------------------------------------------------
-- REPORTS: the outlet snapshot is server-set, same rule as attendance.
-- ---------------------------------------------------------------------
create or replace function public.report_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id     := auth.uid();
    new.report_date := public.business_date();
    select p.outlet_id into new.outlet_id
    from public.profiles p where p.id = new.user_id;
  else
    -- Same-day edits only, and never a rewrite of whose report it is.
    new.user_id     := old.user_id;
    new.report_date := old.report_date;
    new.outlet_id   := old.outlet_id;
    if old.report_date <> public.business_date() then
      raise exception 'Reports can only be edited on the day they were filed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_enforce on public.reports;
create trigger trg_report_enforce before insert or update on public.reports
  for each row execute function public.report_enforce();

-- At most five photos per report.
create or replace function public.report_photo_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.report_photos where report_id = new.report_id) >= 5 then
    raise exception 'A report carries at most 5 photos';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_report_photo_limit on public.report_photos;
create trigger trg_report_photo_limit before insert on public.report_photos
  for each row execute function public.report_photo_limit();

-- ---------------------------------------------------------------------
-- ALERT RESOLUTION (admin), audited.
-- ---------------------------------------------------------------------
create or replace function public.resolve_alert(p_alert_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;

  update public.location_alerts
  set is_resolved = true,
      resolved_by = auth.uid(),
      resolved_at = now(),
      note        = p_note
  where id = p_alert_id;

  if not found then
    raise exception 'Alert not found';
  end if;

  perform public.write_audit(
    'alert.resolve', 'location_alerts', p_alert_id,
    jsonb_build_object('note', p_note)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- READ MODELS
-- security_invoker keeps RLS on the caller, so a supervisor sees their
-- outlet and a merchandiser sees only themselves.
-- ---------------------------------------------------------------------
create or replace view public.attendance_detail
with (security_invoker = true) as
  select
    a.id,
    a.user_id,
    p.full_name        as staff_name,
    p.phone            as staff_phone,
    a.attendance_date,
    a.type,
    a.created_at,
    to_char(a.created_at at time zone 'Africa/Lagos', 'YYYY-MM-DD HH24:MI') as local_time,
    a.outlet_id,
    o.name             as outlet_name,
    o.shift_start,
    o.shift_end,
    a.address,
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
      when a.type = 'opening' and o.shift_start is not null
       and (a.created_at at time zone 'Africa/Lagos')::time > o.shift_start
      then true else false
    end as is_late
  from public.attendance a
  join public.profiles p on p.id = a.user_id
  left join public.outlets o on o.id = a.outlet_id;

create or replace view public.alert_detail
with (security_invoker = true) as
  select
    l.id,
    l.user_id,
    p.full_name as staff_name,
    o.name      as outlet_name,
    l.alert_type,
    l.distance_m,
    l.is_resolved,
    l.note,
    l.created_at,
    l.resolved_at,
    r.full_name as resolved_by_name,
    l.attendance_id
  from public.location_alerts l
  join public.profiles p on p.id = l.user_id
  left join public.outlets o on o.id = p.outlet_id
  left join public.profiles r on r.id = l.resolved_by;

-- ---------------------------------------------------------------------
-- DASHBOARD AGGREGATES
-- ---------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select public.business_date() as d),
  staff as (
    select p.id, p.full_name, o.shift_start
    from public.profiles p
    left join public.outlets o on o.id = p.outlet_id
    where p.is_active and p.role = 'merchandiser'
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
                        where not exists (select 1 from openings o where o.user_id = s.id)),
    'late',            (select count(*) from openings o
                        join staff s on s.id = o.user_id
                        where s.shift_start is not null
                          and (o.created_at at time zone 'Africa/Lagos')::time > s.shift_start),
    'off_site',        (select count(*) from openings where status <> 'on_site'),
    'open_alerts',     (select count(*) from public.location_alerts where not is_resolved)
  )
  where public.is_admin() or public.current_user_role() = 'supervisor';
$$;

-- Who has not clocked in today. The dashboard's absentee list.
create or replace function public.absentees_today()
returns table (user_id uuid, full_name text, phone text, outlet_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone, o.name
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  where p.is_active
    and p.role = 'merchandiser'
    and (public.is_admin() or public.supervises_user(p.id))
    and not exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by p.full_name;
$$;

-- The field user's own view of today. One round trip on app open.
create or replace function public.my_day()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'date', public.business_date(),
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
        'shift_start', o.shift_start, 'shift_end', o.shift_end
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
    ),
    'closing', (
      select jsonb_build_object('id', a.id, 'at', a.created_at, 'status', a.status,
                                'distance_m', a.distance_m, 'address', a.address)
      from public.attendance a
      where a.user_id = auth.uid() and a.attendance_date = public.business_date()
        and a.type = 'closing'
    ),
    'report_filed', exists (
      select 1 from public.reports r
      where r.user_id = auth.uid() and r.report_date = public.business_date()
    )
  );
$$;

-- Punctuality and coverage over a window (Phase 3 analytics).
create or replace function public.staff_analytics(p_from date, p_to date)
returns table (
  user_id uuid,
  full_name text,
  outlet_name text,
  days_present integer,
  days_late integer,
  days_off_site integer,
  avg_distance_m double precision
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    o.name,
    count(*) filter (where a.type = 'opening')::int,
    count(*) filter (
      where a.type = 'opening' and o.shift_start is not null
        and (a.created_at at time zone 'Africa/Lagos')::time > o.shift_start
    )::int,
    count(*) filter (where a.type = 'opening' and a.status <> 'on_site')::int,
    round(avg(a.distance_m) filter (where a.type = 'opening')::numeric, 1)::double precision
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  left join public.attendance a
    on a.user_id = p.id and a.attendance_date between p_from and p_to
  where p.role = 'merchandiser'
    and (public.is_admin() or public.supervises_user(p.id))
  group by p.id, p.full_name, o.name
  order by p.full_name;
$$;

-- ---------------------------------------------------------------------
-- REALTIME: the admin alert feed and the live attendance count.
-- ---------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.location_alerts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.attendance;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------
-- STORAGE: the report bucket needs an update policy for photo replacement
-- and both buckets need delete rights scoped to the owner.
-- ---------------------------------------------------------------------
drop policy if exists reports_update_own on storage.objects;
create policy reports_update_own on storage.objects
  for update using (
    bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists reports_delete_own_sameday on storage.objects;
create policy reports_delete_own_sameday on storage.objects
  for delete using (
    bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Selfies are never deleted by a user. Only purge_old_selfies touches them.
