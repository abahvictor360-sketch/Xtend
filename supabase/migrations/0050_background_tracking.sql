-- =====================================================================
-- 0050: Location during a shift, even with the app closed
--
-- The Xtend app now tracks a shift natively: on Android a foreground
-- service ("Xtend · On shift") that keeps running when the app is swiped
-- away or the phone restarts; on iPhone the system's location service,
-- which wakes the app when the person moves even after it was closed.
-- Neither has the web page, nor its sign-in, so each phone gets its own
-- tracking token at clock-in: it can only add positions for that person,
-- it expires, and it stops working at clock-out.
-- =====================================================================

create table if not exists public.tracking_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- sha256 of the token; the token itself is never stored.
  token_hash text not null unique,
  platform text not null check (platform in ('android', 'ios')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  points integer not null default 0
);
create index if not exists tracking_tokens_by_user on public.tracking_tokens (user_id, created_at desc);
alter table public.tracking_tokens enable row level security;
-- No policies: only the functions below read or write it.

-- A new token for the signed-in field worker's phone. Earlier tokens for
-- the same platform are revoked, so one phone tracks at a time.
create or replace function public.issue_tracking_token(p_platform text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  token text;
  expires timestamptz;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if not exists (select 1 from public.profiles
                 where id = me and is_active and role in ('merchandiser', 'marketer')) then
    raise exception 'Only field staff use this';
  end if;
  if p_platform not in ('android', 'ios') then
    raise exception 'Unknown platform';
  end if;

  update public.tracking_tokens set revoked_at = now()
  where user_id = me and platform = p_platform and revoked_at is null;

  token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  -- Long enough for the longest shift, never into the next one.
  expires := now() + interval '18 hours';
  insert into public.tracking_tokens (user_id, token_hash, platform, expires_at)
  values (me, encode(sha256(convert_to(token, 'utf8')), 'hex'), p_platform, expires);
  return jsonb_build_object('token', token, 'expires_at', expires);
end;
$$;
revoke all on function public.issue_tracking_token(text) from public, anon;
grant execute on function public.issue_tracking_token(text) to authenticated;

-- Clock-out from the app: its tokens stop at once.
create or replace function public.revoke_tracking_tokens()
returns void
language sql security definer set search_path = public as $$
  update public.tracking_tokens set revoked_at = now()
  where user_id = auth.uid() and revoked_at is null;
$$;
revoke all on function public.revoke_tracking_tokens() from public, anon;
grant execute on function public.revoke_tracking_tokens() to authenticated;

-- Positions from the native tracker. Called by the server (service role)
-- with the token the phone sent. Each point is stored as if the person had
-- sent it: a recent one is live (it can raise "left the store"), an older
-- one, kept on the phone without network, is stored at the time it was
-- taken. Returns whether the shift is still open, so the phone stops
-- tracking once they have clocked out.
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
  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 500 then
    raise exception 'Send at most 500 positions at a time';
  end if;

  -- The rows are the person's own: the ping triggers read auth.uid().
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
    if abs(la) > 90 or abs(ln) > 180 or acc < 0 then
      continue;
    end if;
    if (point->>'is_mock')::boolean is true then
      mocked := mocked + 1;
    end if;
    -- Already here (a retry after a dropped connection).
    if exists (select 1 from public.location_pings l
               where l.user_id = t.user_id and l.created_at between taken - interval '1 second'
                                                              and taken + interval '1 second') then
      continue;
    end if;

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
    select 1 from public.integrity_flags f
    where f.user_id = t.user_id and f.kind = 'mock_location_confirmed'
      and f.flag_date = public.business_date() and f.detail->>'source' = 'background') then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (t.user_id, 'mock_location_confirmed', 'high',
            format('The phone said %s position%s sent while on shift came from a fake-location app',
                   mocked, case when mocked = 1 then '' else 's' end),
            jsonb_build_object('source', 'background', 'positions', mocked));
  end if;

  update public.tracking_tokens
  set last_used_at = now(), points = points + kept
  where id = t.id;

  -- A "left the store" alert this raised, for the server to tell the watchers.
  select a.id, a.distance_m, l.id as ping_id, l.lat, l.lng into alert
  from public.location_alerts a
  left join lateral (
    select p.id, p.lat, p.lng from public.location_pings p
    where p.user_id = t.user_id and not p.offline order by p.created_at desc limit 1
  ) l on true
  where a.user_id = t.user_id and a.alert_type = 'left_geofence'
    and a.created_at > coalesce(alert_before, '-infinity')
  order by a.created_at desc limit 1;

  open_shift := exists (select 1 from public.attendance a
                        where a.user_id = t.user_id and a.attendance_date = public.business_date()
                          and a.type = 'opening')
            and not exists (select 1 from public.attendance a
                            where a.user_id = t.user_id and a.attendance_date = public.business_date()
                              and a.type = 'closing');
  if not open_shift then
    update public.tracking_tokens set revoked_at = now() where id = t.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'user_id', t.user_id,
    'kept', kept,
    'shift_open', open_shift,
    'alert', case when alert.id is null then null else jsonb_build_object(
      'id', alert.id, 'distance_m', alert.distance_m, 'ping_id', alert.ping_id, 'lat', alert.lat, 'lng', alert.lng) end
  );
end;
$$;
revoke all on function public.record_background_pings(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.record_background_pings(text, jsonb, timestamptz) to service_role;

select 'Background tracking (050) installed' as result;
