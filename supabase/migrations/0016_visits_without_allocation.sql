-- =====================================================================
-- XTEND migration 016 — a marketer's day, without allocating stores
--
-- Allocating stores to a marketer turned out to be work nobody wanted to
-- do and nobody needed done. What the office actually wants is the shape
-- of the day: when they started, which shops they were in and for how
-- long, and when they finished.
--
-- So a store visit no longer has to be to a store anybody assigned. It
-- does not have to be to a store Xtend knows about at all:
--
--   standing inside a known outlet's fence -> the visit is attributed to
--     that outlet and reads on_site, with no allocation involved
--   anywhere else -> the visit is recorded against no outlet, and the
--     map's name for the building is what identifies it
--
-- outlet_id therefore becomes nullable. Nothing is "off site" any more
-- unless the marketer explicitly named a store and was not at it, which
-- is the only case where being away from somewhere means anything.
-- =====================================================================

alter table public.store_visits alter column outlet_id drop not null;

-- ---------------------------------------------------------------------
-- Which known store, if any, is this point standing inside? Any active
-- outlet, not just somebody's own — the fence is a fact about the place,
-- not about who was assigned to it.
-- ---------------------------------------------------------------------
create or replace function public.outlet_containing(
  p_lat double precision,
  p_lng double precision
)
returns uuid
language sql stable security definer set search_path = public as $$
  select o.id
  from public.outlets o
  where o.is_active
    and public.distance_metres(p_lat, p_lng, o.lat, o.lng) <= o.geofence_radius_m
  order by public.distance_metres(p_lat, p_lng, o.lat, o.lng)
  limit 1;
$$;

revoke all on function public.outlet_containing(double precision, double precision)
  from public, anon;
grant execute on function public.outlet_containing(double precision, double precision)
  to authenticated, service_role;

-- Marketers record store visits. So do merchandisers who cover more than
-- one shop, because for them one daily clock can no longer say which.
create or replace function public.can_visit_stores()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p.role
      when 'marketer'::user_role then true
      when 'admin'::user_role then true
      when 'merchandiser'::user_role then
        (select count(*) from public.outlets_for_user(p.id)) > 1
      else false
    end
    from public.profiles p where p.id = auth.uid()
  ), false);
$$;

create or replace function public.store_visit_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  if not public.can_visit_stores() then
    raise exception 'Only marketers record store visits';
  end if;

  new.user_id    := auth.uid();
  new.created_at := now();
  new.arrived_at := now();
  new.visit_date := public.business_date();
  new.status     := 'open';

  -- Departure fields are never accepted on the way in.
  new.departed_at := null;
  new.departed_lat := null;
  new.departed_lng := null;
  new.departed_distance_m := null;
  new.departed_status := null;

  -- No store named: attribute it to a known one only if they are actually
  -- standing in it. Otherwise the visit stands on its own, identified by
  -- the coordinates and whatever the map called the place.
  if new.outlet_id is null then
    new.outlet_id := public.outlet_containing(new.arrived_lat, new.arrived_lng);
  end if;

  if new.outlet_id is null then
    new.outlet_lat := null;
    new.outlet_lng := null;
    new.outlet_radius_m := null;
    new.arrived_distance_m := null;
    -- Not on_site, not off_site. There is nowhere they were meant to be.
    new.arrived_status := case
      when new.arrived_accuracy_m > 100 then 'flagged'::attendance_status
      else null
    end;
  else
    select lat, lng, geofence_radius_m, is_active into o
    from public.outlets where id = new.outlet_id;

    if o is null then
      raise exception 'That store does not exist';
    end if;
    if not o.is_active then
      raise exception 'That store is no longer active';
    end if;

    new.outlet_lat      := o.lat;
    new.outlet_lng      := o.lng;
    new.outlet_radius_m := o.geofence_radius_m;
    new.arrived_distance_m :=
      public.distance_metres(new.arrived_lat, new.arrived_lng, o.lat, o.lng);

    new.arrived_status := case
      when new.arrived_accuracy_m > 100 then 'flagged'::attendance_status
      when new.arrived_distance_m <= o.geofence_radius_m then 'on_site'::attendance_status
      else 'off_site'::attendance_status
    end;
  end if;

  if new.client_captured_at > now() + interval '2 minutes'
     or new.client_captured_at < now() - interval '24 hours' then
    raise exception 'Invalid capture timestamp';
  end if;

  return new;
end;
$$;

revoke all on function public.store_visit_enforce() from public, anon, authenticated;

-- An alert now means something specific: they said they were at a
-- particular store and the fence says otherwise, or the fix was too rough
-- to trust. Visiting a shop Xtend has never heard of is not an exception.
create or replace function public.store_visit_alert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.arrived_accuracy_m > 100 then
    insert into public.location_alerts (user_id, alert_type, distance_m)
    values (new.user_id, 'low_accuracy'::alert_type, new.arrived_distance_m);
  elsif new.arrived_status = 'off_site' then
    insert into public.location_alerts (user_id, alert_type, distance_m)
    values (new.user_id, 'off_site_clock'::alert_type, new.arrived_distance_m);
  end if;
  return new;
end;
$$;

revoke all on function public.store_visit_alert() from public, anon, authenticated;

-- Departure, with no store to measure against when there was none.
create or replace function public.end_store_visit(
  p_visit_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_place_name text default null,
  p_address text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  new_distance double precision;
  new_status attendance_status;
begin
  select * into v from public.store_visits
  where id = p_visit_id and user_id = auth.uid();

  if v is null then
    raise exception 'That visit is not yours or does not exist';
  end if;
  if v.status <> 'open' then
    raise exception 'That visit is already closed';
  end if;

  if v.outlet_lat is null then
    new_distance := null;
    new_status := case when p_accuracy_m > 100 then 'flagged'::attendance_status else null end;
  else
    new_distance := public.distance_metres(p_lat, p_lng, v.outlet_lat, v.outlet_lng);
    new_status := case
      when p_accuracy_m > 100 then 'flagged'::attendance_status
      when new_distance <= coalesce(v.outlet_radius_m, 150) then 'on_site'::attendance_status
      else 'off_site'::attendance_status
    end;
  end if;

  update public.store_visits
  set status              = 'closed',
      departed_at         = now(),
      departed_lat        = p_lat,
      departed_lng        = p_lng,
      departed_accuracy_m = p_accuracy_m,
      departed_distance_m = new_distance,
      departed_status     = new_status,
      departed_place_name = p_place_name,
      departed_address    = p_address
  where id = p_visit_id;

  return jsonb_build_object(
    'id', p_visit_id,
    'departed_at', now(),
    'distance_m', new_distance,
    'status', new_status,
    'minutes', (extract(epoch from (now() - v.arrived_at)) / 60)::int
  );
end;
$$;

revoke all on function public.end_store_visit(uuid, double precision, double precision, double precision, text, text)
  from public, anon;
grant execute on function public.end_store_visit(uuid, double precision, double precision, double precision, text, text)
  to authenticated, service_role;

-- =====================================================================
-- READ MODEL — the outlet join becomes optional.
-- =====================================================================
-- These return `setof store_visit_detail`, so they hold the view down.
drop function if exists public.my_store_visits();
drop function if exists public.store_visits_today();
drop view if exists public.store_visit_detail;

create view public.store_visit_detail
with (security_invoker = true) as
  select
    v.id,
    v.user_id,
    p.full_name as staff_name,
    p.phone     as staff_phone,
    v.outlet_id,
    o.name      as outlet_name,
    o.address   as outlet_address,
    v.visit_date,
    v.status,
    v.arrived_at,
    v.departed_at,
    case
      when v.departed_at is null
        then (extract(epoch from (now() - v.arrived_at)) / 60)::int
      else (extract(epoch from (v.departed_at - v.arrived_at)) / 60)::int
    end as minutes,
    v.arrived_status,
    v.departed_status,
    round(v.arrived_distance_m)::int  as arrived_distance_m,
    round(v.departed_distance_m)::int as departed_distance_m,
    v.arrived_accuracy_m,
    v.arrived_lat,
    v.arrived_lng,
    v.outlet_radius_m,
    v.selfie_path,
    v.thumb_path,
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', v.arrived_place_name,
        nullif(v.arrived_address, v.arrived_place_name))), ''),
      v.arrived_address,
      round(v.arrived_lat::numeric, 5) || ', ' || round(v.arrived_lng::numeric, 5)
    ) as arrived_label,
    v.arrived_place_name,
    v.arrived_address,
    -- The store as a person standing there would name it.
    coalesce(
      case when v.arrived_status = 'on_site' then o.name end,
      nullif(v.arrived_place_name, ''),
      nullif(v.arrived_address, ''),
      o.name,
      'Unnamed place'
    ) as store_label,
    case
      when v.arrived_status = 'on_site' and o.name is not null then 'outlet'
      when coalesce(nullif(v.arrived_place_name, ''), nullif(v.arrived_address, '')) is not null
        then 'map'
      else 'outlet'
    end as store_label_source
  from public.store_visits v
  join public.profiles p on p.id = v.user_id
  left join public.outlets o on o.id = v.outlet_id;

create or replace function public.my_store_visits()
returns setof public.store_visit_detail
language sql stable security definer set search_path = public as $$
  select * from public.store_visit_detail
  where user_id = auth.uid() and visit_date = public.business_date()
  order by arrived_at desc;
$$;

revoke all on function public.my_store_visits() from public, anon;
grant execute on function public.my_store_visits() to authenticated, service_role;

create or replace function public.store_visits_today()
returns setof public.store_visit_detail
language sql stable security definer set search_path = public as $$
  select * from public.store_visit_detail v
  where v.visit_date = public.business_date()
    and (public.is_admin() or public.supervises_user(v.user_id) or v.user_id = auth.uid())
  order by v.arrived_at desc;
$$;

revoke all on function public.store_visits_today() from public, anon;
grant execute on function public.store_visits_today() to authenticated, service_role;

-- =====================================================================
-- THE DAY, PER PERSON — in, stores, out.
-- =====================================================================
create or replace function public.staff_day(p_date date default null)
returns table (
  user_id        uuid,
  staff_name     text,
  role           user_role,
  clocked_in_at  timestamptz,
  clocked_in_at_place text,
  clocked_out_at timestamptz,
  clocked_out_at_place text,
  stores_visited integer,
  minutes_in_store integer,
  still_in_store text
)
language sql stable security definer set search_path = public as $$
  with d as (select coalesce(p_date, public.business_date()) as day),
  people as (
    select pr.id, pr.full_name, pr.role
    from public.profiles pr, d
    where public.is_field_role(pr.role)
      and (public.is_admin() or public.supervises_user(pr.id) or pr.id = auth.uid())
      and (
        exists (select 1 from public.attendance a
                where a.user_id = pr.id and a.attendance_date = d.day)
        or exists (select 1 from public.store_visits v
                   where v.user_id = pr.id and v.visit_date = d.day)
      )
  )
  select
    pe.id,
    pe.full_name,
    pe.role,
    opening.created_at,
    opening.place_name,
    closing.created_at,
    closing.place_name,
    coalesce(vis.n, 0)::int,
    coalesce(vis.mins, 0)::int,
    vis.open_store
  from people pe
  cross join d
  left join lateral (
    select a.created_at, a.place_name from public.attendance a
    where a.user_id = pe.id and a.attendance_date = d.day and a.type = 'opening'
    limit 1
  ) opening on true
  left join lateral (
    select a.created_at, a.place_name from public.attendance a
    where a.user_id = pe.id and a.attendance_date = d.day and a.type = 'closing'
    limit 1
  ) closing on true
  left join lateral (
    select
      count(*) as n,
      sum(sv.minutes) as mins,
      max(case when sv.status = 'open' then sv.store_label end) as open_store
    from public.store_visit_detail sv
    where sv.user_id = pe.id and sv.visit_date = d.day
  ) vis on true
  order by opening.created_at nulls last, pe.full_name;
$$;

revoke all on function public.staff_day(date) from public, anon;
grant execute on function public.staff_day(date) to authenticated, service_role;

-- =====================================================================
-- THE DAILY CLOCK, on the same footing
--
-- A marketer with no stores assigned would otherwise have every clock
-- event flagged and every admin notified twice a day, which is noise
-- rather than information. So the clock answers the same question the
-- visit does: am I standing in a shop Xtend knows?
--
--   inside one -> attributed to it, on_site, no allocation needed
--   nowhere known -> recorded with no outlet and no status, because
--     there is nowhere they were due to be
--
-- Someone who does have a home or allocated store is still measured
-- against it exactly as before, so nothing weakens for a merchandiser
-- who sits in one shop all day.
-- =====================================================================
create or replace function public.attendance_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
begin
  new.user_id         := auth.uid();
  new.created_at      := now();
  new.attendance_date := public.business_date();

  select ot.id, ot.lat, ot.lng, ot.geofence_radius_m,
         public.distance_metres(new.lat, new.lng, ot.lat, ot.lng) as distance_m
    into o
  from public.outlets ot
  where ot.id in (select outlet_id from public.outlets_for_user(new.user_id))
  order by public.distance_metres(new.lat, new.lng, ot.lat, ot.lng)
  limit 1;

  -- Nothing of their own: fall back to whichever known store they are
  -- actually standing in, if any.
  if o.id is null then
    select ot.id, ot.lat, ot.lng, ot.geofence_radius_m,
           public.distance_metres(new.lat, new.lng, ot.lat, ot.lng) as distance_m
      into o
    from public.outlets ot
    where ot.id = public.outlet_containing(new.lat, new.lng);
  end if;

  if o.id is not null then
    new.outlet_id       := o.id;
    new.outlet_lat      := o.lat;
    new.outlet_lng      := o.lng;
    new.outlet_radius_m := o.geofence_radius_m;
    new.distance_m      := o.distance_m;
  else
    new.outlet_id  := null;
    new.distance_m := null;
  end if;

  new.status := case
    when new.accuracy_m > 100 then 'flagged'::attendance_status
    when new.distance_m is null then null
    when new.distance_m <= coalesce(new.outlet_radius_m, 150) then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;

  if new.client_captured_at > now() + interval '2 minutes'
     or new.client_captured_at < now() - interval '24 hours' then
    raise exception 'Invalid capture timestamp';
  end if;

  return new;
end;
$$;

-- `status <> 'on_site'` is already null-safe: a clock event with nowhere
-- to be measured against raises nothing, which is the intent.
