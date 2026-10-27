-- =====================================================================
-- XTEND migration 0068 — Google only for places Xtend has never seen
--
-- Naming where somebody stands goes, best first: their own store, any
-- store, a place Xtend learned before, an address Xtend saved before, then
-- Google, then OpenStreetMap (src/lib/geocode.ts). Google is paid per
-- request, so everything it finds is kept and the same spot is never sent
-- to it twice. This closes three gaps and adds a counter:
--
-- 1. The phone's background tracker has nobody signed in (0050), so the
--    server named "left the store" spots without learning them:
--    learn_place() needs auth.uid(). learn_place_for(person, ...) is the
--    same learning for the server alone (service role only): map names
--    only (a person's own naming still needs their photos, through
--    name_place), the same name rules, nothing learned inside a store, an
--    existing place counted as seen again with the person as a visitor.
--    note_place_visit_for(person, place) likewise counts a visit for the
--    server; note_place_visit() now uses it for the signed-in caller, so
--    the "only its namer goes there" check (025) is the same either way.
--
-- 2. When Google finds no shop near a spot it still gives the street
--    address. That is not a place name, and learned places are names:
--    saving an address there would make the spot count as recognised, so
--    nobody would be asked to add the shop (0045), and the audit log would
--    call a street a place (0049). So addresses are kept on their own, in
--    place_addresses, which only the naming code reads (address_at), and
--    within 40 m of a saved address Google is not asked again. A learned
--    place or a store always comes first.
--
-- 3. place_lookup_stats counts, per Lagos month, every lookup by what
--    answered it (a store, a learned place, a saved address, the server's
--    30-day cache, Google, OpenStreetMap, nothing) and every request
--    actually sent to Google, by kind. The server adds to it through
--    count_place_lookups() (service role only); admins read it on the
--    Places page. google_calls_this_month() is what the optional
--    GOOGLE_MONTHLY_LOOKUP_LIMIT is measured against.
--
-- Both new tables are kept by a test-mode reset (0066): they are map
-- answers and counts, not anybody's records.
-- =====================================================================

do $$
begin
  if to_regclass('public.place_naming_due') is null then
    raise exception 'Run the mandatory place naming update (0045) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Learning for the server.
-- ---------------------------------------------------------------------
create or replace function public.learn_place_for(
  p_user uuid,
  p_lat double precision,
  p_lng double precision,
  p_name text,
  p_address text,
  p_source text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  found uuid;
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown person';
  end if;
  -- A person names a place with their own photos, through name_place().
  if p_source is null or p_source not in ('google', 'osm') then
    raise exception 'Only places named by a map are learned for someone';
  end if;
  if length(clean) < 2 or length(clean) > 120 then
    raise exception 'A place name needs 2 to 120 characters';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'A place needs a position';
  end if;

  -- Inside a store: the store's own record already names it.
  if public.outlet_containing(p_lat, p_lng) is not null then
    return null;
  end if;

  select k.id into found from public.known_place_at(p_lat, p_lng) k;
  if found is not null then
    update public.known_places
    set times_seen = times_seen + 1, last_seen_at = now(),
        visitors = case when p_user = any(visitors) then visitors else visitors || p_user end
    where id = found;
    return found;
  end if;

  insert into public.known_places (name, address, lat, lng, source, named_by, visitors)
  values (clean, nullif(btrim(coalesce(p_address, '')), ''), p_lat, p_lng, p_source, null, array[p_user])
  returning id into found;
  return found;
end;
$$;

revoke all on function public.learn_place_for(uuid, double precision, double precision, text, text, text)
  from public, anon, authenticated;
grant execute on function public.learn_place_for(uuid, double precision, double precision, text, text, text)
  to service_role;

-- A person was found at a learned place: the same rule as 025.
create or replace function public.note_place_visit_for(p_user uuid, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  place record;
begin
  if p_user is null or p_id is null then
    return;
  end if;
  update public.known_places
  set times_seen = times_seen + 1, last_seen_at = now(),
      visitors = case when p_user = any(visitors) then visitors else visitors || p_user end
  where id = p_id
  returning id, name, source, verified, named_by, visitors, times_seen into place;

  if place.id is not null and place.source = 'staff' and not place.verified
     and place.named_by = p_user and place.visitors = array[p_user] and place.times_seen >= 3
     and not exists (select 1 from public.integrity_flags f
                     where f.kind = 'own_named_place' and f.detail->>'place_id' = place.id::text) then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (p_user, 'own_named_place', 'medium',
            format('Keeps being found at "%s", a place they named themselves that nobody else has visited',
                   place.name),
            jsonb_build_object('place_id', place.id, 'times', place.times_seen));
  end if;
end;
$$;

revoke all on function public.note_place_visit_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.note_place_visit_for(uuid, uuid) to service_role;

create or replace function public.note_place_visit(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return;
  end if;
  perform public.note_place_visit_for(auth.uid(), p_id);
end;
$$;

revoke all on function public.note_place_visit(uuid) from public, anon;
grant execute on function public.note_place_visit(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Addresses Google gave without a shop name.
-- ---------------------------------------------------------------------
create table if not exists public.place_addresses (
  id           uuid primary key default gen_random_uuid(),
  address      text not null check (length(btrim(address)) between 3 and 400),
  lat          double precision not null check (lat between -90 and 90),
  lng          double precision not null check (lng between -180 and 180),
  radius_m     integer not null default 40 check (radius_m between 15 and 200),
  source       text not null default 'google' check (source in ('google')),
  times_seen   integer not null default 1,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists place_addresses_by_position on public.place_addresses (lat, lng);

alter table public.place_addresses enable row level security;
drop policy if exists place_addresses_admin_read on public.place_addresses;
create policy place_addresses_admin_read on public.place_addresses
  for select using (public.is_admin());
revoke insert, update, delete, truncate on public.place_addresses from anon, authenticated;

-- The saved address covering this spot, nearest first; counted as used.
create or replace function public.address_at(p_lat double precision, p_lng double precision)
returns text
language plpgsql security definer set search_path = public as $$
declare
  hit record;
begin
  if p_lat is null or p_lng is null then
    return null;
  end if;
  select a.id, a.address into hit
  from public.place_addresses a
  where a.lat between p_lat - 0.005 and p_lat + 0.005
    and a.lng between p_lng - 0.005 and p_lng + 0.005
    and public.distance_metres(p_lat, p_lng, a.lat, a.lng) <= a.radius_m
  order by public.distance_metres(p_lat, p_lng, a.lat, a.lng)
  limit 1;
  if hit.id is null then
    return null;
  end if;
  update public.place_addresses set times_seen = times_seen + 1, last_seen_at = now() where id = hit.id;
  return hit.address;
end;
$$;

revoke all on function public.address_at(double precision, double precision) from public, anon, authenticated;
grant execute on function public.address_at(double precision, double precision) to service_role;

-- Keeps an address Google gave. Nothing is kept inside a store or a
-- learned place (those name the spot already); near a saved address it
-- is counted as seen again.
create or replace function public.remember_address(
  p_lat double precision,
  p_lng double precision,
  p_address text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  clean text := regexp_replace(btrim(coalesce(p_address, '')), '\s+', ' ', 'g');
  found uuid;
begin
  if length(clean) < 3 or length(clean) > 400 then
    raise exception 'An address needs 3 to 400 characters';
  end if;
  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    raise exception 'An address needs a position';
  end if;
  if public.outlet_containing(p_lat, p_lng) is not null
     or exists (select 1 from public.known_place_at(p_lat, p_lng)) then
    return null;
  end if;

  select a.id into found
  from public.place_addresses a
  where a.lat between p_lat - 0.005 and p_lat + 0.005
    and a.lng between p_lng - 0.005 and p_lng + 0.005
    and public.distance_metres(p_lat, p_lng, a.lat, a.lng) <= a.radius_m
  order by public.distance_metres(p_lat, p_lng, a.lat, a.lng)
  limit 1;
  if found is not null then
    update public.place_addresses set times_seen = times_seen + 1, last_seen_at = now() where id = found;
    return found;
  end if;

  insert into public.place_addresses (address, lat, lng) values (clean, p_lat, p_lng)
  returning id into found;
  return found;
end;
$$;

revoke all on function public.remember_address(double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.remember_address(double precision, double precision, text) to service_role;

-- ---------------------------------------------------------------------
-- 3. How lookups were answered, and how many went to Google.
-- ---------------------------------------------------------------------
create or replace function public.place_lookup_sources()
returns text[] language sql immutable as $$
  -- Answers: who named the spot. Calls: requests actually sent to Google.
  select array['store', 'known', 'address', 'cache', 'google', 'osm', 'none',
               'call_nearby', 'call_geocode', 'call_text_search', 'call_forward_geocode'];
$$;

create table if not exists public.place_lookup_stats (
  month      date not null check (extract(day from month) = 1),
  source     text not null check (source = any (public.place_lookup_sources())),
  lookups    bigint not null default 0 check (lookups >= 0),
  updated_at timestamptz not null default now(),
  primary key (month, source)
);

alter table public.place_lookup_stats enable row level security;
drop policy if exists place_lookup_stats_admin_read on public.place_lookup_stats;
create policy place_lookup_stats_admin_read on public.place_lookup_stats
  for select using (public.is_admin());
revoke insert, update, delete, truncate on public.place_lookup_stats from anon, authenticated;

-- Adds one to each source listed (a source may be listed twice). Unknown
-- names are ignored: counting never gets in the way of naming a place.
create or replace function public.count_place_lookups(p_sources text[])
returns void
language plpgsql security definer set search_path = public as $$
declare
  this_month date := date_trunc('month', public.business_date())::date;
begin
  insert into public.place_lookup_stats as s (month, source, lookups)
  select this_month, x.source, count(*)
  from unnest(coalesce(p_sources, '{}')) as x(source)
  where x.source = any (public.place_lookup_sources())
  group by x.source
  on conflict (month, source)
  do update set lookups = s.lookups + excluded.lookups, updated_at = now();
end;
$$;

revoke all on function public.count_place_lookups(text[]) from public, anon, authenticated;
grant execute on function public.count_place_lookups(text[]) to service_role;

-- Requests sent to Google so far this Lagos month.
create or replace function public.google_calls_this_month()
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(s.lookups), 0)::bigint
  from public.place_lookup_stats s
  where s.month = date_trunc('month', public.business_date())::date
    and s.source like 'call\_%';
$$;

revoke all on function public.google_calls_this_month() from public, anon, authenticated;
grant execute on function public.google_calls_this_month() to service_role;

select 'Place lookups (0068) installed' as result;
