-- =====================================================================
-- XTEND migration 034 — stores pinned from where staff clock in
--
-- Some stores cannot be found on any map. They can now be added without a
-- location, allocated as usual, and pinned from where their staff actually
-- clock in:
--
--   * A store with no lat/lng is waiting for its location. Nobody is
--     measured against it: a clock-in there is recorded, but neither on
--     nor off site, and it raises no alert.
--   * When somebody allocated to such a store clocks in with a good fix
--     and is not inside any pinned store, the spot is kept as a learned
--     place (024), marked with the waiting stores it could be.
--   * An admin checks it on the Places page (the selfie, how often it was
--     seen, by how many people) and confirms which store it is. The store
--     takes that position and is measured normally from then on.
--
-- A spot is never made a store's location without an admin confirming it:
-- somebody could clock in at home on their first day.
-- =====================================================================

do $$
begin
  if to_regclass('public.known_places') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'known_places'
                      and column_name = 'visitors') then
    raise exception 'Run the learned places updates (024 and 025) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- A store may wait for its location. Both coordinates or neither.
-- ---------------------------------------------------------------------
alter table public.outlets alter column lat drop not null;
alter table public.outlets alter column lng drop not null;
alter table public.outlets drop constraint if exists outlets_location_whole;
alter table public.outlets add constraint outlets_location_whole
  check ((lat is null) = (lng is null));

-- ---------------------------------------------------------------------
-- Learned places remember which waiting stores they could be.
-- ---------------------------------------------------------------------
alter table public.known_places
  add column if not exists store_candidates uuid[] not null default '{}';

alter table public.known_places drop constraint if exists known_places_source_check;
alter table public.known_places add constraint known_places_source_check
  check (source in ('google', 'osm', 'staff', 'admin', 'clock_in'));

-- ---------------------------------------------------------------------
-- The clock: measured against the nearest pinned store. Somebody who is
-- outside all of their pinned stores but has a store waiting for its
-- location may well be standing in that one, so they are not measured.
-- ---------------------------------------------------------------------
create or replace function public.attendance_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
  waiting boolean;
  unmeasured boolean := false;
begin
  new.user_id         := auth.uid();
  new.created_at      := now();
  new.attendance_date := public.business_date();

  select ot.id, ot.lat, ot.lng, ot.geofence_radius_m,
         public.distance_metres(new.lat, new.lng, ot.lat, ot.lng) as distance_m
    into o
  from public.outlets ot
  where ot.id in (select outlet_id from public.outlets_for_user(new.user_id))
    and ot.lat is not null
  order by public.distance_metres(new.lat, new.lng, ot.lat, ot.lng)
  limit 1;

  select exists (
    select 1 from public.outlets ot
    where ot.id in (select outlet_id from public.outlets_for_user(new.user_id))
      and ot.lat is null
  ) into waiting;

  if waiting and (o.id is null or o.distance_m > o.geofence_radius_m) then
    unmeasured := true;
  elsif o.id is null then
    select ot.id, ot.lat, ot.lng, ot.geofence_radius_m,
           public.distance_metres(new.lat, new.lng, ot.lat, ot.lng) as distance_m
      into o
    from public.outlets ot
    where ot.id = public.outlet_containing(new.lat, new.lng);
  end if;

  if not unmeasured and o.id is not null then
    new.outlet_id       := o.id;
    new.outlet_lat      := o.lat;
    new.outlet_lng      := o.lng;
    new.outlet_radius_m := o.geofence_radius_m;
    new.distance_m      := o.distance_m;
  else
    new.outlet_id       := null;
    new.outlet_lat      := null;
    new.outlet_lng      := null;
    new.outlet_radius_m := null;
    new.distance_m      := null;
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

-- ---------------------------------------------------------------------
-- A clock-in that may be at a waiting store is kept as a learned place,
-- marked with the stores it could be. Only good fixes: a 90 m guess would
-- pin a store on the wrong side of the road.
-- ---------------------------------------------------------------------
create or replace function public.attendance_learn_waiting_store()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  candidates uuid[];
  label text;
  found uuid;
begin
  if new.status is not null or new.outlet_id is not null or new.accuracy_m > 50 then
    return null;
  end if;
  if public.outlet_containing(new.lat, new.lng) is not null then
    return null;
  end if;

  select array_agg(o.id order by o.name), string_agg(o.name, ', ' order by o.name)
    into candidates, label
  from public.outlets o
  where o.id in (select outlet_id from public.outlets_for_user(new.user_id))
    and o.lat is null;
  if candidates is null then
    return null;
  end if;

  select k.id into found from public.known_place_at(new.lat, new.lng) k;
  if found is not null then
    update public.known_places
    set store_candidates = array(select distinct unnest(store_candidates || candidates)),
        visitors = case when new.user_id = any(visitors) then visitors else visitors || new.user_id end,
        -- The server may have just learned this spot from the map for the
        -- same clock-in; one clock-in is seen once.
        times_seen = case when last_seen_at < now() - interval '2 minutes'
                          then times_seen + 1 else times_seen end,
        last_seen_at = now()
    where id = found;
  else
    insert into public.known_places (name, lat, lng, source, visitors, store_candidates)
    values (left('Clock-in spot: ' || label, 120), new.lat, new.lng, 'clock_in',
            array[new.user_id], candidates);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_attendance_learn_waiting_store on public.attendance;
create trigger trg_attendance_learn_waiting_store
  after insert on public.attendance
  for each row execute function public.attendance_learn_waiting_store();

-- ---------------------------------------------------------------------
-- Store visits: a waiting store cannot say whether anyone is in it.
-- ---------------------------------------------------------------------
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

  new.departed_at := null;
  new.departed_lat := null;
  new.departed_lng := null;
  new.departed_distance_m := null;
  new.departed_status := null;

  if new.outlet_id is null then
    new.outlet_id := public.outlet_containing(new.arrived_lat, new.arrived_lng);
  end if;

  if new.outlet_id is null then
    new.outlet_lat := null;
    new.outlet_lng := null;
    new.outlet_radius_m := null;
    new.arrived_distance_m := null;
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
      when new.arrived_distance_m is null then null
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

-- Nearest pinned store first; a waiting one only when nothing is pinned.
create or replace function public.nearest_outlet_for_user(target uuid, p_lat double precision, p_lng double precision)
returns uuid
language sql stable security definer set search_path = public as $$
  select o.id
  from public.outlets o
  where o.id in (select outlet_id from public.outlets_for_user(target))
  order by public.distance_metres(p_lat, p_lng, o.lat, o.lng) nulls last
  limit 1;
$$;

-- ---------------------------------------------------------------------
-- Store counts: counted in the store, so only in a pinned one.
-- ---------------------------------------------------------------------
create or replace function public.submit_store_count(
  p_outlet_id uuid,
  p_lines jsonb,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_photo_path text
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  today date := public.business_date();
  status jsonb := public.store_count_status();
  req uuid := nullif(status->>'request_id', '')::uuid;
  store record;
  dist double precision;
  saved integer;
  missing jsonb;
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;
  if not coalesce((status->>'open')::boolean, false) then
    raise exception 'No store count is due: counts are taken when a supervisor asks, or at the end of the month';
  end if;
  if p_outlet_id is null
     or p_outlet_id not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;

  -- A. In the store, now.
  select o.lat, o.lng, o.geofence_radius_m into store from public.outlets o where o.id = p_outlet_id;
  if p_lat is null or p_lng is null or p_accuracy_m is null or p_accuracy_m > 100 then
    raise exception 'Your location is not accurate enough. Step near a window and try again';
  end if;
  -- A store waiting for its location cannot say whether anyone is in it.
  if store.lat is null or store.lng is null then
    raise exception 'This store''s location is still being confirmed. Ask your supervisor, then count it once it is confirmed';
  end if;
  dist := public.distance_metres(p_lat, p_lng, store.lat, store.lng);
  if dist > store.geofence_radius_m + 25 then
    raise exception 'You must be in the store to submit its count (you are % m away)', round(dist::numeric);
  end if;
  if p_photo_path is null or not public.photo_is_fresh('reports', p_photo_path, 30) then
    raise exception 'Take the shelf photo in the app just before submitting';
  end if;
  if exists (select 1 from public.store_counts c
             where c.photo_path = p_photo_path
               and not (c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today)) then
    raise exception 'That shelf photo has already been used';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Count at least one product';
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'Too many products in one count';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) l
             where length(public.product_key(l->>'product_name')) not between 1 and 120) then
    raise exception 'Every product needs a name of up to 120 characters';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) l
    where jsonb_typeof(l->'in_store') <> 'number' or jsonb_typeof(l->'sold') <> 'number'
       or (l->>'in_store')::numeric <> trunc((l->>'in_store')::numeric)
       or (l->>'sold')::numeric <> trunc((l->>'sold')::numeric)
       or (l->>'in_store')::numeric not between 0 and 1000000
       or (l->>'sold')::numeric not between 0 and 1000000
  ) then
    raise exception 'Counts must be whole numbers from 0 up';
  end if;
  if (select count(distinct public.product_key(l->>'product_name')) from jsonb_array_elements(p_lines) l)
     <> jsonb_array_length(p_lines) then
    raise exception 'A product appears twice in the count';
  end if;

  insert into public.products (name)
  select distinct on (public.product_key(l->>'product_name'))
         regexp_replace(btrim(l->>'product_name'), '\s+', ' ', 'g')
  from jsonb_array_elements(p_lines) l
  where not exists (select 1 from public.products p
                    where public.product_key(p.name) = public.product_key(l->>'product_name'))
  on conflict do nothing;

  insert into public.store_counts
    (user_id, outlet_id, product_id, count_date, in_store, sold, request_id,
     lat, lng, accuracy_m, distance_m, photo_path)
  select auth.uid(), p_outlet_id,
         (select p.id from public.products p
          where public.product_key(p.name) = public.product_key(l->>'product_name')
          order by p.created_at limit 1),
         today, (l->>'in_store')::integer, (l->>'sold')::integer, req,
         p_lat, p_lng, p_accuracy_m, dist, p_photo_path
  from jsonb_array_elements(p_lines) l
  on conflict (user_id, outlet_id, product_id, count_date)
  do update set in_store = excluded.in_store, sold = excluded.sold,
                request_id = excluded.request_id, lat = excluded.lat, lng = excluded.lng,
                accuracy_m = excluded.accuracy_m, distance_m = excluded.distance_m,
                photo_path = excluded.photo_path, updated_at = now();
  get diagnostics saved = row_count;

  -- B. Does it add up? Compared with this person's previous count at this store.
  -- A correction later the same day replaces today's flags rather than adding more.
  delete from public.integrity_flags
  where user_id = auth.uid() and outlet_id = p_outlet_id and flag_date = today
    and kind like 'count_%' and reviewed_at is null;

  with cur as (
    select c.product_id, c.in_store, c.sold from public.store_counts c
    where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today
  ), prev as (
    select distinct on (c.product_id) c.product_id, c.in_store, c.sold
    from public.store_counts c
    where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date < today
    order by c.product_id, c.count_date desc
  )
  select jsonb_agg(jsonb_build_object(
           'product', pr.name, 'last_left', prev.in_store, 'sold', cur.sold,
           'expected_left', prev.in_store - cur.sold, 'left', cur.in_store,
           'missing', prev.in_store - cur.sold - cur.in_store))
    into missing
  from cur join prev using (product_id) join public.products pr on pr.id = cur.product_id
  -- Fewer units than last time minus what was sold: stock went somewhere.
  -- More is fine: that is a delivery.
  where prev.in_store - cur.sold - cur.in_store > greatest(2, 0.1 * prev.in_store);

  if missing is not null then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (auth.uid(), 'count_units_missing', 'high',
            format('%s product(s) have fewer units left than the last count minus sales',
                   jsonb_array_length(missing)),
            jsonb_build_object('products', missing), p_outlet_id);
  end if;

  if (select count(*) from public.store_counts c
      where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today) >= 2
     and not exists (
       select 1 from public.store_counts cur
       where cur.user_id = auth.uid() and cur.outlet_id = p_outlet_id and cur.count_date = today
         and not exists (
           select 1 from public.store_counts prev
           where prev.user_id = cur.user_id and prev.outlet_id = cur.outlet_id
             and prev.product_id = cur.product_id and prev.in_store = cur.in_store
             and prev.sold = cur.sold
             and prev.count_date = (select max(p2.count_date) from public.store_counts p2
                                    where p2.user_id = cur.user_id and p2.outlet_id = cur.outlet_id
                                      and p2.count_date < today)))
  then
    insert into public.integrity_flags (user_id, kind, severity, summary, outlet_id)
    values (auth.uid(), 'count_identical', 'medium',
            'Every number is exactly the same as the previous count', p_outlet_id);
  end if;

  if (select count(*) from public.store_counts c
      where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today) >= 4
     and not exists (
       select 1 from public.store_counts c
       where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today
         and (c.in_store % 10 <> 0 or c.sold % 10 <> 0))
     and exists (
       select 1 from public.store_counts c
       where c.user_id = auth.uid() and c.outlet_id = p_outlet_id and c.count_date = today
         and (c.in_store > 0 or c.sold > 0))
  then
    insert into public.integrity_flags (user_id, kind, severity, summary, outlet_id)
    values (auth.uid(), 'count_round_numbers', 'low',
            'Every number in the count is a multiple of 10', p_outlet_id);
  end if;

  return saved;
end;
$$;

revoke all on function public.submit_store_count(uuid, jsonb, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.submit_store_count(uuid, jsonb, double precision, double precision, double precision, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- An admin confirms which waiting store a learned place is. The store
-- takes the position; the place goes, because the store now names it.
-- ---------------------------------------------------------------------
create or replace function public.pin_store_from_place(p_place uuid, p_outlet uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  place record;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can confirm a store''s location';
  end if;

  select k.lat, k.lng, k.address into place from public.known_places k where k.id = p_place;
  if place is null then
    raise exception 'That place no longer exists';
  end if;

  update public.outlets
  set lat = place.lat, lng = place.lng, address = coalesce(place.address, address)
  where id = p_outlet and lat is null;
  if not found then
    raise exception 'That store already has a location. Change it on the Outlets page';
  end if;

  delete from public.known_places where id = p_place;
  update public.known_places
  set store_candidates = array_remove(store_candidates, p_outlet)
  where p_outlet = any(store_candidates);
end;
$$;

revoke all on function public.pin_store_from_place(uuid, uuid) from public, anon;
grant execute on function public.pin_store_from_place(uuid, uuid) to authenticated, service_role;

-- READ MODEL for the Places page: the waiting stores a spot could be.
create or replace view public.known_place_detail
with (security_invoker = true) as
  select k.id, k.name, k.address, k.lat, k.lng, k.radius_m, k.source, k.verified,
         k.times_seen, k.created_at, k.last_seen_at, p.full_name as named_by_name,
         k.named_by, k.photo_path,
         cardinality(k.visitors) as visitor_count,
         (k.source = 'staff' and k.visitors = array[k.named_by]) as only_namer_visits,
         coalesce((
           select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
           from public.outlets o
           where o.id = any(k.store_candidates) and o.lat is null
         ), '[]'::jsonb) as candidate_stores,
         coalesce((
           select jsonb_agg(v.full_name order by v.full_name)
           from public.profiles v
           where v.id = any(k.visitors)
         ), '[]'::jsonb) as visitor_names
  from public.known_places k
  left join public.profiles p on p.id = k.named_by;

grant select on public.known_place_detail to authenticated;

select 'Stores pinned from clock-ins (030) installed' as result;
