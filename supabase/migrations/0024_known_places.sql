-- =====================================================================
-- XTEND migration 024 — Xtend learns places for itself
--
-- Google and OpenStreetMap do not know every Nigerian shop. So Xtend keeps
-- its own list: the first time somebody clocks in or checks in somewhere,
-- the place's GPS position and name are recorded, and from then on anyone
-- standing within its radius is told the name from Xtend's own list, with
-- no map lookup at all. Where the maps know nothing, the person standing
-- there names it.
--
-- A learned place only ever names where somebody is. Whether they are at
-- their store, on or off site, is still measured against the outlets, so a
-- wrong name can mislead nobody about attendance. Names typed by staff are
-- unverified until an admin confirms them on the Places page.
-- =====================================================================

create table if not exists public.known_places (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 2 and 120),
  address      text check (address is null or length(address) <= 400),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  radius_m     integer not null default 50 check (radius_m between 15 and 500),
  source       text not null check (source in ('google', 'osm', 'staff', 'admin')),
  verified     boolean not null default false,
  times_seen   integer not null default 1,
  named_by     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists known_places_by_position on public.known_places (lat, lng);

alter table public.known_places enable row level security;

drop policy if exists known_places_read on public.known_places;
create policy known_places_read on public.known_places
  for select using (auth.uid() is not null);

-- Admins correct names, change the radius, verify or delete. Everyone else
-- adds only through learn_place() below.
drop policy if exists known_places_admin on public.known_places;
create policy known_places_admin on public.known_places
  for all using (public.is_admin()) with check (public.is_admin());

revoke insert on public.known_places from anon;

-- The nearest place Xtend already knows that covers this point, if any.
-- Verified names are preferred over unverified ones at the same spot.
create or replace function public.known_place_at(p_lat double precision, p_lng double precision)
returns table (id uuid, name text, address text, source text, verified boolean, distance_m double precision)
language sql stable security definer set search_path = public as $$
  select k.id, k.name, k.address, k.source, k.verified,
         public.distance_metres(p_lat, p_lng, k.lat, k.lng) as distance_m
  from public.known_places k
  -- A cheap box first (about 1 km), then the real distance.
  where k.lat between p_lat - 0.01 and p_lat + 0.01
    and k.lng between p_lng - 0.01 and p_lng + 0.01
    and public.distance_metres(p_lat, p_lng, k.lat, k.lng) <= k.radius_m
  order by k.verified desc, public.distance_metres(p_lat, p_lng, k.lat, k.lng)
  limit 1;
$$;

revoke all on function public.known_place_at(double precision, double precision) from public, anon;
grant execute on function public.known_place_at(double precision, double precision) to authenticated, service_role;

-- Records a place. Called by the server when a map named a spot, and by
-- the app when a person names a place the maps did not know.
--   * Somewhere Xtend already knows, or inside one of the stores: the known
--     place is counted as seen again; nothing new is added.
--   * A person may name at most 10 new places a day, so the list cannot be
--     flooded.
create or replace function public.learn_place(
  p_lat double precision,
  p_lng double precision,
  p_name text,
  p_address text,
  p_source text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  found uuid;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if p_source not in ('google', 'osm', 'staff') then
    raise exception 'Unknown place source';
  end if;
  if length(clean) < 2 or length(clean) > 120 then
    raise exception 'A place name needs 2 to 120 characters';
  end if;

  -- Inside a store: the store's own record already names it.
  if public.outlet_containing(p_lat, p_lng) is not null then
    return null;
  end if;

  select k.id into found from public.known_place_at(p_lat, p_lng) k;
  if found is not null then
    update public.known_places
    set times_seen = times_seen + 1, last_seen_at = now()
    where id = found;
    return found;
  end if;

  if p_source = 'staff' and (
    select count(*) from public.known_places k
    where k.named_by = me and k.source = 'staff' and k.created_at > now() - interval '1 day'
  ) >= 10 then
    raise exception 'You have named 10 places today. Ask your supervisor to add more';
  end if;

  insert into public.known_places (name, address, lat, lng, source, named_by)
  values (clean, nullif(btrim(coalesce(p_address, '')), ''), p_lat, p_lng, p_source,
          case when p_source = 'staff' then me end)
  returning id into found;
  return found;
end;
$$;

revoke all on function public.learn_place(double precision, double precision, text, text, text) from public, anon;
grant execute on function public.learn_place(double precision, double precision, text, text, text) to authenticated, service_role;

-- READ MODEL for the Places page.
create or replace view public.known_place_detail
with (security_invoker = true) as
  select k.id, k.name, k.address, k.lat, k.lng, k.radius_m, k.source, k.verified,
         k.times_seen, k.created_at, k.last_seen_at, p.full_name as named_by_name
  from public.known_places k
  left join public.profiles p on p.id = k.named_by;

grant select on public.known_place_detail to authenticated;

select 'Known places (024) installed' as result;
