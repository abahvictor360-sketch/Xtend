-- =====================================================================
-- XTEND migration 060 — store visits keep to the person's own stores, and
-- the daily report carries the day's visits.
--
-- 1. Allocated stores only. Once somebody has stores allocated to them
--    (staff_outlets), a visit must be to one of their stores
--    (outlets_for_user: the allocated ones plus their home store):
--      - a store picked by hand that is not theirs is refused;
--      - checking in without picking, standing inside the fence of a store
--        that is not theirs, is refused too, unless one of their own
--        stores' fences also covers the spot, which then wins.
--    The message is the one the phone shows: "This store is not on your
--    list. Ask your supervisor to add it."
--    Somebody with no allocation keeps the old behaviour exactly: any known
--    store, or a shop Xtend does not know (place naming, 045).
--
-- 2. my_visit_stores(): the stores the phone offers in "Pick the store
--    myself". Their own stores when they have an allocation, otherwise
--    nothing (the phone says to ask their supervisor).
--
-- 3. reports.store_visits: a snapshot of the day's visits (store, address,
--    in, out, minutes, arrival), written by the database every time the
--    report is saved, from store_visits for that person and day. Whatever
--    the client sends for it is overwritten.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Has this person been given stores of their own?
-- ---------------------------------------------------------------------
create or replace function public.has_allocated_stores(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.staff_outlets s
    join public.outlets o on o.id = s.outlet_id
    where s.user_id = target and o.is_active
  );
$$;

revoke all on function public.has_allocated_stores(uuid) from public, anon;
grant execute on function public.has_allocated_stores(uuid) to authenticated, service_role;

-- The stores a person may pick from on the phone.
create or replace function public.my_visit_stores()
returns table (
  id uuid,
  name text,
  address text,
  lat double precision,
  lng double precision,
  geofence_radius_m integer
)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.address, o.lat, o.lng, o.geofence_radius_m
  from public.outlets o
  where public.has_allocated_stores(auth.uid())
    and o.id in (select f.outlet_id from public.outlets_for_user(auth.uid()) f)
  order by o.name;
$$;

revoke all on function public.my_visit_stores() from public, anon;
grant execute on function public.my_visit_stores() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Checking in: as 034, plus the allocation rule.
-- ---------------------------------------------------------------------
create or replace function public.store_visit_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o record;
  limited boolean;
  found uuid;
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

  limited := public.has_allocated_stores(new.user_id);

  if new.outlet_id is not null then
    -- Picked by hand: it has to be one of theirs.
    if limited and new.outlet_id not in (select f.outlet_id from public.outlets_for_user(new.user_id) f) then
      raise exception 'This store is not on your list. Ask your supervisor to add it.';
    end if;
  elsif limited then
    -- Recognised by location: their own store first, if they stand in one.
    select x.id into found
    from public.outlets x
    where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
      and public.distance_metres(new.arrived_lat, new.arrived_lng, x.lat, x.lng) <= x.geofence_radius_m
    order by public.distance_metres(new.arrived_lat, new.arrived_lng, x.lat, x.lng)
    limit 1;
    if found is null and public.outlet_containing(new.arrived_lat, new.arrived_lng) is not null then
      raise exception 'This store is not on your list. Ask your supervisor to add it.';
    end if;
    new.outlet_id := found;
  else
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

revoke all on function public.store_visit_enforce() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. The day's visits, kept with the report.
-- ---------------------------------------------------------------------
alter table public.reports
  add column if not exists store_visits jsonb not null default '[]'::jsonb;

comment on column public.reports.store_visits is
  'The store visits of that person and day when the report was last saved (060). Set by trigger only.';

create or replace function public.report_visits_snapshot(p_user uuid, p_date date)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'store',          d.store_label,
           'outlet_name',    d.outlet_name,
           'address',        coalesce(d.outlet_address, d.arrived_address),
           'arrived_at',     d.arrived_at,
           'departed_at',    d.departed_at,
           'minutes',        d.minutes,
           'status',         d.status,
           'arrived_status', d.arrived_status
         ) order by d.arrived_at), '[]'::jsonb)
  from public.store_visit_detail d
  where d.user_id = p_user and d.visit_date = p_date;
$$;

-- Only the trigger uses it: anyone else calling it could read another
-- person's day.
revoke all on function public.report_visits_snapshot(uuid, date) from public, anon, authenticated;

create or replace function public.report_capture_visits()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Runs after report_enforce (trigger names sort), so user and date are
  -- the server's own.
  new.store_visits := public.report_visits_snapshot(new.user_id, new.report_date);
  return new;
end;
$$;

revoke all on function public.report_capture_visits() from public, anon, authenticated;

drop trigger if exists trg_report_visits on public.reports;
create trigger trg_report_visits before insert or update on public.reports
  for each row execute function public.report_capture_visits();

select 'marketer visits and reports (060) installed' as result;
