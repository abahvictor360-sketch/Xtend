-- =====================================================================
-- XTEND migration 028 — follow someone's day on a map
--
-- Everything Xtend knows about where one person was on one day, in time
-- order, for the Movement page: the clock-in and clock-out, every location
-- check the app sent while they were on shift, store check-ins and
-- check-outs, and the positions the phone reported about itself (026).
-- With it, the stores that matter: their own, any they were allocated,
-- and any they visited.
--
-- Admins see anyone; a supervisor sees their own team; nobody else.
-- =====================================================================

do $$
begin
  if to_regclass('public.device_beacons') is null then
    raise exception 'Run the phone evidence update (026, step 8) first, then this file';
  end if;
end $$;

create or replace function public.movement_trail(p_user uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  day_start timestamptz := (p_date::timestamp at time zone 'Africa/Lagos');
  day_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Africa/Lagos');
  result jsonb;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only follow your own team';
  end if;

  with points as (
    select a.created_at as at,
           case when a.type::text = 'opening' then 'clock_in' else 'clock_out' end as kind,
           a.lat, a.lng, a.accuracy_m, a.distance_m,
           coalesce(a.place_name, a.address) as place, a.outlet_id
    from public.attendance a
    where a.user_id = p_user and a.created_at >= day_start and a.created_at < day_end
    union all
    select l.created_at, 'location', l.lat, l.lng, l.accuracy_m, l.distance_m, l.place_name, null
    from public.location_pings l
    where l.user_id = p_user and l.created_at >= day_start and l.created_at < day_end
    union all
    select v.arrived_at, 'visit_in', v.arrived_lat, v.arrived_lng, v.arrived_accuracy_m, null,
           o.name, v.outlet_id
    from public.store_visits v
    left join public.outlets o on o.id = v.outlet_id
    where v.user_id = p_user and v.arrived_at >= day_start and v.arrived_at < day_end
    union all
    select v.departed_at, 'visit_out', v.departed_lat, v.departed_lng, v.departed_accuracy_m, null,
           o.name, v.outlet_id
    from public.store_visits v
    left join public.outlets o on o.id = v.outlet_id
    where v.user_id = p_user and v.departed_at >= day_start and v.departed_at < day_end
      and v.departed_lat is not null
    union all
    select b.received_at, 'app', b.lat, b.lng, b.accuracy_m, null, null, null
    from public.device_beacons b
    where b.user_id = p_user and b.lat is not null
      and b.received_at >= day_start and b.received_at < day_end
  ),
  stores as (
    select o.id, o.name, o.lat, o.lng, o.geofence_radius_m as radius_m
    from public.outlets o
    where o.lat is not null and (
      o.id in (select f.outlet_id from public.outlets_for_user(p_user) f)
      or o.id in (select p.outlet_id from points p where p.outlet_id is not null)
    )
  )
  select jsonb_build_object(
    'person', (select jsonb_build_object('id', pr.id, 'name', pr.full_name, 'phone', pr.phone, 'role', pr.role)
               from public.profiles pr where pr.id = p_user),
    'date', p_date,
    'points', coalesce((select jsonb_agg(to_jsonb(p) order by p.at) from points p
                        where p.lat is not null and p.lng is not null), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(s)) from stores s), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.movement_trail(uuid, date) from public, anon;
grant execute on function public.movement_trail(uuid, date) to authenticated, service_role;

select 'Movement trail (028) installed' as result;
