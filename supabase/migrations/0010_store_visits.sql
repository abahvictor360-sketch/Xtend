-- =====================================================================
-- XTEND migration 010 — store visits
--
-- A merchandiser sits in one outlet all day. A marketer works three or
-- four, so their day is a sequence of visits: check in at the store, work,
-- check out, move on. Each visit records where they actually were on
-- arrival and on departure, measured against the store they said they were
-- visiting rather than a home outlet they may not be near.
--
-- The daily attendance record still marks the start and end of the shift.
-- The first check-in of the day opens it automatically, so a marketer is
-- not asked to clock in twice.
-- =====================================================================

create type visit_status as enum ('open', 'closed', 'abandoned');

create table if not exists public.store_visits (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete restrict
                      default auth.uid(),
  outlet_id         uuid not null references public.outlets(id) on delete restrict,
  visit_date        date,
  status            visit_status not null default 'open',

  -- Arrival
  arrived_at        timestamptz,
  arrived_lat       double precision not null,
  arrived_lng       double precision not null,
  arrived_accuracy_m double precision not null,
  arrived_distance_m double precision,
  arrived_status    attendance_status,
  arrived_place_name text,
  arrived_address   text,
  selfie_path       text,
  thumb_path        text,

  -- Departure
  departed_at       timestamptz,
  departed_lat      double precision,
  departed_lng      double precision,
  departed_accuracy_m double precision,
  departed_distance_m double precision,
  departed_status   attendance_status,
  departed_place_name text,
  departed_address  text,

  -- Outlet snapshot, so a later change to the store cannot rewrite history.
  outlet_lat        double precision,
  outlet_lng        double precision,
  outlet_radius_m   integer,

  device_info       jsonb not null default '{}'::jsonb,
  client_captured_at timestamptz not null,
  created_at        timestamptz not null default now()
);

-- One store at a time. A second check-in without checking out is a mistake,
-- not a second visit.
create unique index if not exists store_visits_one_open_per_user
  on public.store_visits (user_id) where status = 'open';

create index if not exists store_visits_by_day on public.store_visits (visit_date desc);
create index if not exists store_visits_by_user on public.store_visits (user_id, visit_date desc);
create index if not exists store_visits_by_outlet on public.store_visits (outlet_id, visit_date desc);

-- ---------------------------------------------------------------------
-- Who may record a store visit: marketers move between stores. A
-- merchandiser has one fixed outlet and uses the daily clock instead.
-- ---------------------------------------------------------------------
create or replace function public.can_visit_stores()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role in ('marketer'::user_role, 'admin'::user_role)
     from public.profiles where id = auth.uid()),
    false);
$$;

revoke all on function public.can_visit_stores() from public, anon;
grant execute on function public.can_visit_stores() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- ARRIVAL. The client sends what it saw; the server decides the rest.
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

  -- Departure fields are never accepted on the way in.
  new.departed_at := null;
  new.departed_lat := null;
  new.departed_lng := null;
  new.departed_distance_m := null;
  new.departed_status := null;

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

  if new.client_captured_at > now() + interval '2 minutes'
     or new.client_captured_at < now() - interval '24 hours' then
    raise exception 'Invalid capture timestamp';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_store_visit_enforce on public.store_visits;
create trigger trg_store_visit_enforce before insert on public.store_visits
  for each row execute function public.store_visit_enforce();

-- Arriving somewhere other than the store raises the same alert a clock
-- event would, so the office hears about it through one channel.
create or replace function public.store_visit_alert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.arrived_status <> 'on_site' then
    insert into public.location_alerts (user_id, alert_type, distance_m)
    values (
      new.user_id,
      case when new.arrived_accuracy_m > 100 then 'low_accuracy'::alert_type
           else 'off_site_clock'::alert_type end,
      new.arrived_distance_m
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_store_visit_alert on public.store_visits;
create trigger trg_store_visit_alert after insert on public.store_visits
  for each row execute function public.store_visit_alert();

-- ---------------------------------------------------------------------
-- DEPARTURE. An RPC rather than an UPDATE policy: a visit is closed once,
-- by its owner, and nothing else about it may be rewritten.
-- ---------------------------------------------------------------------
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

  new_distance := public.distance_metres(p_lat, p_lng, v.outlet_lat, v.outlet_lng);
  new_status := case
    when p_accuracy_m > 100 then 'flagged'::attendance_status
    when new_distance <= coalesce(v.outlet_radius_m, 150) then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;

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

-- A visit left open overnight is closed as abandoned by the nightly job,
-- so "currently in store" never shows yesterday's marketer.
create or replace function public.close_abandoned_visits()
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.store_visits
  set status = 'abandoned'
  where status = 'open' and visit_date < public.business_date();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.close_abandoned_visits() from public, anon, authenticated;
grant execute on function public.close_abandoned_visits() to service_role;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.store_visits enable row level security;

drop policy if exists store_visits_insert_own on public.store_visits;
create policy store_visits_insert_own on public.store_visits
  for insert with check (
    auth.uid() is not null
    and public.can_visit_stores()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
  );

drop policy if exists store_visits_select on public.store_visits;
create policy store_visits_select on public.store_visits
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

-- No UPDATE or DELETE policy. Departure goes through end_store_visit().

-- =====================================================================
-- READ MODELS
-- =====================================================================
create or replace view public.store_visit_detail
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
    ) as arrived_label
  from public.store_visits v
  join public.profiles p on p.id = v.user_id
  join public.outlets o on o.id = v.outlet_id;

-- The marketer's own day.
create or replace function public.my_store_visits()
returns setof public.store_visit_detail
language sql stable security definer set search_path = public as $$
  select * from public.store_visit_detail
  where user_id = auth.uid() and visit_date = public.business_date()
  order by arrived_at desc;
$$;

revoke all on function public.my_store_visits() from public, anon;
grant execute on function public.my_store_visits() to authenticated, service_role;

-- Today's visits across the team, scoped to what the caller may see.
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
