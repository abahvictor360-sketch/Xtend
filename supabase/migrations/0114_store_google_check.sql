-- =====================================================================
-- XTEND migration 0114 — Checking the store with Google before "off site"
--
-- 0106 refuses a clock-in or store check-in made outside the store's area,
-- measured from the store's pin. A pin can be wrong (a wrong Google Maps
-- link, a pin dropped on the wrong street), and then someone standing in
-- the store is told "You are off site". Now, before refusing, Xtend asks
-- Google where the store is:
--
--   * store_google_spots: per store, where Google puts it (its name with
--     its address, checked against the address on its own). It counts as
--     "confirmed" only when the two agree, so a branch of the same chain
--     elsewhere does not pass. Saved by the server (service role) after a
--     lookup; looked up again when the name or address changes, or after
--     90 days;
--   * a clock-in or store check-in too far from the pin but inside the
--     store's area around Google's confirmed spot goes through, on site,
--     with device_info {site_confirmed_by: 'google', pin_distance_m,
--     google_distance_m}, and the distance measured from Google's spot;
--   * each use is counted on the store (used_count, last_used_at), so the
--     office sees on Outlets that the pin should be checked;
--   * claim_pin_check_notice(store): at most once a day per store, for the
--     server's notice to admins;
--   * a clock-in let through this way is not asked to name the place.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.store_google_spots (
  outlet_id     uuid primary key references public.outlets(id) on delete cascade,
  -- The name and address the lookup used: a change to either means look again.
  name_used     text not null,
  address_used  text not null default '',
  lat           double precision check (lat is null or lat between -90 and 90),
  lng           double precision check (lng is null or lng between -180 and 180),
  confirmed     boolean not null default false,
  detail        jsonb not null default '{}'::jsonb,
  looked_up_at  timestamptz not null default now(),
  used_count    integer not null default 0,
  last_used_at  timestamptz,
  notified_at   timestamptz,
  check (not confirmed or (lat is not null and lng is not null))
);
comment on table public.store_google_spots is
  'Where Google puts each store (0114): used when the pin says off site.';
alter table public.store_google_spots enable row level security;
revoke all on public.store_google_spots from anon, authenticated;
grant select on public.store_google_spots to authenticated;
drop policy if exists store_google_spots_admin_read on public.store_google_spots;
create policy store_google_spots_admin_read on public.store_google_spots
  for select to authenticated using (public.is_admin());

-- Google's confirmed spot for a store, while its name and address are the
-- ones looked up and the lookup is under 90 days old.
create or replace function public.store_google_spot(p_outlet uuid)
returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = public as $$
  select s.lat, s.lng
  from public.store_google_spots s
  join public.outlets o on o.id = s.outlet_id
  where s.outlet_id = p_outlet
    and s.confirmed
    and s.name_used = o.name
    and s.address_used = coalesce(btrim(o.address), '')
    and s.looked_up_at > now() - interval '90 days';
$$;
revoke all on function public.store_google_spot(uuid) from public, anon, authenticated;
grant execute on function public.store_google_spot(uuid) to service_role;

-- How far a spot is from Google's confirmed spot for the store (null: none).
create or replace function public.google_spot_distance(p_outlet uuid, p_lat double precision, p_lng double precision)
returns double precision
language sql stable security definer set search_path = public as $$
  select public.distance_metres(p_lat, p_lng, g.lat, g.lng) from public.store_google_spot(p_outlet) g;
$$;
revoke all on function public.google_spot_distance(uuid, double precision, double precision) from public, anon, authenticated;

-- Counts a clock-in or check-in that Google's spot let through.
create or replace function public.note_google_spot_used(p_outlet uuid)
returns void
language sql security definer set search_path = public as $$
  update public.store_google_spots set used_count = used_count + 1, last_used_at = now() where outlet_id = p_outlet;
$$;
revoke all on function public.note_google_spot_used(uuid) from public, anon, authenticated;

-- The server saves what Google said. A new name or address starts the count again.
create or replace function public.save_store_google_spot(
  p_outlet uuid, p_name text, p_address text,
  p_lat double precision, p_lng double precision, p_confirmed boolean, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.store_google_spots as s (outlet_id, name_used, address_used, lat, lng, confirmed, detail, looked_up_at)
  values (p_outlet, p_name, coalesce(btrim(p_address), ''), p_lat, p_lng,
          coalesce(p_confirmed, false) and p_lat is not null and p_lng is not null,
          coalesce(p_detail, '{}'::jsonb), now())
  on conflict (outlet_id) do update
    set lat = excluded.lat, lng = excluded.lng, confirmed = excluded.confirmed, detail = excluded.detail,
        looked_up_at = now(),
        used_count = case when s.name_used = excluded.name_used and s.address_used = excluded.address_used
                          then s.used_count else 0 end,
        last_used_at = case when s.name_used = excluded.name_used and s.address_used = excluded.address_used
                            then s.last_used_at end,
        name_used = excluded.name_used, address_used = excluded.address_used;
end;
$$;
revoke all on function public.save_store_google_spot(uuid, text, text, double precision, double precision, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.save_store_google_spot(uuid, text, text, double precision, double precision, boolean, jsonb) to service_role;

-- At most one notice a day per store to the admins: true when it is time.
create or replace function public.claim_pin_check_notice(p_outlet uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.store_google_spots set notified_at = now()
   where outlet_id = p_outlet and (notified_at is null or notified_at < now() - interval '1 day');
  return found;
end;
$$;
revoke all on function public.claim_pin_check_notice(uuid) from public, anon, authenticated;
grant execute on function public.claim_pin_check_notice(uuid) to service_role;

-- Clock-ins (0106), now also accepted inside the area around Google's spot.
create or replace function public.attendance_on_site_only()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  g double precision;
begin
  if new.type <> 'opening' or auth.uid() is null or auth.uid() <> new.user_id or not public.off_site_blocked() then
    return new;
  end if;
  -- Only the database says Google confirmed it.
  new.device_info := coalesce(new.device_info, '{}'::jsonb) - 'site_confirmed_by' - 'pin_distance_m' - 'google_distance_m';
  if new.outlet_id is null or new.distance_m is null or new.accuracy_m > 100 then
    return new;
  end if;
  if public.too_far(new.distance_m, new.outlet_radius_m, new.accuracy_m) then
    g := public.google_spot_distance(new.outlet_id, new.lat, new.lng);
    if g is not null and not public.too_far(g, new.outlet_radius_m, new.accuracy_m) then
      new.device_info := new.device_info || jsonb_build_object(
        'site_confirmed_by', 'google', 'pin_distance_m', round(new.distance_m), 'google_distance_m', round(g));
      new.distance_m := g;
      if new.status is distinct from 'flagged' then
        new.status := 'on_site';
      end if;
      perform public.note_google_spot_used(new.outlet_id);
      return new;
    end if;
    perform public.refuse_off_site(new.outlet_id, new.distance_m, new.outlet_radius_m, 'clock in');
  end if;
  return new;
end;
$$;
revoke all on function public.attendance_on_site_only() from public, anon, authenticated;

-- Store check-ins (0106), the same.
create or replace function public.store_visit_on_site_only()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  near record;
  g double precision;
  o record;
begin
  if auth.uid() is null or auth.uid() <> new.user_id or not public.off_site_blocked() then
    return new;
  end if;
  new.device_info := coalesce(new.device_info, '{}'::jsonb) - 'site_confirmed_by' - 'pin_distance_m' - 'google_distance_m';
  if new.arrived_accuracy_m > 100 then
    return new;
  end if;
  if new.outlet_id is not null then
    if new.arrived_distance_m is not null
       and public.too_far(new.arrived_distance_m, new.outlet_radius_m, new.arrived_accuracy_m) then
      g := public.google_spot_distance(new.outlet_id, new.arrived_lat, new.arrived_lng);
      if g is not null and not public.too_far(g, new.outlet_radius_m, new.arrived_accuracy_m) then
        new.device_info := new.device_info || jsonb_build_object(
          'site_confirmed_by', 'google', 'pin_distance_m', round(new.arrived_distance_m), 'google_distance_m', round(g));
        new.arrived_distance_m := g;
        if new.arrived_status is distinct from 'flagged' then
          new.arrived_status := 'on_site';
        end if;
        perform public.note_google_spot_used(new.outlet_id);
        return new;
      end if;
      perform public.refuse_off_site(new.outlet_id, new.arrived_distance_m, new.outlet_radius_m, 'check in');
    end if;
    return new;
  end if;
  if public.has_allocated_stores(new.user_id)
     and not exists (select 1 from public.outlets x
                     where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
                       and x.is_active and x.lat is null) then
    -- One of their stores by Google's spot: checked in there.
    select x.id, x.lat, x.lng, x.geofence_radius_m,
           public.google_spot_distance(x.id, new.arrived_lat, new.arrived_lng) as d
      into o
    from public.outlets x
    where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
      and x.is_active
      and public.google_spot_distance(x.id, new.arrived_lat, new.arrived_lng) is not null
    order by 5
    limit 1;
    if o.id is not null and not public.too_far(o.d, o.geofence_radius_m, new.arrived_accuracy_m) then
      new.outlet_id := o.id;
      new.outlet_lat := o.lat;
      new.outlet_lng := o.lng;
      new.outlet_radius_m := o.geofence_radius_m;
      new.device_info := new.device_info || jsonb_build_object(
        'site_confirmed_by', 'google',
        'pin_distance_m', round(public.distance_metres(new.arrived_lat, new.arrived_lng, o.lat, o.lng)),
        'google_distance_m', round(o.d));
      new.arrived_distance_m := o.d;
      if new.arrived_status is distinct from 'flagged' then
        new.arrived_status := 'on_site';
      end if;
      perform public.note_google_spot_used(o.id);
      return new;
    end if;
    select x.id, x.geofence_radius_m,
           public.distance_metres(new.arrived_lat, new.arrived_lng, x.lat, x.lng) as d
      into near
    from public.outlets x
    where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
      and x.is_active and x.lat is not null
    order by 3
    limit 1;
    if near.id is not null and public.too_far(near.d, near.geofence_radius_m, new.arrived_accuracy_m) then
      perform public.refuse_off_site(near.id, near.d, near.geofence_radius_m, 'check in');
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.store_visit_on_site_only() from public, anon, authenticated;

-- Let through at Google's spot, the store is known: no "name this place".
create or replace function public.attendance_place_due()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'opening' and new.device_info->>'site_confirmed_by' is distinct from 'google' then
    perform public.raise_place_due(new.user_id, new.lat, new.lng, new.accuracy_m, 'clock_in', new.id,
                                   new.device_info->'position');
  end if;
  return null;
end;
$$;

select 'Store check with Google (0114) installed' as result;
