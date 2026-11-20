-- =====================================================================
-- XTEND migration 0095 — movement saved with no signal is always kept
--
-- The phone app saves positions while it has no signal and sends them when
-- the signal returns (0029, 0085). Two limits threw some away:
--
--   * positions older than 24 hours were refused, and so was a finished
--     shift's token 24 hours after it ended;
--   * a phone whose token ran out (18 hours) sends what it saved with the
--     NEXT shift's token, and positions taken before that token were
--     refused, so a long offline day was lost at the next clock-in.
--
--   * the app page's own offline queue (record_offline_pings) also
--     dropped positions older than 24 hours.
--
-- Now a position is kept whenever it was taken during one of the person's
-- own shifts (ping_in_shift: on a day they clocked in, after the clock-in,
-- and before that day's clock-out if there is one), whatever its age and
-- whichever of their tokens brings it. It is stored at the time it was
-- taken, as an offline position, filed under that day, and raises no
-- movement alert. Positions outside every shift are still ignored, and a
-- position from the future is still refused.
--
-- Rerunnable (create or replace).
-- =====================================================================

create or replace function public.ping_in_shift(p_user uuid, p_at timestamptz)
returns boolean
language sql stable security definer set search_path = public as $$
  with day as (
    select min(coalesce(a.client_captured_at, a.created_at)) filter (where a.type = 'opening') as opened,
           max(coalesce(a.client_captured_at, a.created_at)) filter (where a.type = 'closing') as closed
    from public.attendance a
    where a.user_id = p_user and a.attendance_date = (p_at at time zone 'Africa/Lagos')::date
  )
  select coalesce(
    (select opened is not null
            and p_at >= opened - interval '5 minutes'
            and (closed is null or p_at <= closed)
     from day),
    false);
$$;

revoke all on function public.ping_in_shift(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ping_in_shift(uuid, timestamptz) to service_role;

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
  shift_day date;
  opened_at timestamptz;
  closed_at timestamptz;
begin
  select * into t from public.tracking_tokens
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if not exists (select 1 from public.profiles where id = t.user_id and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;

  -- When the shift this token was issued for began and ended (Lagos day).
  shift_day := (t.created_at at time zone 'Africa/Lagos')::date;
  select min(coalesce(a.client_captured_at, a.created_at)) filter (where a.type = 'opening'),
         max(coalesce(a.client_captured_at, a.created_at)) filter (where a.type = 'closing')
    into opened_at, closed_at
  from public.attendance a
  where a.user_id = t.user_id and a.attendance_date = shift_day;

  if t.revoked_at is not null or t.expires_at < now() then
    -- An ended token still delivers what was taken during its shift, however
    -- long the phone was without signal (0095: no 24-hour limit, and a shift
    -- that was never clocked out counts too). A token made after the
    -- clock-out, or on a day with no clock-in, is refused as before.
    if opened_at is not null and (closed_at is null or t.created_at < closed_at) then
      late := true;
    else
      return jsonb_build_object('ok', false, 'reason', 'token');
    end if;
  else
    open_shift := exists (
      select 1 from public.attendance
      where user_id = t.user_id and attendance_date = public.business_date() and type = 'opening'
    ) and not exists (
      select 1 from public.attendance
      where user_id = t.user_id and attendance_date = public.business_date() and type = 'closing'
    );
    if not open_shift then
      -- Its shift is over (or was never clocked out): still deliver it.
      if opened_at is not null and (closed_at is null or t.created_at < closed_at) then
        late := true;
      else
        update public.tracking_tokens set revoked_at = now() where id = t.id;
        return jsonb_build_object('ok', false, 'stop', true, 'shift_open', false);
      end if;
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
    -- 0095: any age, as long as it was taken during one of their shifts
    -- (between a clock-in and that day's clock-out, or after a clock-in not
    -- yet clocked out). A phone that was offline for days sends its saved
    -- positions with the next shift's token, and they are kept.
    if taken is null or taken > now() + interval '2 minutes'
       or not public.ping_in_shift(t.user_id, taken)
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

-- The same for positions the app page itself kept while offline (0029).
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
    -- 0095: older than a day is kept too when it was taken during one of
    -- their shifts (the app page's own queue, signed in).
    if taken is null or taken > now() + interval '2 minutes'
       or (taken < now() - interval '24 hours' and not public.ping_in_shift(me, taken))
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

select 'Movement saved with no signal is always kept (0095) installed' as result;
