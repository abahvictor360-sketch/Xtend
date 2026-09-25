-- =====================================================================
-- XTEND migration 026 — "my network was bad", "my phone was off"
--
-- Two excuses staff give for a late or missing clock-in, and the evidence
-- that settles them:
--
--   1. The app quietly tells Xtend when it is opened, comes back on screen,
--      regains network, or every few minutes while open: whether it is
--      online, the battery, whether anything is waiting to upload, the
--      phone's own clock. Staff are not told. (device_beacons)
--   2. Every clock-in and clock-out is judged on its timing. One that
--      arrived late because the phone was offline is checked against
--      what the phone reported in the meantime: the phone talked to Xtend
--      after the time it claims (so the time was faked), the phone clock
--      was wrong, or the phone had network long before it sent it.
--      (attendance.time_verdict, and integrity flags)
--   3. A supervisor checks a claim: who, when, and "no network" or "phone
--      off". check_excuse() gathers everything Xtend heard from that phone
--      in that time and around it. (The app words the verdict.)
--   4. "Check the phone now": a push is sent to the phone and the phone
--      reports that it arrived. Delivered means on, with network, right
--      now. (phone_checks)
--
-- It also rewords the place-naming messages from 025 so that nothing
-- tells staff that Xtend learns places.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'known_places'
                   and column_name = 'visitors') then
    raise exception 'Run the place safeguards update (025, step 7) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Naming a place, with messages that say nothing about learning.
-- Same rules as 025.
-- ---------------------------------------------------------------------
create or replace function public.learn_place(
  p_lat double precision,
  p_lng double precision,
  p_name text,
  p_address text,
  p_source text,
  p_photo_path text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  clean text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  found uuid;
  clash record;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if p_source not in ('google', 'osm', 'staff') then
    raise exception 'Unknown place source';
  end if;
  if length(clean) < 2 or length(clean) > 120 then
    raise exception 'A place name needs 2 to 120 characters';
  end if;

  if public.outlet_containing(p_lat, p_lng) is not null then
    return null;
  end if;

  select k.id into found from public.known_place_at(p_lat, p_lng) k;
  if found is not null then
    update public.known_places
    set times_seen = times_seen + 1, last_seen_at = now(),
        visitors = case when me = any(visitors) then visitors else visitors || me end
    where id = found;
    return found;
  end if;

  if p_source = 'staff' then
    select x.name, x.km into clash from (
      select o.name, public.distance_metres(p_lat, p_lng, o.lat, o.lng) / 1000.0 as km
      from public.outlets o
      where o.is_active and public.names_overlap(o.name, clean)
      union all
      select k.name, public.distance_metres(p_lat, p_lng, k.lat, k.lng) / 1000.0
      from public.known_places k
      where k.verified and public.names_overlap(k.name, clean)
    ) x
    where x.km > 0.5
    order by x.km
    limit 1;
    if clash.name is not null then
      raise exception 'That name does not match where you are standing. Type the name on the sign here';
    end if;

    if p_photo_path is null or not public.photo_is_fresh('reports', p_photo_path, 30)
       or not exists (select 1 from public.photo_checks c
                      where c.path = p_photo_path and c.kind = 'storefront') then
      raise exception 'Take a photo of the shop front or sign';
    end if;
    if exists (select 1 from public.known_places k where k.photo_path = p_photo_path) then
      raise exception 'Take a new photo here';
    end if;

    if (select count(*) from public.known_places k
        where k.named_by = me and k.source = 'staff' and k.created_at > now() - interval '1 day') >= 10 then
      raise exception 'No more place names can be added today';
    end if;
  end if;

  insert into public.known_places (name, address, lat, lng, source, named_by, photo_path, visitors)
  values (clean, nullif(btrim(coalesce(p_address, '')), ''), p_lat, p_lng, p_source,
          case when p_source = 'staff' then me end,
          case when p_source = 'staff' then p_photo_path end,
          array[me])
  returning id into found;
  return found;
end;
$$;

revoke all on function public.learn_place(double precision, double precision, text, text, text, text) from public, anon;
grant execute on function public.learn_place(double precision, double precision, text, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. What the phone reports about itself.
-- ---------------------------------------------------------------------
create table if not exists public.device_beacons (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  received_at      timestamptz not null default now(),
  reason           text not null check (reason in ('open', 'visible', 'hidden', 'online', 'interval')),
  connection       text check (connection is null or length(connection) <= 20),
  battery_pct      smallint check (battery_pct between 0 and 100),
  charging         boolean,
  outbox_count     integer check (outbox_count >= 0),
  oldest_queued_at timestamptz,
  device_time      timestamptz,
  offline_since    timestamptz,
  lat              double precision check (lat between -90 and 90),
  lng              double precision check (lng between -180 and 180),
  accuracy_m       double precision check (accuracy_m >= 0)
);

create index if not exists device_beacons_by_user on public.device_beacons (user_id, received_at desc);

alter table public.device_beacons enable row level security;

drop policy if exists device_beacons_select on public.device_beacons;
create policy device_beacons_select on public.device_beacons
  for select using (public.is_admin() or public.supervises_user(user_id));

revoke insert, update, delete, truncate on public.device_beacons from anon, authenticated;

-- A value from the phone, or null when it is not a timestamp.
create or replace function public.safe_ts(p text)
returns timestamptz language plpgsql immutable as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end;
$$;

create or replace function public.safe_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- Records one report from the caller's phone. Returns its id, which the
-- phone keeps and attaches to anything it has to save offline: proof of
-- the last moment it was in touch.
create or replace function public.record_beacon(p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  recent record;
  made record;
  why text := coalesce(p->>'reason', 'interval');
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  if why not in ('open', 'visible', 'hidden', 'online', 'interval') then
    why := 'interval';
  end if;

  -- Several in a few seconds (a page opening fires more than one event)
  -- are one report.
  select b.id, b.received_at into recent
  from public.device_beacons b
  where b.user_id = me and b.received_at > now() - interval '15 seconds' and b.reason = why
  order by b.received_at desc limit 1;
  if recent.id is not null then
    return jsonb_build_object('id', recent.id, 'server_time', recent.received_at);
  end if;

  insert into public.device_beacons (user_id, reason, connection, battery_pct, charging, outbox_count,
                                     oldest_queued_at, device_time, offline_since, lat, lng, accuracy_m)
  values (
    me, why,
    left(nullif(p->>'connection', ''), 20),
    case when (p->>'battery_pct') ~ '^\d{1,3}$' and (p->>'battery_pct')::int <= 100
         then (p->>'battery_pct')::smallint end,
    case when p->>'charging' in ('true', 'false') then (p->>'charging')::boolean end,
    case when (p->>'outbox_count') ~ '^\d{1,6}$' then (p->>'outbox_count')::int end,
    public.safe_ts(p->>'oldest_queued_at'),
    public.safe_ts(p->>'device_time'),
    public.safe_ts(p->>'offline_since'),
    case when jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number'
          and abs((p->>'lat')::float8) <= 90 and abs((p->>'lng')::float8) <= 180
         then (p->>'lat')::float8 end,
    case when jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number'
          and abs((p->>'lat')::float8) <= 90 and abs((p->>'lng')::float8) <= 180
         then (p->>'lng')::float8 end,
    case when jsonb_typeof(p->'accuracy_m') = 'number' and (p->>'accuracy_m')::float8 >= 0
         then (p->>'accuracy_m')::float8 end
  )
  returning id, received_at into made;
  return jsonb_build_object('id', made.id, 'server_time', made.received_at);
end;
$$;

revoke all on function public.record_beacon(jsonb) from public, anon;
grant execute on function public.record_beacon(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Was a clock-in's time real?
-- ---------------------------------------------------------------------
alter table public.attendance
  add column if not exists time_verdict text,
  add column if not exists time_detail jsonb;

alter table public.attendance drop constraint if exists attendance_time_verdict_check;
alter table public.attendance add constraint attendance_time_verdict_check check (
  time_verdict is null or time_verdict in (
    'live', 'offline_confirmed', 'offline_unproven', 'network_was_available',
    'phone_clock_wrong', 'backdated'));

-- Judges one clock event from what the phone said about it and what the
-- server heard from that phone. p_device is the clock event's device_info:
-- sent_at (the phone's clock when it sent it) and anchor_beacon (the last
-- report the phone had got through before taking it).
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
        where l.user_id = p_user and l.created_at > taken + interval '10 minutes'
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
        where l.user_id = p_user and l.created_at <= taken + interval '2 minutes'
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

create or replace function public.attendance_timing()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  judged jsonb;
begin
  if new.user_id is null then
    return new;
  end if;
  judged := public.clock_timing(new.user_id, new.client_captured_at, new.device_info, now());
  new.time_verdict := judged->>'verdict';
  new.time_detail := judged - 'verdict';
  return new;
end;
$$;

revoke all on function public.attendance_timing() from public, anon, authenticated;

-- Named to run after trg_attendance_enforce, which sets user_id.
drop trigger if exists trg_attendance_timing on public.attendance;
create trigger trg_attendance_timing
  before insert on public.attendance
  for each row execute function public.attendance_timing();

alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check check (kind in (
  'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
  'count_units_missing', 'count_identical', 'count_round_numbers',
  'photo_rejected', 'photo_unchecked', 'own_named_place', 'selfie_at_home',
  'backdated_clock', 'phone_clock_wrong', 'late_sync_with_network'));

-- A time in Lagos, for flag summaries.
create or replace function public.lagos_hm(t timestamptz)
returns text language sql immutable as $$
  select to_char(t at time zone 'Africa/Lagos', 'HH24:MI');
$$;

create or replace function public.attendance_timing_flag()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  what text := case when new.type::text = 'opening' then 'clock-in' else 'clock-out' end;
  d jsonb := coalesce(new.time_detail, '{}'::jsonb);
  off integer := coalesce((d->>'offset_s')::integer, 0);
begin
  if new.time_verdict = 'backdated' then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (new.user_id, 'backdated_clock', 'high',
      format('The %s says it was taken at %s, offline, but the phone was in touch with Xtend at %s, after that. The time was changed on the phone',
             what, public.lagos_hm((d->>'taken_at')::timestamptz), public.lagos_hm((d->>'contact_at')::timestamptz)),
      d || jsonb_build_object('attendance_id', new.id), new.outlet_id);
  elsif new.time_verdict = 'phone_clock_wrong' then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (new.user_id, 'phone_clock_wrong', 'medium',
      format('The phone''s clock was %s minutes %s at this %s. Phones set their own time; someone changed it',
             abs(off) / 60, case when off > 0 then 'ahead' else 'behind' end, what),
      d || jsonb_build_object('attendance_id', new.id), new.outlet_id);
  elsif new.time_verdict = 'network_was_available' then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
    values (new.user_id, 'late_sync_with_network', 'low',
      format('The %s was taken offline at %s and only sent at %s, but the phone had network at %s',
             what, public.lagos_hm((d->>'taken_at')::timestamptz), public.lagos_hm(new.created_at),
             public.lagos_hm((d->>'contact_at')::timestamptz)),
      d || jsonb_build_object('attendance_id', new.id), new.outlet_id);
  end if;
  return null;
end;
$$;

revoke all on function public.attendance_timing_flag() from public, anon, authenticated;

drop trigger if exists trg_attendance_timing_flag on public.attendance;
create trigger trg_attendance_timing_flag
  after insert on public.attendance
  for each row execute function public.attendance_timing_flag();

-- ---------------------------------------------------------------------
-- 4. "Check the phone now."
-- ---------------------------------------------------------------------
create table if not exists public.phone_checks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  token        uuid not null default gen_random_uuid(),
  devices      integer not null default 0,
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,
  opened_at    timestamptz
);

create index if not exists phone_checks_by_user on public.phone_checks (user_id, created_at desc);

alter table public.phone_checks enable row level security;

drop policy if exists phone_checks_select on public.phone_checks;
create policy phone_checks_select on public.phone_checks
  for select using (public.is_admin() or public.supervises_user(user_id));

-- The token proves the answer came from the phone; nobody reads it.
revoke all on public.phone_checks from anon, authenticated;
grant select (id, user_id, requested_by, devices, created_at, delivered_at, opened_at)
  on public.phone_checks to authenticated;

create or replace function public.request_phone_check(p_user uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  made uuid;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only check the phones of your own team';
  end if;
  -- One at a time: a check sent in the last two minutes is still running.
  select c.id into made from public.phone_checks c
  where c.user_id = p_user and c.created_at > now() - interval '2 minutes'
  order by c.created_at desc limit 1;
  if made is not null then
    return made;
  end if;
  insert into public.phone_checks (user_id, requested_by) values (p_user, auth.uid())
  returning id into made;
  return made;
end;
$$;

revoke all on function public.request_phone_check(uuid) from public, anon;
grant execute on function public.request_phone_check(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Everything Xtend heard from one phone around a claimed gap.
-- ---------------------------------------------------------------------
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
        where l.user_id = p_user and l.created_at between p_from and p_to
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

select 'Phone evidence (026) installed' as result;
