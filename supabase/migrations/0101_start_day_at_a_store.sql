-- =====================================================================
-- XTEND migration 0101 — marketers start the day at a store
--
-- A marketer's day is a round of stores, never their home. Now:
--
--   * a marketer's clock-in must name the store they are starting at
--     (device_info.start_store_id), one of their own stores (home or
--     allocated, active). Without one it is refused, saying what to do:
--       - no stores at all: "No stores are allocated to you yet …" (hint
--         no_stores): the app tells them to send the office their stores
--         and each store's Google Maps link;
--       - none picked: "Pick the store you are starting your day at …"
--         (hint pick_store);
--       - not theirs: "That store is not on your list …" (store_not_yours);
--   * the clock-in is measured against that store (on site / off site from
--     its fence), and it checks them in there at the same time (one
--     selfie): the store visit opens from the clock-in;
--   * the "check out before you leave" reminder comes 20 minutes after
--     check-in (was 25), then every 20 minutes.
--
-- Merchandisers (even with several stores), and the office recording a
-- clock for someone, are not affected. Rerunnable.
-- =====================================================================

-- The store named in a clock-in's device_info, or null.
create or replace function public.start_store_of(p_device jsonb)
returns uuid language plpgsql immutable as $$
begin
  return nullif(p_device->>'start_store_id', '')::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.start_store_of(jsonb) to authenticated, service_role;

create or replace function public.attendance_start_store()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  store uuid;
  o record;
begin
  if new.type <> 'opening' or auth.uid() is null or auth.uid() <> new.user_id then
    return new;
  end if;
  -- Marketers only: a merchandiser's day is their store.
  if not exists (select 1 from public.profiles p where p.id = new.user_id and p.role = 'marketer') then
    return new;
  end if;

  if not exists (select 1 from public.outlets_for_user(new.user_id) f
                 join public.outlets x on x.id = f.outlet_id where x.is_active) then
    raise exception 'No stores are allocated to you yet. Send the office the stores you visit, with each store''s Google Maps link, and clock in once they are added'
      using hint = 'no_stores';
  end if;

  store := public.start_store_of(new.device_info);
  if store is null then
    raise exception 'Pick the store you are starting your day at, then clock in'
      using hint = 'pick_store';
  end if;
  if not exists (select 1 from public.outlets_for_user(new.user_id) f
                 join public.outlets x on x.id = f.outlet_id
                 where f.outlet_id = store and x.is_active) then
    raise exception 'That store is not on your list. Pick one of your stores, or ask the office to add it'
      using hint = 'store_not_yours';
  end if;

  -- Measured against the store they said they are at.
  select x.id, x.lat, x.lng, x.geofence_radius_m into o from public.outlets x where x.id = store;
  new.outlet_id       := o.id;
  new.outlet_lat      := o.lat;
  new.outlet_lng      := o.lng;
  new.outlet_radius_m := o.geofence_radius_m;
  new.distance_m      := case when o.lat is null then null
                              else public.distance_metres(new.lat, new.lng, o.lat, o.lng) end;
  new.status := case
    when new.accuracy_m > 100 then 'flagged'::attendance_status
    when new.distance_m is null then null
    when new.distance_m <= coalesce(new.outlet_radius_m, 150) then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;
  return new;
end;
$$;

revoke all on function public.attendance_start_store() from public, anon, authenticated;

-- Runs after attendance_enforce (BEFORE triggers fire in name order).
drop trigger if exists trg_attendance_start_store on public.attendance;
create trigger trg_attendance_start_store
  before insert on public.attendance
  for each row when (not public.office_entry_on())
  execute function public.attendance_start_store();

-- The clock-in opens the store visit at the store they picked.
create or replace function public.attendance_store_check_in()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  store uuid;
begin
  if new.type <> 'opening' or auth.uid() is null or auth.uid() <> new.user_id then
    return null;
  end if;
  if not public.can_visit_stores() then
    return null;
  end if;
  -- 0101: the store they picked to start their day at. Without one (an
  -- older phone), a good, fresh fix inside one of their stores, as in 0087.
  store := public.start_store_of(new.device_info);
  if store is null then
    if not public.has_allocated_stores(new.user_id)
       or new.accuracy_m is null or new.accuracy_m > 100
       or new.client_captured_at < now() - interval '30 minutes' then
      return null;
    end if;
    select x.id into store
    from public.outlets x
    where x.id in (select f.outlet_id from public.outlets_for_user(new.user_id) f)
      and x.is_active
      and public.distance_metres(new.lat, new.lng, x.lat, x.lng) <= x.geofence_radius_m
    order by public.distance_metres(new.lat, new.lng, x.lat, x.lng)
    limit 1;
  end if;
  if store is null then
    return null;
  end if;

  if exists (select 1 from public.store_visits
             where user_id = new.user_id and status = 'open'
               and visit_date = public.business_date()) then
    return null;
  end if;

  begin
    insert into public.store_visits
      (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m,
       arrived_address, arrived_place_name, device_info, client_captured_at)
    values
      (store, new.lat, new.lng, new.accuracy_m,
       new.address, new.place_name,
       coalesce(new.device_info, '{}'::jsonb)
         || jsonb_build_object('source', 'clock_in', 'attendance_id', new.id),
       new.client_captured_at);
  exception when others then
    -- No automatic check-in; the clock-in stands.
    null;
  end;
  return null;
end;
$$;

-- "Check out before you leave": 20 minutes after check-in, then every 20.
create or replace function public.visit_reminder_minutes()
returns integer language sql immutable as $$ select 20 $$;

select 'Marketers start the day at a store (0101) installed' as result;
