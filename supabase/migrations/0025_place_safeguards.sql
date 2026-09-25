-- =====================================================================
-- XTEND migration 025 — nobody passes their house off as a shop
--
-- Learned places (024) let staff name spots the maps do not know. That
-- invites one trick: stand at home, name it "Ikeja City Mall", and let the
-- office read that name on every clock-in. So:
--
--   1. A name that copies one of the stores, or a verified place, is
--      refused unless the person is standing near that store.
--   2. Naming a place needs a photo of the shop front, checked by the
--      server like every other photo; a house is rejected there.
--   3. Unverified staff names say so wherever they appear (the app does
--      this; see geocode.ts), until an admin verifies them.
--   4. Xtend remembers who visits each learned place. One the person who
--      named it keeps using, and nobody else ever visits, is flagged.
--   5. A selfie whose background looks like a home is flagged (the server's
--      photo check reports it).
--
-- And since the list now records who was where, only admins read it;
-- staff are told the name of the place they stand in, nothing more.
--
-- Being on or off site is still measured against the stores alone, so none
-- of this could ever make somebody count as present; it keeps the names
-- honest.
-- =====================================================================

do $$
begin
  if to_regclass('public.known_places') is null then
    raise exception 'Run the learned places update (024) first, then this file';
  end if;
end $$;

alter table public.known_places
  add column if not exists photo_path text,
  add column if not exists visitors uuid[] not null default '{}';

-- The list now says who was where, so only admins read it directly. Staff
-- are told a place's name through known_place_at() and nothing more.
drop policy if exists known_places_read on public.known_places;

-- The shop-front photo is checked like selfies and shelf photos.
alter table public.photo_checks drop constraint if exists photo_checks_kind_check;
alter table public.photo_checks add constraint photo_checks_kind_check
  check (kind in ('selfie', 'shelf', 'storefront'));

alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check check (kind in (
  'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
  'count_units_missing', 'count_identical', 'count_round_numbers',
  'photo_rejected', 'photo_unchecked', 'own_named_place', 'selfie_at_home'));

-- A name reduced to its words: "Ikeja City-Mall!" and "ikeja city mall" match.
create or replace function public.place_key(p_name text)
returns text language sql immutable as $$
  select btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Whether one name contains the other as whole words.
create or replace function public.names_overlap(a text, b text)
returns boolean language sql immutable as $$
  select length(public.place_key(a)) >= 6 and length(public.place_key(b)) >= 6
     and (' ' || public.place_key(a) || ' ' like '% ' || public.place_key(b) || ' %'
          or ' ' || public.place_key(b) || ' ' like '% ' || public.place_key(a) || ' %');
$$;

drop function if exists public.learn_place(double precision, double precision, text, text, text);

create or replace function public.learn_place(
  p_lat double precision,
  p_lng double precision,
  p_name text,
  p_address text,
  p_source text,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  found uuid;
  clash record;
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

  if public.outlet_containing(p_lat, p_lng) is not null then
    return null;
  end if;

  select k.id into found from public.known_place_at(p_lat, p_lng) k;
  if found is not null then
    update public.known_places
    set times_seen = times_seen + 1, last_seen_at = now(),
        visitors = case when me = any(visitors) then visitors else visitors || me end
    where id = found;
    return found;
  end if;

  if p_source = 'staff' then
    -- 1. Not a store's name, or a verified place's, from somewhere else.
    select x.name, x.km into clash from (
      select o.name, public.distance_metres(p_lat, p_lng, o.lat, o.lng) / 1000.0 as km
      from public.outlets o
      where o.is_active and public.names_overlap(o.name, clean)
      union all
      select k.name, public.distance_metres(p_lat, p_lng, k.lat, k.lng) / 1000.0
      from public.known_places k
      where k.verified and public.names_overlap(k.name, clean)
    ) x
    where x.km > 0.5
    order by x.km
    limit 1;
    if clash.name is not null then
      raise exception '"%" is a known place % km from here. Name this place by its own name',
        clash.name, round(clash.km::numeric, 1);
    end if;

    -- 2. A shop-front photo, taken just now and passed by the check.
    -- It has to be checked as a place (not a shelf photo passed off as
    -- one), and one photo names one place.
    if p_photo_path is null or not public.photo_is_fresh('reports', p_photo_path, 30)
       or not exists (select 1 from public.photo_checks c
                      where c.path = p_photo_path and c.kind = 'storefront') then
      raise exception 'Take a photo of the shop front or sign to name this place';
    end if;
    if exists (select 1 from public.known_places k where k.photo_path = p_photo_path) then
      raise exception 'That photo has already named a place. Take a new one here';
    end if;

    if (select count(*) from public.known_places k
        where k.named_by = me and k.source = 'staff' and k.created_at > now() - interval '1 day') >= 10 then
      raise exception 'You have named 10 places today. Ask your supervisor to add more';
    end if;
  end if;

  insert into public.known_places (name, address, lat, lng, source, named_by, photo_path, visitors)
  values (clean, nullif(btrim(coalesce(p_address, '')), ''), p_lat, p_lng, p_source,
          case when p_source = 'staff' then me end,
          case when p_source = 'staff' then p_photo_path end,
          array[me])
  returning id into found;
  return found;
end;
$$;

revoke all on function public.learn_place(double precision, double precision, text, text, text, text) from public, anon;
grant execute on function public.learn_place(double precision, double precision, text, text, text, text) to authenticated, service_role;

-- 4. Somebody was found at a learned place (a clock-in, check-in or off-site alert).
-- A staff-named place that nobody but its namer has visited, three times
-- over, is flagged once for a supervisor to look at.
create or replace function public.note_place_visit(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  place record;
begin
  if me is null then
    return;
  end if;
  update public.known_places
  set times_seen = times_seen + 1, last_seen_at = now(),
      visitors = case when me = any(visitors) then visitors else visitors || me end
  where id = p_id
  returning id, name, source, verified, named_by, visitors, times_seen into place;

  if place.id is not null and place.source = 'staff' and not place.verified
     and place.named_by = me and place.visitors = array[me] and place.times_seen >= 3
     and not exists (select 1 from public.integrity_flags f
                     where f.kind = 'own_named_place' and f.detail->>'place_id' = place.id::text) then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (me, 'own_named_place', 'medium',
            format('Keeps being found at "%s", a place they named themselves that nobody else has visited',
                   place.name),
            jsonb_build_object('place_id', place.id, 'times', place.times_seen));
  end if;
end;
$$;

revoke all on function public.note_place_visit(uuid) from public, anon;
grant execute on function public.note_place_visit(uuid) to authenticated, service_role;

-- known_place_at now also says who named it, for the (unverified) label.
drop function if exists public.known_place_at(double precision, double precision);
create or replace function public.known_place_at(p_lat double precision, p_lng double precision)
returns table (id uuid, name text, address text, source text, verified boolean, distance_m double precision)
language sql stable security definer set search_path = public as $$
  select k.id, k.name, k.address, k.source, k.verified,
         public.distance_metres(p_lat, p_lng, k.lat, k.lng) as distance_m
  from public.known_places k
  where k.lat between p_lat - 0.01 and p_lat + 0.01
    and k.lng between p_lng - 0.01 and p_lng + 0.01
    and public.distance_metres(p_lat, p_lng, k.lat, k.lng) <= k.radius_m
  order by k.verified desc, public.distance_metres(p_lat, p_lng, k.lat, k.lng)
  limit 1;
$$;

revoke all on function public.known_place_at(double precision, double precision) from public, anon;
grant execute on function public.known_place_at(double precision, double precision) to authenticated, service_role;

drop view if exists public.known_place_detail;
create view public.known_place_detail
with (security_invoker = true) as
  select k.id, k.name, k.address, k.lat, k.lng, k.radius_m, k.source, k.verified,
         k.times_seen, k.created_at, k.last_seen_at, p.full_name as named_by_name,
         k.named_by, k.photo_path, cardinality(k.visitors) as visitor_count,
         (k.source = 'staff' and k.visitors = array[k.named_by]) as only_namer_visits
  from public.known_places k
  left join public.profiles p on p.id = k.named_by;

grant select on public.known_place_detail to authenticated;

select 'Place safeguards (025) installed' as result;
