-- =====================================================================
-- XTEND migration 004 — measuring how much of a shift was actually tracked
--
-- The web platform cannot keep a heartbeat running once the phone is locked
-- or the app is backgrounded: the tab is suspended, and a service worker has
-- no access to geolocation. Rather than pretend otherwise, every ping now
-- records how long it had been since the previous one, so a gap in tracking
-- becomes a visible, auditable number instead of silence.
-- =====================================================================

alter table public.location_pings add column if not exists gap_seconds integer;

comment on column public.location_pings.gap_seconds is
  'Seconds since this user''s previous ping today. Large values mean the app '
  'was closed, backgrounded or the phone was locked. Null on the first ping.';

-- ---------------------------------------------------------------------
-- The heartbeat trigger now also stamps the gap.
-- ---------------------------------------------------------------------
create or replace function public.ping_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  open_shift record;
  previous_at timestamptz;
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

  select max(p.created_at) into previous_at
  from public.location_pings p
  where p.user_id = new.user_id
    and p.created_at >= (public.business_date()::timestamp at time zone 'Africa/Lagos');

  if previous_at is not null then
    new.gap_seconds := greatest(0, extract(epoch from (now() - previous_at))::integer);
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Coverage: of the time a person was on shift, how much did the heartbeat
-- actually see? A ping covers the interval before it, capped at 6 minutes
-- (the 5-minute cadence plus slack) so a two-hour gap counts as two hours
-- uncovered rather than being papered over.
-- ---------------------------------------------------------------------
create or replace function public.tracking_coverage(p_user uuid, p_date date)
returns jsonb
language sql stable security definer set search_path = public as $$
  with bounds as (
    select
      min(a.created_at) filter (where a.type = 'opening') as opened_at,
      min(a.created_at) filter (where a.type = 'closing') as closed_at
    from public.attendance a
    where a.user_id = p_user and a.attendance_date = p_date
  ),
  window_secs as (
    select
      opened_at,
      closed_at,
      case
        when opened_at is null then 0
        else greatest(0, extract(epoch from (coalesce(closed_at, now()) - opened_at)))
      end as shift_secs
    from bounds
  ),
  pings as (
    select p.created_at, least(coalesce(p.gap_seconds, 360), 360) as covered
    from public.location_pings p, window_secs w
    where p.user_id = p_user
      and w.opened_at is not null
      and p.created_at >= w.opened_at
      and p.created_at <= coalesce(w.closed_at, now())
  )
  select jsonb_build_object(
    'date',            p_date,
    'shift_seconds',   (select round(shift_secs) from window_secs),
    'tracked_seconds', coalesce((select round(sum(covered)) from pings), 0),
    'ping_count',      (select count(*) from pings),
    'longest_gap_seconds', coalesce((select max(covered) from pings), 0),
    'last_ping_at',    (select max(created_at) from pings),
    'coverage_pct',    case
                         when (select shift_secs from window_secs) < 1 then null
                         else least(100, round(
                           100.0 * coalesce((select sum(covered) from pings), 0)
                           / (select shift_secs from window_secs)
                         ))
                       end
  )
  where p_user = auth.uid() or public.is_admin() or public.supervises_user(p_user);
$$;

revoke all on function public.tracking_coverage(uuid, date) from public, anon;
grant execute on function public.tracking_coverage(uuid, date) to authenticated, service_role;

-- The field app asks about itself; this saves it passing its own id.
create or replace function public.my_coverage()
returns jsonb
language sql stable security definer set search_path = public as $$
  select public.tracking_coverage(auth.uid(), public.business_date());
$$;

revoke all on function public.my_coverage() from public, anon;
grant execute on function public.my_coverage() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Admin view: today's coverage per active merchandiser, so the office can
-- see who was actually observable and who spent the day with the app shut.
-- ---------------------------------------------------------------------
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
    and p.role = 'merchandiser'
    and (public.is_admin() or public.supervises_user(p.id))
    and exists (
      select 1 from public.attendance a
      where a.user_id = p.id
        and a.attendance_date = public.business_date()
        and a.type = 'opening'
    )
  order by p.full_name;
$$;

revoke all on function public.coverage_today() from public, anon;
grant execute on function public.coverage_today() to authenticated, service_role;
