-- =====================================================================
-- XTEND migration 029 — positions kept while offline, sent on reconnect
--
-- Until now a heartbeat position that could not be sent was dropped. Now
-- the phone keeps it (the same offline queue clock-ins use) and sends the
-- batch when the network is back. It is stored at the time it was taken,
-- corrected for a wrong phone clock, so the Movement map shows where the
-- person was while they had no network.
--
--   * Only positions from the last 24 hours, and never from the future.
--   * A position that arrives late raises no "left the store" alert (it
--     would be stale); the fake-location checks still run on it.
--   * A position saved offline proves the phone was on, not that it had
--     network, so the excuse checks and clock-in timing (026) now leave
--     them out of "the phone had network".
--   * A batch claiming positions from before the phone last reported that
--     nothing was waiting to upload is refused and flagged: those
--     positions were made up afterwards.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.movement_trail(uuid, date)') is null then
    raise exception 'Run the movement update (028, step 10) first, then this file';
  end if;
end $$;

alter table public.location_pings
  add column if not exists offline boolean not null default false,
  add column if not exists received_at timestamptz;

-- The heartbeat trigger: the server's clock, unless record_offline_pings()
-- below is inserting a checked, corrected time for an offline position.
create or replace function public.ping_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  open_shift record;
  previous_at timestamptz;
  taken_day date;
begin
  new.user_id := auth.uid();
  new.received_at := now();
  if coalesce(current_setting('xtend.offline_ping', true), '') = 'on' and new.created_at is not null then
    new.offline := true;
  else
    new.offline := false;
    new.created_at := now();
  end if;
  taken_day := (new.created_at at time zone 'Africa/Lagos')::date;

  -- Anchor to that day's opening event; a ping without an open shift is
  -- kept but carries no distance.
  select a.id, a.lat, a.lng into open_shift
  from public.attendance a
  where a.user_id = new.user_id
    and a.attendance_date = taken_day
    and a.type = 'opening'
  limit 1;

  if open_shift.id is not null then
    new.attendance_id := open_shift.id;
    new.distance_m := public.distance_metres(new.lat, new.lng, open_shift.lat, open_shift.lng);
  end if;

  select max(p.created_at) into previous_at
  from public.location_pings p
  where p.user_id = new.user_id
    and p.created_at <= new.created_at
    and p.created_at >= (taken_day::timestamp at time zone 'Africa/Lagos');

  if previous_at is not null then
    new.gap_seconds := greatest(0, extract(epoch from (new.created_at - previous_at))::integer);
  end if;

  return new;
end;
$$;

-- "Left the store" is for now, not for an hour ago.
create or replace function public.ping_alert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.offline then
    return new;
  end if;
  if new.distance_m is not null and new.distance_m > 300 then
    -- One left_geofence alert per shift per 30 minutes.
    if not exists (
      select 1 from public.location_alerts
      where user_id = new.user_id
        and alert_type = 'left_geofence'
        and created_at > now() - interval '30 minutes'
    ) then
      insert into public.location_alerts (user_id, attendance_id, alert_type, distance_m)
      values (new.user_id, new.attendance_id, 'left_geofence', new.distance_m);
    end if;
  end if;
  return new;
end;
$$;

-- A batch of positions the phone kept while offline. p_sent_at is the
-- phone's clock at sending, so a wrong clock is corrected. Returns how
-- many were kept.
create or replace function public.record_offline_pings(p_points jsonb, p_sent_at timestamptz)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  offset_s integer := coalesce(extract(epoch from (p_sent_at - now()))::integer, 0);
  point jsonb;
  taken timestamptz;
  kept integer := 0;
  faked integer := 0;
  lat double precision;
  lng double precision;
  acc double precision;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 500 then
    raise exception 'Send at most 500 positions at a time';
  end if;

  perform set_config('xtend.offline_ping', 'on', true);
  for point in select * from jsonb_array_elements(p_points) loop
    taken := public.safe_ts(point->>'captured_at') - make_interval(secs => offset_s);
    if taken is null or taken > now() + interval '2 minutes' or taken < now() - interval '24 hours'
       or jsonb_typeof(point->'lat') <> 'number' or jsonb_typeof(point->'lng') <> 'number'
       or jsonb_typeof(point->'accuracy_m') <> 'number' then
      continue;
    end if;
    lat := (point->>'lat')::float8;
    lng := (point->>'lng')::float8;
    acc := (point->>'accuracy_m')::float8;
    if abs(lat) > 90 or abs(lng) > 180 or acc < 0 then
      continue;
    end if;

    -- The phone told us, well after this, that nothing was waiting.
    if exists (select 1 from public.device_beacons b
               where b.user_id = me and b.outbox_count = 0
                 and b.received_at > taken + interval '10 minutes'
                 and b.received_at < now() - interval '30 seconds') then
      faked := faked + 1;
      continue;
    end if;

    -- Already here (a retry after a dropped connection).
    if exists (select 1 from public.location_pings l
               where l.user_id = me and l.created_at between taken - interval '1 second'
                                                        and taken + interval '1 second') then
      continue;
    end if;

    insert into public.location_pings (lat, lng, accuracy_m, created_at)
    values (lat, lng, acc, taken);
    kept := kept + 1;
  end loop;
  perform set_config('xtend.offline_ping', 'off', true);

  if faked > 0 and not exists (
    select 1 from public.integrity_flags f
    where f.user_id = me and f.kind = 'backdated_clock' and f.flag_date = public.business_date()
      and f.detail->>'source' = 'offline_positions') then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (me, 'backdated_clock', 'high',
            format('%s offline position%s claimed times from before the phone last said nothing was waiting to upload. They were made up afterwards and were not kept',
                   faked, case when faked = 1 then '' else 's' end),
            jsonb_build_object('source', 'offline_positions', 'refused', faked));
  end if;

  if abs(offset_s) > 300 and not exists (
    select 1 from public.integrity_flags f
    where f.user_id = me and f.kind = 'phone_clock_wrong' and f.flag_date = public.business_date()) then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (me, 'phone_clock_wrong', 'medium',
            format('The phone''s clock was %s minutes %s when it sent positions saved offline',
                   abs(offset_s) / 60, case when offset_s > 0 then 'ahead' else 'behind' end),
            jsonb_build_object('offset_s', offset_s, 'source', 'offline_positions'));
  end if;

  return kept;
end;
$$;

revoke all on function public.record_offline_pings(jsonb, timestamptz) from public, anon;
grant execute on function public.record_offline_pings(jsonb, timestamptz) to authenticated, service_role;

-- 026's clock-in timing, now leaving positions saved offline out of
-- "the phone had network".
create or replace function public.clock_timing(
  p_user uuid, p_captured timestamptz, p_device jsonb, p_now timestamptz
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  sent timestamptz := public.safe_ts(p_device->>'sent_at');
  anchor uuid := public.safe_uuid(p_device->>'anchor_beacon');
  offset_s integer;
  taken timestamptz;
  anchor_at timestamptz;
  empty_at timestamptz;
  online_at timestamptz;
  last_before timestamptz;
  verdict text;
  detail jsonb := '{}'::jsonb;
begin
  -- How far the phone's clock was from the server's when it sent this.
  if sent is not null then
    offset_s := extract(epoch from (sent - p_now))::integer;
  end if;
  -- When it was really taken, on the server's clock.
  taken := p_captured - make_interval(secs => coalesce(offset_s, 0));
  detail := jsonb_build_object('offset_s', offset_s, 'taken_at', taken,
                               'lag_s', extract(epoch from (p_now - taken))::integer);

  if p_now - taken <= interval '2 minutes' then
    verdict := 'live';
  else
    -- The phone was in touch after the moment it claims: impossible.
    select b.received_at into anchor_at
    from public.device_beacons b where b.id = anchor and b.user_id = p_user;
    if anchor_at > taken + interval '2 minutes' then
      verdict := 'backdated';
      detail := detail || jsonb_build_object('contact_at', anchor_at, 'how', 'anchor');
    end if;

    -- Or it reported, well after that moment, that nothing was waiting.
    if verdict is null then
      select b.received_at into empty_at
      from public.device_beacons b
      where b.user_id = p_user and b.outbox_count = 0
        and b.received_at > taken + interval '10 minutes'
        and b.received_at < p_now - interval '30 seconds'
      order by b.received_at limit 1;
      if empty_at is not null then
        verdict := 'backdated';
        detail := detail || jsonb_build_object('contact_at', empty_at, 'how', 'nothing_waiting');
      end if;
    end if;

    -- The phone had network long before it sent this.
    if verdict is null then
      select min(t) into online_at from (
        select b.received_at as t from public.device_beacons b
        where b.user_id = p_user and b.received_at > taken + interval '10 minutes'
          and b.received_at < p_now - interval '10 minutes'
        union all
        select l.created_at from public.location_pings l
        where l.user_id = p_user and not l.offline and l.created_at > taken + interval '10 minutes'
          and l.created_at < p_now - interval '10 minutes'
      ) x;
      if online_at is not null then
        verdict := 'network_was_available';
        detail := detail || jsonb_build_object('contact_at', online_at);
      end if;
    end if;

    if verdict is null then
      select max(t) into last_before from (
        select b.received_at as t from public.device_beacons b
        where b.user_id = p_user and b.received_at <= taken + interval '2 minutes'
          and b.received_at > taken - interval '1 day'
        union all
        select l.created_at from public.location_pings l
        where l.user_id = p_user and not l.offline and l.created_at <= taken + interval '2 minutes'
          and l.created_at > taken - interval '1 day'
      ) x;
      verdict := case when last_before is not null then 'offline_confirmed' else 'offline_unproven' end;
      detail := detail || jsonb_build_object('last_contact_at', last_before);
    end if;
  end if;

  if abs(coalesce(offset_s, 0)) > 300 and verdict <> 'backdated' then
    verdict := 'phone_clock_wrong';
  end if;
  return detail || jsonb_build_object('verdict', verdict);
end;
$$;

revoke all on function public.clock_timing(uuid, timestamptz, jsonb, timestamptz) from public, anon, authenticated;

-- 026's excuse check, the same way, and listing the offline positions.
create or replace function public.check_excuse(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only check your own team';
  end if;
  if p_to <= p_from or p_to - p_from > interval '24 hours' then
    raise exception 'Pick a time window of up to 24 hours';
  end if;

  select jsonb_build_object(
    'contacts', coalesce((
      select jsonb_agg(c order by c.at) from (
        select b.received_at as at, 'app_' || b.reason as what, b.battery_pct, b.charging,
               b.connection, b.outbox_count, b.lat, b.lng,
               extract(epoch from (b.device_time - b.received_at))::integer as clock_off_s
        from public.device_beacons b
        where b.user_id = p_user and b.received_at between p_from and p_to
        union all
        select l.created_at, 'location', null, null, null, null, l.lat, l.lng, null
        from public.location_pings l
        where l.user_id = p_user and l.created_at between p_from and p_to and not l.offline
        union all
        select a.created_at, case when a.type::text = 'opening' then 'clock_in' else 'clock_out' end,
               null, null, null, null, a.lat, a.lng, null
        from public.attendance a
        where a.user_id = p_user and a.created_at between p_from and p_to
        union all
        select v.created_at, 'store_visit', null, null, null, null, v.arrived_lat, v.arrived_lng, null
        from public.store_visits v
        where v.user_id = p_user and v.created_at between p_from and p_to
        union all
        select pc.delivered_at, 'push_delivered', null, null, null, null, null, null, null
        from public.phone_checks pc
        where pc.user_id = p_user and pc.delivered_at between p_from and p_to
        order by 1
        limit 300
      ) c), '[]'::jsonb),
    'offline_positions', coalesce((
      select jsonb_agg(jsonb_build_object('at', l.created_at, 'received_at', l.received_at,
                                          'lat', l.lat, 'lng', l.lng) order by l.created_at)
      from public.location_pings l
      where l.user_id = p_user and l.offline and l.created_at between p_from and p_to), '[]'::jsonb),
    'offline_records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'what', case when a.type::text = 'opening' then 'clock_in' else 'clock_out' end,
        'taken_at', coalesce((a.time_detail->>'taken_at')::timestamptz, a.client_captured_at),
        'sent_at', a.created_at, 'verdict', a.time_verdict, 'lat', a.lat, 'lng', a.lng)
        order by a.client_captured_at)
      from public.attendance a
      where a.user_id = p_user
        and coalesce((a.time_detail->>'taken_at')::timestamptz, a.client_captured_at) between p_from and p_to
        and a.created_at > coalesce((a.time_detail->>'taken_at')::timestamptz, a.client_captured_at)
                           + interval '2 minutes'), '[]'::jsonb),
    'before', (
      select to_jsonb(x) from (
        select b.received_at as at, b.battery_pct, b.charging, b.lat, b.lng
        from public.device_beacons b
        where b.user_id = p_user and b.received_at < p_from and b.received_at > p_from - interval '12 hours'
        order by b.received_at desc limit 1) x),
    'after', (
      select to_jsonb(x) from (
        select b.received_at as at, b.battery_pct, b.charging, b.lat, b.lng
        from public.device_beacons b
        where b.user_id = p_user and b.received_at > p_to and b.received_at < p_to + interval '12 hours'
        order by b.received_at limit 1) x),
    'place_before', (
      select to_jsonb(x) from (
        select t.at, t.lat, t.lng from (
          select l.created_at as at, l.lat, l.lng from public.location_pings l
          where l.user_id = p_user and l.created_at < p_from and l.created_at > p_from - interval '12 hours'
          union all
          select b.received_at, b.lat, b.lng from public.device_beacons b
          where b.user_id = p_user and b.lat is not null
            and b.received_at < p_from and b.received_at > p_from - interval '12 hours'
        ) t order by t.at desc limit 1) x),
    'place_after', (
      select to_jsonb(x) from (
        select t.at, t.lat, t.lng from (
          select l.created_at as at, l.lat, l.lng from public.location_pings l
          where l.user_id = p_user and l.created_at > p_to and l.created_at < p_to + interval '12 hours'
          union all
          select b.received_at, b.lat, b.lng from public.device_beacons b
          where b.user_id = p_user and b.lat is not null
            and b.received_at > p_to and b.received_at < p_to + interval '12 hours'
        ) t order by t.at limit 1) x),
    'phone_checks', coalesce((
      select jsonb_agg(jsonb_build_object('sent_at', pc.created_at, 'delivered_at', pc.delivered_at,
                                          'opened_at', pc.opened_at, 'devices', pc.devices)
                       order by pc.created_at)
      from public.phone_checks pc
      where pc.user_id = p_user and pc.created_at between p_from and p_to), '[]'::jsonb),
    'has_push', exists (select 1 from public.push_subscriptions s
                        where s.user_id = p_user and s.is_active),
    'ever_reported', exists (select 1 from public.device_beacons b where b.user_id = p_user)
  ) into result;
  return result;
end;
$$;

revoke all on function public.check_excuse(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.check_excuse(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- 028's trail, saying which positions were saved offline.
create or replace function public.movement_trail(p_user uuid, p_date date)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  day_start timestamptz := (p_date::timestamp at time zone 'Africa/Lagos');
  day_end   timestamptz := ((p_date + 1)::timestamp at time zone 'Africa/Lagos');
  result jsonb;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only follow your own team';
  end if;

  with points as (
    select a.created_at as at,
           case when a.type::text = 'opening' then 'clock_in' else 'clock_out' end as kind,
           a.lat, a.lng, a.accuracy_m, a.distance_m,
           coalesce(a.place_name, a.address) as place, a.outlet_id
    from public.attendance a
    where a.user_id = p_user and a.created_at >= day_start and a.created_at < day_end
    union all
    select l.created_at, case when l.offline then 'location_offline' else 'location' end,
           l.lat, l.lng, l.accuracy_m, l.distance_m, l.place_name, null
    from public.location_pings l
    where l.user_id = p_user and l.created_at >= day_start and l.created_at < day_end
    union all
    select v.arrived_at, 'visit_in', v.arrived_lat, v.arrived_lng, v.arrived_accuracy_m, null,
           o.name, v.outlet_id
    from public.store_visits v
    left join public.outlets o on o.id = v.outlet_id
    where v.user_id = p_user and v.arrived_at >= day_start and v.arrived_at < day_end
    union all
    select v.departed_at, 'visit_out', v.departed_lat, v.departed_lng, v.departed_accuracy_m, null,
           o.name, v.outlet_id
    from public.store_visits v
    left join public.outlets o on o.id = v.outlet_id
    where v.user_id = p_user and v.departed_at >= day_start and v.departed_at < day_end
      and v.departed_lat is not null
    union all
    select b.received_at, 'app', b.lat, b.lng, b.accuracy_m, null, null, null
    from public.device_beacons b
    where b.user_id = p_user and b.lat is not null
      and b.received_at >= day_start and b.received_at < day_end
  ),
  stores as (
    select o.id, o.name, o.lat, o.lng, o.geofence_radius_m as radius_m
    from public.outlets o
    where o.lat is not null and (
      o.id in (select f.outlet_id from public.outlets_for_user(p_user) f)
      or o.id in (select p.outlet_id from points p where p.outlet_id is not null)
    )
  )
  select jsonb_build_object(
    'person', (select jsonb_build_object('id', pr.id, 'name', pr.full_name, 'phone', pr.phone, 'role', pr.role)
               from public.profiles pr where pr.id = p_user),
    'date', p_date,
    'points', coalesce((select jsonb_agg(to_jsonb(p) order by p.at) from points p
                        where p.lat is not null and p.lng is not null), '[]'::jsonb),
    'stores', coalesce((select jsonb_agg(to_jsonb(s)) from stores s), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.movement_trail(uuid, date) from public, anon;
grant execute on function public.movement_trail(uuid, date) to authenticated, service_role;

select 'Offline positions (029) installed' as result;
