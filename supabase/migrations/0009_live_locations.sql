-- =====================================================================
-- XTEND migration 009 — the office can see where people actually are
--
-- Two gaps this closes:
--   1. An alert said "Ada Okafor, 1.2 km" without saying where she was.
--   2. Heartbeat pings were recorded and never shown to anyone.
-- =====================================================================

-- A breach is worth naming, so the ping that caused it can carry a place.
-- Only breaches are named: geocoding every five-minute ping would be an
-- API call per person per five minutes, for no extra information.
alter table public.location_pings add column if not exists place_name text;

comment on column public.location_pings.place_name is
  'Resolved only for pings that raised a geofence alert; null otherwise.';

-- ---------------------------------------------------------------------
-- ALERTS now carry where it happened, not just how far.
-- ---------------------------------------------------------------------
drop view if exists public.alert_detail;
create view public.alert_detail
with (security_invoker = true) as
  select
    l.id,
    l.user_id,
    p.full_name as staff_name,
    p.phone     as staff_phone,
    o.name      as outlet_name,
    l.alert_type,
    l.distance_m,
    l.is_resolved,
    l.note,
    l.created_at,
    l.resolved_at,
    r.full_name as resolved_by_name,
    l.attendance_id,
    -- Where the clock event happened, when the alert came from one.
    a.place_name,
    a.address,
    a.lat,
    a.lng,
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', a.place_name, nullif(a.address, a.place_name))), ''),
      a.address,
      case
        when a.lat is not null
        then round(a.lat::numeric, 5) || ', ' || round(a.lng::numeric, 5)
        else null
      end
    ) as location_label
  from public.location_alerts l
  join public.profiles p on p.id = l.user_id
  left join public.outlets o on o.id = p.outlet_id
  left join public.profiles r on r.id = l.resolved_by
  left join public.attendance a on a.id = l.attendance_id;

-- ---------------------------------------------------------------------
-- WHERE IS EVERYONE, RIGHT NOW
--
-- One row per person currently on shift: where they clocked in, their most
-- recent heartbeat, how far that is from the outlet, and how stale it is.
-- Scoped to the caller — an admin sees all, a supervisor their own outlet.
-- ---------------------------------------------------------------------
create or replace function public.live_locations()
returns table (
  user_id uuid,
  full_name text,
  phone text,
  outlet_name text,
  outlet_lat double precision,
  outlet_lng double precision,
  outlet_radius_m integer,
  clocked_in_at timestamptz,
  clock_in_label text,
  clock_in_status attendance_status,
  last_ping_at timestamptz,
  minutes_since_ping integer,
  last_lat double precision,
  last_lng double precision,
  last_place_name text,
  distance_from_outlet_m double precision,
  inside_geofence boolean
)
language sql stable security definer set search_path = public as $$
  with visible as (
    select p.id, p.full_name, p.phone, o.name as outlet_name,
           o.lat as o_lat, o.lng as o_lng, o.geofence_radius_m
    from public.profiles p
    left join public.outlets o on o.id = p.outlet_id
    where p.is_active
      and public.is_field_role(p.role)
      and (public.is_admin() or public.supervises_user(p.id))
  ),
  opening as (
    select a.user_id, a.created_at, a.status, a.lat, a.lng,
           coalesce(
             nullif(trim(both ', ' from concat_ws(', ', a.place_name,
               nullif(a.address, a.place_name))), ''),
             a.address,
             round(a.lat::numeric, 5) || ', ' || round(a.lng::numeric, 5)
           ) as label
    from public.attendance a
    where a.attendance_date = public.business_date() and a.type = 'opening'
  ),
  closing as (
    select a.user_id from public.attendance a
    where a.attendance_date = public.business_date() and a.type = 'closing'
  ),
  latest_ping as (
    select distinct on (p.user_id)
      p.user_id, p.created_at, p.lat, p.lng, p.place_name
    from public.location_pings p
    where p.created_at >= (public.business_date()::timestamp at time zone 'Africa/Lagos')
    order by p.user_id, p.created_at desc
  )
  select
    v.id,
    v.full_name,
    v.phone,
    v.outlet_name,
    v.o_lat,
    v.o_lng,
    v.geofence_radius_m,
    op.created_at,
    op.label,
    op.status,
    lp.created_at,
    case when lp.created_at is null then null
         else (extract(epoch from (now() - lp.created_at)) / 60)::int end,
    coalesce(lp.lat, op.lat),
    coalesce(lp.lng, op.lng),
    lp.place_name,
    case
      when v.o_lat is null then null
      else public.distance_metres(coalesce(lp.lat, op.lat), coalesce(lp.lng, op.lng), v.o_lat, v.o_lng)
    end,
    case
      when v.o_lat is null then null
      else public.distance_metres(coalesce(lp.lat, op.lat), coalesce(lp.lng, op.lng), v.o_lat, v.o_lng)
             <= v.geofence_radius_m
    end
  from visible v
  join opening op on op.user_id = v.id
  left join latest_ping lp on lp.user_id = v.id
  where not exists (select 1 from closing c where c.user_id = v.id)
  order by v.full_name;
$$;

revoke all on function public.live_locations() from public, anon;
grant execute on function public.live_locations() to authenticated, service_role;
