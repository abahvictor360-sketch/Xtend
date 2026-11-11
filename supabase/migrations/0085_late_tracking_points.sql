-- =====================================================================
-- XTEND migration 0085 — movement saved with no signal is kept after clock-out
--
-- The Android app saves positions on the phone while it has no signal and
-- sends them when the signal returns. 0055 refused every position once the
-- shift had ended (so a stale queue could not raise movement alerts), but
-- that threw away the whole stretch of an offline shift whenever the
-- clock-out reached the server before the phone's positions did, which is
-- the usual order when both were made with no signal.
--
-- Now, for the token that belongs to a finished shift:
--   * positions taken DURING the shift are kept, for 24 hours after the
--     token ended (or expired), stored as offline positions at the time
--     they were taken, so they raise no movement alerts;
--   * anything taken after the clock-out is still ignored;
--   * the token is retired, and the phone is told to stop, once they are in
--     (the route does not say stop after a full batch of 500, so a longer
--     queue is sent in full).
-- A token issued after the clock-out, one for a shift that never ended, and
-- one that ended more than 24 hours ago are refused as before.
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
    -- An ended token. It still delivers what was taken during a shift that
    -- has since finished, for 24 hours; a token made after the clock-out,
    -- or for a shift that never ended, is refused as before.
    if opened_at is not null and closed_at is not null and t.created_at < closed_at
       and coalesce(t.revoked_at, t.expires_at) > now() - interval '24 hours' then
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
      if opened_at is not null and closed_at is not null and t.created_at < closed_at then
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
    if taken is null or taken > now() + interval '2 minutes' or taken < now() - interval '24 hours'
       or taken < t.created_at - interval '5 minutes'
       or (late and (taken > closed_at or taken < opened_at - interval '5 minutes'))
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

select 'Late tracking points (0085) installed' as result;
