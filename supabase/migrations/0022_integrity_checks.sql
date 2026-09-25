-- =====================================================================
-- XTEND migration 022 — making the easy tricks hard
--
--  A. A store count is taken in the store: it carries a live GPS reading
--     that must be inside the store's fence, and a shelf photo taken with
--     the in-app camera moments before.
--  B. Counts that do not add up are flagged for the office: units missing
--     since the last count, a count identical to the last one, and counts
--     made entirely of round numbers.
--  C. Locations that look faked are flagged: the exact same GPS point on
--     different days, an implausibly perfect accuracy, and journeys faster
--     than any car.
--  F. A clock-in or store visit must point at a selfie the person uploaded
--     in the last half hour, and a photo can only ever be used once.
--
-- Flags never block anybody; they go to integrity_flags for a supervisor
-- or admin to review. Only A and F refuse a submission, because those are
-- the rules, not suspicions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Photos: uploaded by this person, into their own folder, recently.
-- ---------------------------------------------------------------------
create or replace function public.photo_is_fresh(p_bucket text, p_path text, p_minutes integer)
returns boolean
language sql stable security definer set search_path = public, storage as $$
  select auth.uid() is not null
     and p_path like auth.uid()::text || '/%'
     and exists (
       select 1 from storage.objects o
       where o.bucket_id = p_bucket
         and o.name = p_path
         and o.created_at >= now() - make_interval(mins => p_minutes)
     );
$$;

revoke all on function public.photo_is_fresh(text, text, integer) from public, anon, authenticated;

create or replace function public.photo_already_used(p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.attendance a
                 where a.selfie_path = p_path or a.thumb_path = p_path)
      or exists (select 1 from public.store_visits v
                 where v.selfie_path = p_path or v.thumb_path = p_path);
$$;

revoke all on function public.photo_already_used(text) from public, anon, authenticated;

-- F. Every clock-in and store visit is checked on the way in. The service
-- role (no signed-in user) is left alone for admin tooling.
create or replace function public.selfie_check()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.selfie_path is null then
    if tg_table_name = 'attendance' then
      raise exception 'A clock-in needs a selfie taken in the app';
    end if;
    return new;
  end if;

  if not public.photo_is_fresh('selfies', new.selfie_path, 30)
     or (new.thumb_path is not null and not public.photo_is_fresh('selfies', new.thumb_path, 30)) then
    raise exception 'The selfie must be taken in the app just now';
  end if;

  if public.photo_already_used(new.selfie_path)
     or (new.thumb_path is not null and public.photo_already_used(new.thumb_path)) then
    raise exception 'That selfie has already been used';
  end if;

  return new;
end;
$$;

revoke all on function public.selfie_check() from public, anon, authenticated;

drop trigger if exists trg_attendance_selfie_check on public.attendance;
create trigger trg_attendance_selfie_check
  before insert on public.attendance
  for each row execute function public.selfie_check();

drop trigger if exists trg_store_visit_selfie_check on public.store_visits;
create trigger trg_store_visit_selfie_check
  before insert on public.store_visits
  for each row execute function public.selfie_check();

-- ---------------------------------------------------------------------
-- INTEGRITY FLAGS: things that look wrong, for a person to judge.
-- ---------------------------------------------------------------------
create table if not exists public.integrity_flags (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in (
                'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
                'count_units_missing', 'count_identical', 'count_round_numbers')),
  severity    text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  summary     text not null,
  detail      jsonb not null default '{}'::jsonb,
  outlet_id   uuid references public.outlets(id) on delete set null,
  flag_date   date not null default public.business_date(),
  created_at  timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 500)
);

create index if not exists integrity_flags_recent on public.integrity_flags (created_at desc);
create index if not exists integrity_flags_by_user on public.integrity_flags (user_id, created_at desc);

alter table public.integrity_flags enable row level security;

drop policy if exists integrity_flags_select on public.integrity_flags;
create policy integrity_flags_select on public.integrity_flags
  for select using (public.is_admin() or public.supervises_user(user_id));

revoke insert, update, delete, truncate on public.integrity_flags from anon, authenticated;

-- A supervisor or admin marks a flag as looked at, with a note.
create or replace function public.review_integrity_flag(p_id uuid, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.integrity_flags f
  set reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_note, '')), '')
  where f.id = p_id
    and (public.is_admin() or public.supervises_user(f.user_id));
  if not found then
    raise exception 'That flag is not yours to review';
  end if;
end;
$$;

revoke all on function public.review_integrity_flag(uuid, text) from public, anon;
grant execute on function public.review_integrity_flag(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- C. Locations that look faked.
-- ---------------------------------------------------------------------
create or replace function public.flag_location(
  p_user uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_at timestamptz, p_source text, p_check_repeat boolean, p_outlet uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  prev record;
  km double precision;
  hours double precision;
begin
  -- Real GPS wobbles by a few metres every time. The exact same point to
  -- the tenth of a metre, on another day, is what a fake-location app gives.
  if p_check_repeat and exists (
    select 1 from public.attendance a
    where a.user_id = p_user
      and a.attendance_date <> public.business_date()
      and round(a.lat::numeric, 6) = round(p_lat::numeric, 6)
      and round(a.lng::numeric, 6) = round(p_lng::numeric, 6)
  ) then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (p_user, 'repeated_exact_location', 'high',
            'Clocked in at exactly the same GPS point as on an earlier day',
            jsonb_build_object('lat', p_lat, 'lng', p_lng, 'source', p_source), p_outlet);
  end if;

  -- Phones indoors report 5 to 50 m. Under 2 m, every time, is a fake.
  if p_check_repeat and p_accuracy < 2 then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (p_user, 'perfect_accuracy', 'medium',
            format('GPS accuracy reported as %s m, which phones do not achieve indoors',
                   round(p_accuracy::numeric, 1)),
            jsonb_build_object('accuracy_m', p_accuracy, 'source', p_source), p_outlet);
  end if;

  -- The previous known position today, from a clock event or a heartbeat.
  select x.lat, x.lng, x.at into prev
  from (
    select a.lat, a.lng, a.created_at as at from public.attendance a
    where a.user_id = p_user and a.created_at < p_at and a.created_at > p_at - interval '6 hours'
    union all
    select l.lat, l.lng, l.created_at from public.location_pings l
    where l.user_id = p_user and l.created_at < p_at and l.created_at > p_at - interval '6 hours'
  ) x
  order by x.at desc
  limit 1;

  if prev.at is not null then
    km := public.distance_metres(prev.lat, prev.lng, p_lat, p_lng) / 1000.0;
    hours := greatest(extract(epoch from (p_at - prev.at)) / 3600.0, 1.0 / 3600);
    -- Faster than 150 km/h over more than 3 km, at most once an hour.
    if km > 3 and km / hours > 150 and not exists (
      select 1 from public.integrity_flags f
      where f.user_id = p_user and f.kind = 'impossible_journey'
        and f.created_at > now() - interval '1 hour'
    ) then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
      values (p_user, 'impossible_journey', 'high',
              format('Moved %s km in %s minutes (%s km/h)', round(km::numeric, 1),
                     round((hours * 60)::numeric), round((km / hours)::numeric)),
              jsonb_build_object('km', round(km::numeric, 2), 'minutes', round((hours * 60)::numeric, 1),
                                 'source', p_source), p_outlet);
    end if;
  end if;
end;
$$;

revoke all on function public.flag_location(uuid, double precision, double precision, double precision, timestamptz, text, boolean, uuid)
  from public, anon, authenticated;

create or replace function public.attendance_integrity()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.flag_location(new.user_id, new.lat, new.lng, new.accuracy_m, new.created_at,
                               'clock_' || new.type::text, true, new.outlet_id);
  return null;
end;
$$;

revoke all on function public.attendance_integrity() from public, anon, authenticated;

drop trigger if exists trg_attendance_integrity on public.attendance;
create trigger trg_attendance_integrity
  after insert on public.attendance
  for each row execute function public.attendance_integrity();

create or replace function public.ping_integrity()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.flag_location(new.user_id, new.lat, new.lng, new.accuracy_m, new.created_at,
                               'heartbeat', false, null);
  return null;
end;
$$;

revoke all on function public.ping_integrity() from public, anon, authenticated;

drop trigger if exists trg_ping_integrity on public.location_pings;
create trigger trg_ping_integrity
  after insert on public.location_pings
  for each row execute function public.ping_integrity();

-- ---------------------------------------------------------------------
-- A. Where and with what evidence a count was taken.
-- ---------------------------------------------------------------------
alter table public.store_counts
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy_m double precision,
  add column if not exists distance_m double precision,
  add column if not exists photo_path text;

-- The old two-argument version takes no location; it must not survive.
drop function if exists public.submit_store_count(uuid, jsonb);

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
-- READ MODELS
-- ---------------------------------------------------------------------
create or replace view public.integrity_flag_detail
with (security_invoker = true) as
  select f.id, f.user_id, p.full_name as staff_name, f.kind, f.severity, f.summary, f.detail,
         f.outlet_id, o.name as outlet_name, f.flag_date, f.created_at,
         f.reviewed_at, r.full_name as reviewed_by_name, f.review_note
  from public.integrity_flags f
  join public.profiles p on p.id = f.user_id
  left join public.outlets o on o.id = f.outlet_id
  left join public.profiles r on r.id = f.reviewed_by;

grant select on public.integrity_flag_detail to authenticated;

-- The count view gains where it was taken and its photo.
drop view if exists public.store_count_detail;
create view public.store_count_detail
with (security_invoker = true) as
  select c.id, c.count_date, c.user_id, p.full_name as staff_name, c.outlet_id,
         o.name as outlet_name, c.product_id, pr.name as product_name, pr.sku,
         c.in_store, c.sold, c.updated_at, c.distance_m, c.accuracy_m, c.photo_path
  from public.store_counts c
  join public.profiles p  on p.id = c.user_id
  join public.outlets o   on o.id = c.outlet_id
  join public.products pr on pr.id = c.product_id;

grant select on public.store_count_detail to authenticated;

select 'Integrity checks (022) installed' as result;
