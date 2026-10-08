-- =====================================================================
-- 0045: Naming an unknown place is mandatory
--
-- When someone clocks in, or checks in on a store visit, at a spot Xtend
-- cannot recognise (not inside a store, not a place already learned, and
-- no map could name it), they must name it before going on. Naming takes
-- two live photos from the in-app camera, never uploads:
--   1. the outside of the building with the store sign showing;
--   2. a selfie of them holding one of our products.
-- The position saved is the phone's GPS fix at the moment of the photos,
-- read by the app, never typed. From then on Xtend recognises the place
-- for everyone.
--
-- Until it is named, that day's store visits, store counts, X Metrics
-- counts and sales and the daily report are refused. Clocking out is
-- never blocked. The rule lasts only for the day it arose, and an admin
-- or the person's supervisor can dismiss it (say, a clock-in at a spot
-- that is not a shop), so nobody is stuck.
-- =====================================================================

-- The selfie with a product is a photo kind of its own.
alter table public.photo_checks drop constraint if exists photo_checks_kind_check;
alter table public.photo_checks add constraint photo_checks_kind_check
  check (kind in ('selfie', 'shelf', 'storefront', 'product_selfie'));

-- A named place keeps both photos, and where the phone was for each.
alter table public.known_places add column if not exists selfie_path text;
alter table public.known_places add column if not exists position_evidence jsonb;

create table if not exists public.place_naming_due (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  lat             double precision not null,
  lng             double precision not null,
  accuracy_m      double precision,
  source_kind     text not null check (source_kind in ('clock_in', 'visit')),
  source_id       uuid not null,
  due_date        date not null,
  created_at      timestamptz not null default now(),
  named_at        timestamptz,
  place_id        uuid references public.known_places(id) on delete set null,
  dismissed_at    timestamptz,
  dismissed_by    uuid references public.profiles(id) on delete set null,
  dismiss_reason  text check (dismiss_reason is null or length(btrim(dismiss_reason)) between 3 and 300),
  unique (source_kind, source_id)
);
create index if not exists place_naming_due_open
  on public.place_naming_due (user_id, due_date) where named_at is null and dismissed_at is null;

alter table public.place_naming_due enable row level security;
drop policy if exists place_naming_due_read on public.place_naming_due;
create policy place_naming_due_read on public.place_naming_due for select
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));
revoke insert, update, delete, truncate on public.place_naming_due from anon, authenticated;

-- Whether Xtend already knows this spot: inside a store, or a place with a
-- real name. A 'clock_in' place is only a guess at a store (034).
create or replace function public.place_is_recognised(p_lat double precision, p_lng double precision)
returns boolean language sql stable security definer set search_path = public as $$
  select public.outlet_containing(p_lat, p_lng) is not null
      or exists (select 1 from public.known_place_at(p_lat, p_lng) k where k.source <> 'clock_in');
$$;

-- A position the phone sent as {lat, lng, accuracy_m}, or null.
create or replace function public.position_point(p jsonb)
returns table (lat double precision, lng double precision, accuracy_m double precision)
language sql immutable as $$
  select (p->>'lat')::float8, (p->>'lng')::float8, (p->>'accuracy_m')::float8
  where jsonb_typeof(p) = 'object'
    and jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number'
    and jsonb_typeof(p->'accuracy_m') = 'number'
    and abs((p->>'lat')::float8) <= 90 and abs((p->>'lng')::float8) <= 180
    and (p->>'accuracy_m')::float8 >= 0;
$$;

-- p_position is device_info.position: the first fix and the one read at
-- the camera's shutter. Someone is only asked to add a place where the two
-- agree; a fix that jumped between them is not a place to save.
create or replace function public.raise_place_due(
  p_user uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_kind text, p_source uuid, p_position jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  shot record;
  apart double precision;
  at_lat double precision := p_lat;
  at_lng double precision := p_lng;
  at_acc double precision := p_accuracy;
begin
  -- A rough fix cannot say which building; that is flagged elsewhere.
  if p_lat is null or p_lng is null or coalesce(p_accuracy, 1000) > 100 then
    return;
  end if;

  select * into shot from public.position_point(p_position->'shutter');
  if shot.lat is not null then
    apart := public.distance_metres(p_lat, p_lng, shot.lat, shot.lng);
    -- The two readings disagree: the spot is not certain enough to save.
    if apart > greatest(30, coalesce(p_accuracy, 0) + coalesce(shot.accuracy_m, 0)) then
      return;
    end if;
    -- Either reading inside a store or a known place: it is recognised.
    if public.place_is_recognised(shot.lat, shot.lng) then
      return;
    end if;
    -- The surer of the two is where the place is.
    if shot.accuracy_m < p_accuracy then
      at_lat := shot.lat; at_lng := shot.lng; at_acc := shot.accuracy_m;
    end if;
  end if;

  if public.place_is_recognised(p_lat, p_lng) then
    return;
  end if;
  -- Already asked about this spot today, or let off it (a dismissal holds
  -- for the rest of the day there).
  if exists (select 1 from public.place_naming_due d
             where d.user_id = p_user and d.due_date = public.business_date()
               and d.named_at is null
               and public.distance_metres(at_lat, at_lng, d.lat, d.lng) <= 150) then
    return;
  end if;
  insert into public.place_naming_due (user_id, lat, lng, accuracy_m, source_kind, source_id, due_date)
  values (p_user, at_lat, at_lng, at_acc, p_kind, p_source, public.business_date())
  on conflict do nothing;
end;
$$;
drop function if exists public.raise_place_due(uuid, double precision, double precision, double precision, text, uuid);
revoke all on function public.raise_place_due(uuid, double precision, double precision, double precision, text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.attendance_place_due()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'opening' then
    perform public.raise_place_due(new.user_id, new.lat, new.lng, new.accuracy_m, 'clock_in', new.id,
                                   new.device_info->'position');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_attendance_zz_place_due on public.attendance;
-- Named to run after the other AFTER triggers, so a waiting store pinned by
-- this very clock-in (034) counts as recognised.
create trigger trg_attendance_zz_place_due after insert on public.attendance
  for each row execute function public.attendance_place_due();

create or replace function public.visit_place_due()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.outlet_id is null then
    perform public.raise_place_due(new.user_id, new.arrived_lat, new.arrived_lng, new.arrived_accuracy_m,
                                   'visit', new.id, new.device_info->'position');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_store_visits_zz_place_due on public.store_visits;
create trigger trg_store_visits_zz_place_due after insert on public.store_visits
  for each row execute function public.visit_place_due();

-- The caller's place still to name today, if any.
create or replace function public.my_place_due()
returns table (id uuid, lat double precision, lng double precision, source_kind text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.id, d.lat, d.lng, d.source_kind, d.created_at
  from public.place_naming_due d
  where d.user_id = auth.uid() and d.due_date = public.business_date()
    and d.named_at is null and d.dismissed_at is null
  order by d.created_at
  limit 1;
$$;
revoke all on function public.my_place_due() from public, anon;
grant execute on function public.my_place_due() to authenticated, service_role;

-- Refuses other work while a place is waiting to be named. The hint lets
-- the app tell this apart from a bad submission, so nothing kept offline
-- is thrown away: it waits until the place is named.
create or replace function public.place_due_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (select 1 from public.my_place_due()) then
    raise exception 'Name the place you clocked in at first: take a photo of the store sign outside and a selfie with our product'
      using hint = 'place_naming_due';
  end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['store_visits', 'store_counts', 'xm_counts', 'xm_sales', 'reports'] loop
    execute format('drop trigger if exists trg_%s_place_due_guard on public.%I', t, t);
    execute format('create trigger trg_%s_place_due_guard before insert on public.%I
                    for each row execute function public.place_due_guard()', t, t);
  end loop;
end $$;

-- Names the place: both photos taken just now in the app and checked, the
-- phone's own fix, standing where the place was found.
-- p_evidence is where the phone was: {first, sign, selfie}, each
-- {lat, lng, accuracy_m}, read when the naming began and at each photo's
-- shutter. When the phone could read them, they must agree.
create or replace function public.name_place(
  p_due uuid, p_name text, p_lat double precision, p_lng double precision, p_accuracy_m double precision,
  p_storefront_path text, p_selfie_path text, p_evidence jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  sign_at record;
  selfie_at record;
  me uuid := auth.uid();
  due public.place_naming_due;
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  clash text;
  here record;
  place uuid;
begin
  select * into due from public.place_naming_due where id = p_due;
  if due.id is null or due.user_id <> me then
    raise exception 'There is no place for you to name';
  end if;
  if due.named_at is not null or due.dismissed_at is not null then
    return due.place_id;
  end if;

  if length(clean) < 2 or length(clean) > 120 then
    raise exception 'Type the name on the store sign';
  end if;
  if p_lat is null or p_lng is null or p_accuracy_m is null or p_accuracy_m > 100 then
    raise exception 'Your location is not accurate enough. Step outside, away from the building, and try again';
  end if;
  if public.distance_metres(p_lat, p_lng, due.lat, due.lng) > 200 then
    raise exception 'Name the place from where you clocked in: you are % m away', round(public.distance_metres(p_lat, p_lng, due.lat, due.lng)::numeric);
  end if;

  -- The sign photo was taken where the place is being saved, and the
  -- selfie close by.
  select * into sign_at from public.position_point(p_evidence->'sign');
  if sign_at.lat is not null
     and public.distance_metres(p_lat, p_lng, sign_at.lat, sign_at.lng)
         > greatest(30, p_accuracy_m + coalesce(sign_at.accuracy_m, 0)) then
    raise exception 'Your location moved while you took the photo of the sign. Stand still outside and take it again';
  end if;
  select * into selfie_at from public.position_point(p_evidence->'selfie');
  if selfie_at.lat is not null
     and public.distance_metres(p_lat, p_lng, selfie_at.lat, selfie_at.lng)
         > greatest(100, p_accuracy_m + coalesce(selfie_at.accuracy_m, 0)) then
    raise exception 'Take the selfie at the place, next to the sign';
  end if;

  if p_storefront_path is null or not public.photo_is_fresh('reports', p_storefront_path, 30)
     or not exists (select 1 from public.photo_checks c where c.path = p_storefront_path
                    and c.kind = 'storefront' and c.verdict in ('pass', 'unchecked')) then
    raise exception 'Take the photo of the store sign from outside, in the app';
  end if;
  if p_selfie_path is null or not public.photo_is_fresh('reports', p_selfie_path, 30)
     or not exists (select 1 from public.photo_checks c where c.path = p_selfie_path
                    and c.kind = 'product_selfie' and c.verdict in ('pass', 'unchecked')) then
    raise exception 'Take the selfie holding our product, in the app';
  end if;
  if exists (select 1 from public.known_places k
             where k.photo_path in (p_storefront_path, p_selfie_path)
                or k.selfie_path in (p_storefront_path, p_selfie_path)) then
    raise exception 'Take new photos here';
  end if;

  -- A name that belongs to a store or place somewhere else is refused (025).
  select x.name into clash from (
    select o.name, public.distance_metres(p_lat, p_lng, o.lat, o.lng) as m
    from public.outlets o where o.is_active and o.lat is not null and public.names_overlap(o.name, clean)
    union all
    select k.name, public.distance_metres(p_lat, p_lng, k.lat, k.lng)
    from public.known_places k where k.verified and public.names_overlap(k.name, clean)
  ) x where x.m > 500 order by x.m limit 1;
  if clash is not null then
    raise exception 'That name does not match where you are standing. Type the name on the sign here';
  end if;

  select k.id, k.source into here from public.known_place_at(p_lat, p_lng) k;
  if here.id is not null and here.source = 'clock_in' then
    -- The guess from a clock-in (034) gets its real name and photos.
    update public.known_places
    set name = clean, source = 'staff', named_by = me, photo_path = p_storefront_path,
        selfie_path = p_selfie_path, position_evidence = p_evidence, lat = p_lat, lng = p_lng, last_seen_at = now(),
        visitors = case when me = any(visitors) then visitors else visitors || me end
    where id = here.id;
    place := here.id;
  elsif here.id is not null then
    -- Named by someone else since: nothing to add.
    place := here.id;
  elsif public.outlet_containing(p_lat, p_lng) is null then
    place := public.learn_place(p_lat, p_lng, clean, null, 'staff', p_storefront_path);
    update public.known_places set selfie_path = p_selfie_path, position_evidence = p_evidence where id = place;
  end if;

  update public.place_naming_due
  set named_at = now(), place_id = place
  where user_id = me and named_at is null and dismissed_at is null
    and (id = due.id or public.distance_metres(lat, lng, p_lat, p_lng) <= 200);
  return place;
end;
$$;
drop function if exists public.name_place(uuid, text, double precision, double precision, double precision, text, text);
revoke all on function public.name_place(uuid, text, double precision, double precision, double precision, text, text, jsonb)
  from public, anon;
grant execute on function public.name_place(uuid, text, double precision, double precision, double precision, text, text, jsonb)
  to authenticated, service_role;

-- An admin, or the person's supervisor, lets them off (not a shop, say).
create or replace function public.dismiss_place_due(p_due uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  select user_id into who from public.place_naming_due where id = p_due;
  if who is null then raise exception 'That does not exist'; end if;
  if not (public.is_admin() or public.supervises_user(who)) then
    raise exception 'Only an admin or their supervisor can do that';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why';
  end if;
  update public.place_naming_due
  set dismissed_at = now(), dismissed_by = auth.uid(), dismiss_reason = btrim(p_reason)
  where id = p_due and named_at is null and dismissed_at is null;
  if not found then raise exception 'It was already named or dismissed'; end if;
end;
$$;
revoke all on function public.dismiss_place_due(uuid, text) from public, anon;
grant execute on function public.dismiss_place_due(uuid, text) to authenticated, service_role;

-- For the dashboard.
create or replace view public.place_naming_due_detail
with (security_invoker = true) as
  select d.*, p.full_name as staff_name, k.name as place_name, db.full_name as dismissed_by_name
  from public.place_naming_due d
  join public.profiles p on p.id = d.user_id
  left join public.known_places k on k.id = d.place_id
  left join public.profiles db on db.id = d.dismissed_by;
grant select on public.place_naming_due_detail to authenticated;

-- The learned-places view shows the selfie too.
create or replace view public.known_place_detail
with (security_invoker = true) as
 select k.id, k.name, k.address, k.lat, k.lng, k.radius_m, k.source, k.verified, k.times_seen,
        k.created_at, k.last_seen_at, p.full_name as named_by_name, k.named_by, k.photo_path,
        cardinality(k.visitors) as visitor_count,
        (k.source = 'staff' and k.visitors = array[k.named_by]) as only_namer_visits,
        coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name) order by o.name)
                  from public.outlets o where o.id = any (k.store_candidates) and o.lat is null), '[]'::jsonb)
          as candidate_stores,
        coalesce((select jsonb_agg(v.full_name order by v.full_name)
                  from public.profiles v where v.id = any (k.visitors)), '[]'::jsonb) as visitor_names,
        k.selfie_path
 from public.known_places k
 left join public.profiles p on p.id = k.named_by;

select 'Mandatory place naming (045) installed' as result;
