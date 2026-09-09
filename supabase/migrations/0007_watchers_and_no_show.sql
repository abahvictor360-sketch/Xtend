-- =====================================================================
-- XTEND migration 007 — telling the office, without being asked
--
-- Two questions the app needs answered in one place: who should hear about
-- a given member of staff, and who has not turned up when they should have.
-- =====================================================================

-- ---------------------------------------------------------------------
-- WHO GETS TOLD
--
-- Every active admin, plus the supervisor(s) of the subject's own outlet.
-- Called with the service role from the alerting path, so it does not rely
-- on the caller being able to read profiles.
-- ---------------------------------------------------------------------
create or replace function public.alert_watchers(p_user uuid)
returns table (user_id uuid, full_name text, role user_role)
language sql stable security definer set search_path = public as $$
  select w.id, w.full_name, w.role
  from public.profiles w
  where w.is_active
    and w.id <> p_user
    and (
      w.role = 'admin'::user_role
      or (
        w.role = 'supervisor'::user_role
        and w.outlet_id is not null
        and w.outlet_id = (select s.outlet_id from public.profiles s where s.id = p_user)
      )
    );
$$;

revoke all on function public.alert_watchers(uuid) from public, anon, authenticated;
grant execute on function public.alert_watchers(uuid) to service_role;

-- ---------------------------------------------------------------------
-- WHO HAS NOT TURNED UP
--
-- Field staff whose outlet's shift started more than p_grace_minutes ago
-- and who have no opening today. Outlets without a shift time are skipped
-- rather than guessed at.
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

-- ---------------------------------------------------------------------
-- Was this person already reported absent today? Keeps the sweep from
-- notifying the same no-show every time the cron runs.
-- ---------------------------------------------------------------------
create or replace function public.no_show_already_reported(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.notifications n
    where n.audience_detail ->> 'kind' = 'no_show'
      and n.audience_detail ->> 'subject_id' = p_user::text
      and (n.created_at at time zone 'Africa/Lagos')::date = public.business_date()
  );
$$;

revoke all on function public.no_show_already_reported(uuid) from public, anon, authenticated;
grant execute on function public.no_show_already_reported(uuid) to service_role;
