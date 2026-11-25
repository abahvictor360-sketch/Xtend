-- =====================================================================
-- XTEND migration 0112 — The office records where the person really is
--
-- An office clock-in, clock-out, store check-in or check-out (0090) was
-- always placed on the store's pin. Now the office can say where the
-- person is instead:
--
--   * at the store (as before), where their phone last reported, or a spot
--     picked on the map or pasted from Google Maps: office_record_clock and
--     office_record_visit take p_lat, p_lng, p_accuracy and p_place (all
--     optional; none means the store's pin);
--   * an office clock-in or clock-out is measured against the store the
--     office picked (device_info.office_store_id), so a spot away from it
--     is recorded as off site, honestly, with its distance;
--   * device_info.location_from says which: 'store' or 'picked'.
--
-- Rerunnable.
-- =====================================================================

drop function if exists public.office_record_clock(uuid, attendance_type, uuid, timestamptz, text);
drop function if exists public.office_record_visit(uuid, text, uuid, text);

-- Where an office entry is placed: the given spot, or the store's pin.
create or replace function public.office_where(
  p_store_lat double precision, p_store_lng double precision, p_store_name text, p_store_address text,
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_place text,
  out lat double precision, out lng double precision, out accuracy double precision,
  out place text, out address text, out source text)
language plpgsql immutable as $$
begin
  if p_lat is null and p_lng is null then
    lat := p_store_lat; lng := p_store_lng; accuracy := 5;
    place := p_store_name; address := p_store_address; source := 'store';
    return;
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180
     or (p_lat = 0 and p_lng = 0) then
    raise exception 'That location is not a real place. Pick it again on the map';
  end if;
  lat := p_lat; lng := p_lng;
  accuracy := least(greatest(coalesce(p_accuracy, 25), 1), 100);
  place := coalesce(nullif(btrim(coalesce(p_place, '')), ''), 'Picked by the office');
  address := null;
  source := 'picked';
end;
$$;
revoke all on function public.office_where(double precision, double precision, text, text, double precision, double precision, double precision, text) from public, anon;

create or replace function public.office_record_clock(
  p_user uuid, p_type attendance_type, p_outlet uuid, p_at timestamptz, p_reason text,
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null, p_place text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  o record;
  w record;
  at_time timestamptz := coalesce(p_at, now());
  opening timestamptz;
  new_id uuid;
begin
  if actor is null or not public.may_correct_field(p_user) then
    raise exception 'You can only fix the day of active field staff you look after';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, so the record explains itself';
  end if;
  if at_time > now() + interval '1 minute' then
    raise exception 'The time cannot be in the future';
  end if;
  if (at_time at time zone 'Africa/Lagos')::date <> public.business_date() then
    raise exception 'Only today can be fixed';
  end if;

  select x.id, x.name, x.address, x.lat, x.lng into o
  from public.outlets x
  where x.id = p_outlet and x.is_active
    and x.id in (select f.outlet_id from public.outlets_for_user(p_user) f);
  if not found then
    raise exception 'Pick one of their stores';
  end if;
  if o.lat is null or o.lng is null then
    raise exception 'That store has no location yet';
  end if;
  w := public.office_where(o.lat, o.lng, o.name, o.address, p_lat, p_lng, p_accuracy, p_place);

  if p_type = 'closing' then
    select a.created_at into opening from public.attendance a
    where a.user_id = p_user and a.attendance_date = public.business_date() and a.type = 'opening';
    if opening is null then
      raise exception 'They have not clocked in today. Clock them in first';
    end if;
    if at_time < opening then
      raise exception 'The clock-out cannot be before they clocked in';
    end if;
  end if;

  -- Any record already there is replaced, and kept in the correction.
  insert into public.field_corrections (user_id, action, reason, requested_by)
  values (p_user, case p_type when 'opening' then 'office_clock_in' else 'office_clock_out' end,
          btrim(p_reason), actor)
  on conflict (user_id, correction_date, action) where status = 'open'
  do update set reason = excluded.reason, requested_by = excluded.requested_by, created_at = now();
  -- An open request to redo it themselves is overtaken by this.
  update public.field_corrections set status = 'done', done_at = now()
  where user_id = p_user and status = 'open' and correction_date = public.business_date()
    and action = case p_type when 'opening' then 'redo_clock_in' else 'redo_clock_out' end;

  perform public.office_act_as(p_user, actor);
  insert into public.attendance (type, lat, lng, accuracy_m, address, place_name, place_source,
                                 selfie_path, device_info, client_captured_at)
  values (p_type, w.lat, w.lng, w.accuracy, w.address, w.place, 'office', '',
          jsonb_build_object('source', 'office', 'recorded_by', actor, 'reason', btrim(p_reason),
                             'office_store_id', o.id, 'location_from', w.source),
          at_time)
  returning id into new_id;
  perform public.office_act_done();
  return new_id;
end;
$$;

revoke all on function public.office_record_clock(uuid, attendance_type, uuid, timestamptz, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.office_record_clock(uuid, attendance_type, uuid, timestamptz, text, double precision, double precision, double precision, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Recording a store check-in or check-out for someone.
-- ---------------------------------------------------------------------
create or replace function public.office_record_visit(
  p_user uuid, p_action text, p_outlet uuid, p_reason text,
  p_lat double precision default null, p_lng double precision default null,
  p_accuracy double precision default null, p_place text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  o record;
  w record;
  v record;
  new_id uuid;
begin
  if actor is null or not public.may_correct_field(p_user) then
    raise exception 'You can only fix the day of active field staff you look after';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, so the record explains itself';
  end if;
  if p_action not in ('check_in', 'check_out') then
    raise exception 'Unknown action';
  end if;

  if p_action = 'check_in' then
    if not exists (select 1 from public.attendance a where a.user_id = p_user
                   and a.attendance_date = public.business_date() and a.type = 'opening') then
      raise exception 'They have not clocked in today. Clock them in first';
    end if;
    if exists (select 1 from public.attendance a where a.user_id = p_user
               and a.attendance_date = public.business_date() and a.type = 'closing') then
      raise exception 'They have clocked out for today';
    end if;
    if exists (select 1 from public.store_visits s where s.user_id = p_user and s.status = 'open'
               and s.visit_date = public.business_date()) then
      raise exception 'They are still checked in at a store. Check them out first';
    end if;
    select x.id, x.name, x.address, x.lat, x.lng into o
    from public.outlets x
    where x.id = p_outlet and x.is_active
      and x.id in (select f.outlet_id from public.outlets_for_user(p_user) f);
    if not found then
      raise exception 'Pick one of their stores';
    end if;
    if o.lat is null or o.lng is null then
      raise exception 'That store has no location yet';
    end if;

    w := public.office_where(o.lat, o.lng, o.name, o.address, p_lat, p_lng, p_accuracy, p_place);
    perform public.office_act_as(p_user, actor);
    insert into public.store_visits (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m,
                                     arrived_address, arrived_place_name, device_info, client_captured_at)
    values (o.id, w.lat, w.lng, w.accuracy, w.address, w.place,
            jsonb_build_object('source', 'office', 'recorded_by', actor, 'reason', btrim(p_reason),
                               'location_from', w.source), now())
    returning id into new_id;
    perform public.office_act_done();

    insert into public.field_corrections (user_id, action, reason, requested_by, status, done_at, new_record_id)
    values (p_user, 'office_check_in', btrim(p_reason), actor, 'done', now(), new_id);
    return new_id;
  end if;

  select s.id, s.outlet_id, s.arrived_lat, s.arrived_lng, s.arrived_address, s.arrived_place_name into v
  from public.store_visits s
  where s.user_id = p_user and s.status = 'open'
  order by s.arrived_at desc limit 1;
  if not found then
    raise exception 'They are not checked in at any store';
  end if;
  select x.lat, x.lng, x.name, x.address into o from public.outlets x where x.id = v.outlet_id;
  w := public.office_where(coalesce(o.lat, v.arrived_lat), coalesce(o.lng, v.arrived_lng),
                           coalesce(o.name, v.arrived_place_name), coalesce(o.address, v.arrived_address),
                           p_lat, p_lng, p_accuracy, p_place);

  perform public.office_act_as(p_user, actor);
  perform public.end_store_visit(v.id, w.lat, w.lng, w.accuracy, w.place, w.address);
  perform public.office_act_done();

  insert into public.field_corrections (user_id, action, reason, requested_by, status, done_at, record_id, new_record_id)
  values (p_user, 'office_check_out', btrim(p_reason), actor, 'done', now(), v.id, v.id);
  return v.id;
end;
$$;

revoke all on function public.office_record_visit(uuid, text, uuid, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.office_record_visit(uuid, text, uuid, text, double precision, double precision, double precision, text) to authenticated, service_role;

-- An office clock-in or clock-out is measured against the store the office
-- picked, wherever the spot is. Runs after attendance_enforce.
create or replace function public.attendance_office_store()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  store uuid;
  o record;
begin
  begin
    store := nullif(new.device_info->>'office_store_id', '')::uuid;
  exception when others then
    store := null;
  end;
  if store is null then
    return new;
  end if;
  select x.id, x.lat, x.lng, x.geofence_radius_m into o from public.outlets x where x.id = store;
  if o.id is null or o.lat is null then
    return new;
  end if;
  new.outlet_id       := o.id;
  new.outlet_lat      := o.lat;
  new.outlet_lng      := o.lng;
  new.outlet_radius_m := o.geofence_radius_m;
  new.distance_m      := public.distance_metres(new.lat, new.lng, o.lat, o.lng);
  new.status := case
    when new.accuracy_m > 100 then 'flagged'::attendance_status
    when new.distance_m <= coalesce(new.outlet_radius_m, 150) then 'on_site'::attendance_status
    else 'off_site'::attendance_status
  end;
  return new;
end;
$$;
revoke all on function public.attendance_office_store() from public, anon, authenticated;

drop trigger if exists trg_attendance_zt_office_store on public.attendance;
create trigger trg_attendance_zt_office_store
  before insert on public.attendance
  for each row when (public.office_entry_on())
  execute function public.attendance_office_store();

select 'The office records where the person really is (0112) installed' as result;
