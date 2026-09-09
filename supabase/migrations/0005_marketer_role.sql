-- =====================================================================
-- XTEND migration 005 — the marketer role
--
-- Field staff are now merchandisers and marketers. Both clock in and out
-- and both are tracked; only marketers file the daily report.
--
-- NOTE: this file must be applied in TWO steps. Postgres refuses to use an
-- enum value in the same transaction that adds it, so run part 1, commit,
-- then run part 2.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PART 1 — run alone and commit before part 2.
-- ---------------------------------------------------------------------
alter type user_role add value if not exists 'marketer';

-- ---------------------------------------------------------------------
-- PART 2
-- ---------------------------------------------------------------------

-- Who counts as field staff: anyone who clocks in and out.
create or replace function public.is_field_role(r user_role)
returns boolean language sql immutable as $$
  select r in ('merchandiser'::user_role, 'marketer'::user_role);
$$;

-- Only marketers file reports. Admins can too, for corrections.
create or replace function public.can_file_report()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('marketer'::user_role, 'admin'::user_role)
     from public.profiles where id = auth.uid()),
    false);
$$;

revoke all on function public.can_file_report() from public, anon;
grant execute on function public.can_file_report() to authenticated, service_role;
revoke all on function public.is_field_role(user_role) from public, anon;
grant execute on function public.is_field_role(user_role) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- REPORTS: marketers only, enforced in the policy and again in the trigger
-- so neither the REST API nor a direct insert can get round it.
-- ---------------------------------------------------------------------
drop policy if exists reports_insert_own on public.reports;
create policy reports_insert_own on public.reports
  for insert with check (auth.uid() is not null and public.can_file_report());

drop policy if exists reports_update_own_sameday on public.reports;
create policy reports_update_own_sameday on public.reports
  for update using (
    user_id = auth.uid()
    and public.can_file_report()
    and report_date = (now() at time zone 'Africa/Lagos')::date
  );

create or replace function public.report_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.can_file_report() then
      raise exception 'Only marketers file the daily report';
    end if;
    new.user_id     := auth.uid();
    new.report_date := public.business_date();
    select p.outlet_id into new.outlet_id
    from public.profiles p where p.id = new.user_id;
  else
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

-- ---------------------------------------------------------------------
-- Everything that counted "merchandiser" now counts both field roles.
-- ---------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select public.business_date() as d),
  staff as (
    select p.id, p.full_name, o.shift_start
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

create or replace function public.absentees_today()
returns table (user_id uuid, full_name text, phone text, outlet_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.phone, o.name
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  where p.is_active
    and public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id))
    and not exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by p.full_name;
$$;

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
  where public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id))
  group by p.id, p.full_name, o.name
  order by p.full_name;
$$;

create or replace function public.coverage_today()
returns table (
  user_id uuid,
  full_name text,
  outlet_name text,
  ping_count integer,
  coverage_pct integer,
  last_ping_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    o.name,
    (public.tracking_coverage(p.id, public.business_date()) ->> 'ping_count')::int,
    (public.tracking_coverage(p.id, public.business_date()) ->> 'coverage_pct')::int,
    (public.tracking_coverage(p.id, public.business_date()) ->> 'last_ping_at')::timestamptz
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  where p.is_active
    and public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id))
    and exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by p.full_name;
$$;

-- my_day now tells the app whether this user files reports, so the field
-- UI does not have to infer it from the role name.
create or replace function public.my_day()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'date', public.business_date(),
    'can_file_report', public.can_file_report(),
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
