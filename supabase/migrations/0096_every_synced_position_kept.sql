-- =====================================================================
-- XTEND migration 0096 — every synced position is kept
--
-- The phone saves positions while it has no signal and sends them when the
-- signal returns. 0095 kept them at any age, but only when they were taken
-- during a shift (after a clock-in, before that day's clock-out). Some were
-- still lost: positions from a day whose clock-in had not reached Xtend yet
-- (or was never accepted), from before the clock-in, or after the clock-out,
-- and everything a token made after the clock-out brought.
--
-- Now, whenever positions are synced, the server keeps every one:
--
--   * any age, any time of day, whichever of the person's own tokens (live,
--     ended, or made after the clock-out) brings it;
--   * stored at the time it was taken, as an offline position, under the
--     day it was taken; it raises no "left the store" alert after the event;
--   * only a position from the future, a broken one, a resend already
--     stored, or one the app page made up after saying nothing was waiting
--     (flagged, 0029) is skipped; an unknown token or a deactivated person
--     is still refused;
--   * when a clock-in reaches Xtend after that day's positions, they are
--     joined to it (and given their distance from it) at once.
--
-- Rerunnable (create or replace).
-- =====================================================================

create or replace function public.record_background_pings(
  p_token text, p_points jsonb, p_sent_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
  offset_s integer := coalesce(extract(epoch from (p_sent_at - now()))::integer, 0);
  point jsonb;
  taken timestamptz;
  kept integer := 0;
  mocked integer := 0;
  la double precision;
  ln double precision;
  acc double precision;
  alert_before timestamptz;
  alert record;
  open_shift boolean;
  late boolean := false;
begin
  select * into t from public.tracking_tokens
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if not exists (select 1 from public.profiles where id = t.user_id and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;

  if t.revoked_at is not null or t.expires_at < now() then
    -- 0096: an ended token always delivers what the phone saved, whenever
    -- it arrives. It is still the person's own phone.
    late := true;
  else
    open_shift := exists (
      select 1 from public.attendance
      where user_id = t.user_id and attendance_date = public.business_date() and type = 'opening'
    ) and not exists (
      select 1 from public.attendance
      where user_id = t.user_id and attendance_date = public.business_date() and type = 'closing'
    );
    if not open_shift then
      -- No shift open now: what it brings is still stored (0096), then the
      -- phone is told to stop.
      late := true;
    end if;
  end if;

  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 500 then
    raise exception 'Send at most 500 positions at a time';
  end if;

  perform set_config('request.jwt.claim.sub', t.user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.user_id, 'role', 'authenticated')::text, true);

  select max(created_at) into alert_before from public.location_alerts
  where user_id = t.user_id and alert_type = 'left_geofence';

  for point in select * from jsonb_array_elements(p_points) order by (value->>'captured_at') loop
    taken := public.safe_ts(point->>'captured_at') - make_interval(secs => offset_s);
    -- 0096: every position is kept whenever it arrives, at any age and
    -- whichever of their tokens brings it. Only a time from the future or a
    -- broken position is skipped.
    if taken is null or taken > now() + interval '2 minutes'
       or jsonb_typeof(point->'lat') <> 'number' or jsonb_typeof(point->'lng') <> 'number'
       or jsonb_typeof(point->'accuracy_m') <> 'number' then
      continue;
    end if;
    la := (point->>'lat')::float8;
    ln := (point->>'lng')::float8;
    acc := (point->>'accuracy_m')::float8;
    if abs(la) > 90 or abs(ln) > 180 or acc < 0 then continue; end if;
    if (point->>'is_mock')::boolean is true then mocked := mocked + 1; end if;
    if exists (
      select 1 from public.location_pings l
      where l.user_id = t.user_id and l.created_at between taken - interval '1 second' and taken + interval '1 second'
    ) then continue; end if;

    -- After the shift every position is stored as the offline one it is, at
    -- the time it was taken, so none can raise a movement alert.
    if not late and now() - taken <= interval '2 minutes' then
      perform set_config('xtend.offline_ping', 'off', true);
      insert into public.location_pings (lat, lng, accuracy_m) values (la, ln, acc);
    else
      perform set_config('xtend.offline_ping', 'on', true);
      insert into public.location_pings (lat, lng, accuracy_m, created_at) values (la, ln, acc, taken);
    end if;
    kept := kept + 1;
  end loop;
  perform set_config('xtend.offline_ping', 'off', true);

  if mocked > 0 and not exists (
    select 1 from public.integrity_flags
    where user_id = t.user_id and kind = 'mock_location_confirmed'
      and flag_date = public.business_date() and detail->>'source' = 'background'
  ) then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (t.user_id, 'mock_location_confirmed', 'high',
            format('The phone said %s position%s sent while on shift came from a fake-location app',
                   mocked, case when mocked = 1 then '' else 's' end),
            jsonb_build_object('source', 'background', 'positions', mocked));
  end if;

  update public.tracking_tokens set last_used_at = now(), points = points + kept where id = t.id;

  if late then
    -- The shift is over: retire the token (the route tells the phone to stop
    -- unless this was a full batch, so a longer queue is sent in full).
    if t.revoked_at is null then
      update public.tracking_tokens set revoked_at = now() where id = t.id;
    end if;
    return jsonb_build_object('ok', true, 'user_id', t.user_id, 'kept', kept,
                              'shift_open', false, 'late', true, 'alert', null);
  end if;

  select a.id, a.distance_m, l.id as ping_id, l.lat, l.lng into alert
  from public.location_alerts a
  left join lateral (
    select p.id, p.lat, p.lng from public.location_pings p
    where p.user_id = t.user_id and not p.offline order by p.created_at desc limit 1
  ) l on true
  where a.user_id = t.user_id and a.alert_type = 'left_geofence'
    and a.created_at > coalesce(alert_before, '-infinity')
  order by a.created_at desc limit 1;

  -- Re-check after processing to close the race with a simultaneous clock-out.
  open_shift := exists (
    select 1 from public.attendance
    where user_id = t.user_id and attendance_date = public.business_date() and type = 'opening'
  ) and not exists (
    select 1 from public.attendance
    where user_id = t.user_id and attendance_date = public.business_date() and type = 'closing'
  );
  if not open_shift then update public.tracking_tokens set revoked_at = now() where id = t.id; end if;

  return jsonb_build_object(
    'ok', true, 'user_id', t.user_id, 'kept', kept, 'shift_open', open_shift,
    'alert', case when alert.id is null then null else jsonb_build_object(
      'id', alert.id, 'distance_m', alert.distance_m, 'ping_id', alert.ping_id,
      'lat', alert.lat, 'lng', alert.lng) end
  );
end;
$$;

-- The same for positions the app page itself kept while offline (0029, 0095).
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
    -- 0096: kept at any age.
    if taken is null or taken > now() + interval '2 minutes'
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

-- A clock-in that arrives after its day's positions takes them in.
create or replace function public.link_day_pings(p_opening uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  o record;
  n integer;
begin
  select a.id, a.user_id, a.lat, a.lng, a.attendance_date into o
  from public.attendance a where a.id = p_opening and a.type = 'opening';
  if o.id is null then return 0; end if;
  update public.location_pings p
     set attendance_id = o.id,
         distance_m = public.distance_metres(p.lat, p.lng, o.lat, o.lng)
   where p.user_id = o.user_id
     and p.attendance_id is null
     and (p.created_at at time zone 'Africa/Lagos')::date = o.attendance_date;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.link_day_pings(uuid) from public, anon, authenticated;
grant execute on function public.link_day_pings(uuid) to service_role;

create or replace function public.attendance_claim_pings()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'opening' then
    perform public.link_day_pings(new.id);
  end if;
  return null;
end;
$$;

revoke all on function public.attendance_claim_pings() from public, anon, authenticated;

drop trigger if exists trg_attendance_claim_pings on public.attendance;
create trigger trg_attendance_claim_pings
  after insert on public.attendance
  for each row execute function public.attendance_claim_pings();

select 'Every synced position is kept (0096) installed' as result;
