-- 0055: Do not persist native tracking points after clock-out.
--
-- A phone can have a small offline queue. Check the shift before processing
-- that queue so points received after clock-out cannot create movement alerts.
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
begin
  select * into t from public.tracking_tokens
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if t.id is null or t.revoked_at is not null or t.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if not exists (select 1 from public.profiles where id = t.user_id and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;

  open_shift := exists (
    select 1 from public.attendance
    where user_id = t.user_id and attendance_date = public.business_date() and type = 'opening'
  ) and not exists (
    select 1 from public.attendance
    where user_id = t.user_id and attendance_date = public.business_date() and type = 'closing'
  );
  if not open_shift then
    update public.tracking_tokens set revoked_at = now() where id = t.id;
    return jsonb_build_object('ok', false, 'stop', true, 'shift_open', false);
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

    if now() - taken <= interval '2 minutes' then
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
revoke all on function public.record_background_pings(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_background_pings(text, jsonb, timestamptz) to service_role;
