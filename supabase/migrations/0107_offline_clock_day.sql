-- =====================================================================
-- XTEND migration 0107 — A clock-in saved with no signal keeps its day
--
-- A clock-in or clock-out made with no signal waits on the phone and is
-- sent when the signal is back. The server dated it by the day it arrived
-- (business_date()), so a clock-out made at 18:20 and sent after midnight
-- landed on the next day: the day it belonged to showed no clock-out and
-- the next day showed a clock-out with no clock-in.
--
-- Now it is dated by the day the photo was taken (Lagos time), when that
-- is earlier and within the 24 hours the server already allows. The time
-- itself was always kept (client_captured_at); a phone whose clock was
-- moved is still flagged (0026). Office entries (0090) are not touched.
--
-- Runs after attendance_enforce (BEFORE triggers fire in name order).
-- Rerunnable.
-- =====================================================================

create or replace function public.attendance_capture_day()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  taken timestamptz;
  taken_day date;
begin
  if new.user_id is null or new.client_captured_at is null then
    return new;
  end if;
  taken := least(new.client_captured_at, now());
  -- attendance_enforce refuses anything older than 24 hours.
  if taken < now() - interval '24 hours' then
    return new;
  end if;
  taken_day := (taken at time zone 'Africa/Lagos')::date;
  if taken_day < new.attendance_date then
    new.attendance_date := taken_day;
  end if;
  return new;
end;
$$;
revoke all on function public.attendance_capture_day() from public, anon, authenticated;

drop trigger if exists trg_attendance_enforce_day on public.attendance;
create trigger trg_attendance_enforce_day
  before insert on public.attendance
  for each row when (not public.office_entry_on())
  execute function public.attendance_capture_day();

-- The clock-in's store check-in (0087, 0101) only for today's clock-in: a
-- late one from yesterday must not open a store visit today.
create or replace function public.attendance_store_check_in()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  store uuid;
begin
  if new.type <> 'opening' or auth.uid() is null or auth.uid() <> new.user_id then
    return null;
  end if;
  -- 0107: a clock-in from an earlier day that arrived late opens no visit today.
  if new.attendance_date <> public.business_date() then
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

select 'A clock-in saved with no signal keeps its day (0107) installed' as result;
