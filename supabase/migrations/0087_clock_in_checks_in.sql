-- =====================================================================
-- XTEND migration 0087 — clocking in at one of your stores checks you in
--
-- A marketer often starts the day at the first store on their round. They
-- clocked in there, then had to take a second selfie to check in at the
-- same store. Now a marketer's clock-in made inside the fence of one of
-- their own allocated stores also opens a store visit there, at once:
--
--   * only for people who record store visits (can_visit_stores) and have
--     stores allocated (060), and only at one of those stores;
--   * only a good fix (accuracy 100 m or better) taken in the last 30
--     minutes (a clock-in sent late from the outbox is not a visit now);
--   * not when a visit is already open today;
--   * the visit's photo is the clock-in's (device_info.source 'clock_in',
--     attendance_id): the same selfie is not filed twice;
--   * it can never stop the clock-in: anything that goes wrong just means
--     no automatic check-in, and they check in by hand as before.
--
-- Checking out, and every later store, works as before.
-- Rerunnable.
-- =====================================================================

create or replace function public.attendance_store_check_in()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  store uuid;
begin
  if new.type <> 'opening' or auth.uid() is null or auth.uid() <> new.user_id then
    return null;
  end if;
  if not public.can_visit_stores() or not public.has_allocated_stores(new.user_id) then
    return null;
  end if;
  if new.accuracy_m is null or new.accuracy_m > 100
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

revoke all on function public.attendance_store_check_in() from public, anon, authenticated;

drop trigger if exists trg_attendance_zz_store_check_in on public.attendance;
create trigger trg_attendance_zz_store_check_in
  after insert on public.attendance
  for each row execute function public.attendance_store_check_in();

select 'Clocking in at your store checks you in (0087) installed' as result;
