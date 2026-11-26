-- =====================================================================
-- XTEND migration 0116 — The clock-in photo is the check-in photo
--
-- A marketer's clock-in at a store also checks them in there (0087, 0101),
-- but that store visit had no photo, so the office saw the clock-in selfie
-- and an empty check-in. Now:
--
--   * the store visit the clock-in opens carries the clock-in's selfie and
--     thumbnail (selfie_path, thumb_path);
--   * selfie_check() lets that one photo through on the visit (it was
--     checked as the clock-in's; it would otherwise count as "already
--     used"), through the transaction setting xtend.clock_in_photo, set
--     only by attendance_store_check_in();
--   * visits opened this way before now get their clock-in's photo.
--
-- Rerunnable.
-- =====================================================================

create or replace function public.selfie_check()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  -- 0116: the store check-in a marketer's clock-in makes carries the
  -- clock-in's own selfie, already checked as the clock-in's.
  if tg_table_name = 'store_visits' and new.selfie_path is not null
     and new.selfie_path = nullif(current_setting('xtend.clock_in_photo', true), '') then
    return new;
  end if;

  if new.selfie_path is null then
    if tg_table_name = 'attendance' then
      raise exception 'A clock-in needs a selfie taken in the app';
    end if;
    return new;
  end if;

  if public.photo_verdict(new.selfie_path) = 'reject' then
    raise exception 'That selfie was rejected. Take a new one, live, of your face';
  end if;
  if public.photo_verdict(new.selfie_path) is null then
    raise exception 'The selfie has not been checked. Take it again in the app';
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

  -- 0116: the clock-in selfie is the check-in photo too.
  perform set_config('xtend.clock_in_photo', coalesce(new.selfie_path, ''), true);
  begin
    insert into public.store_visits
      (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m,
       arrived_address, arrived_place_name, selfie_path, thumb_path, device_info, client_captured_at)
    values
      (store, new.lat, new.lng, new.accuracy_m,
       new.address, new.place_name, new.selfie_path, new.thumb_path,
       coalesce(new.device_info, '{}'::jsonb)
         || jsonb_build_object('source', 'clock_in', 'attendance_id', new.id),
       new.client_captured_at);
  exception when others then
    -- No automatic check-in; the clock-in stands.
    null;
  end;
  perform set_config('xtend.clock_in_photo', '', true);
  return null;
end;
$$;


-- Earlier check-ins made by a clock-in: the clock-in's photo.
update public.store_visits v
   set selfie_path = a.selfie_path,
       thumb_path  = a.thumb_path
  from public.attendance a
 where v.device_info->>'source' = 'clock_in'
   and v.selfie_path is null
   and a.id::text = v.device_info->>'attendance_id'
   and a.selfie_path is not null;

select 'Clock-in photo is the check-in photo (0116) installed' as result;
