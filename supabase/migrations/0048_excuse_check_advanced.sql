-- =====================================================================
-- 0048: Check an excuse, advanced
--
-- More of what staff say can be checked against what their phone did:
--   * "My location / GPS would not work"
--   * "I was at my store the whole time"
--   * "The app would not let me clock in"
-- alongside "no network" and "my phone was off". The window can now run
-- up to three days. Every check can be kept, with its verdict and a note,
-- so a pattern of excuses shows.
-- =====================================================================

-- Windows up to three days (was one).
create or replace function public.check_excuse(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only check your own team';
  end if;
  if p_to <= p_from or p_to - p_from > interval '72 hours' then
    raise exception 'Pick a time window of up to 3 days';
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

-- What else the phone and the app recorded in the window: every position
-- (with its accuracy, and how far it was from the person's own stores),
-- location problems the phone reported, photos refused, work kept waiting
-- on the phone, and clock-ins and visits.
create or replace function public.check_excuse_more(p_user uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  result jsonb;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only check your own team';
  end if;
  if p_to <= p_from or p_to - p_from > interval '72 hours' then
    raise exception 'Pick a time window of up to 3 days';
  end if;

  with stores as (
    select o.id, o.name, o.lat, o.lng, o.geofence_radius_m as radius_m
    from public.outlets o
    where o.id in (select outlet_id from public.outlets_for_user(p_user)) and o.lat is not null
  ),
  positions as (
    select l.created_at as at, l.lat, l.lng, l.accuracy_m,
           case when l.offline then 'offline' else 'tracking' end as source
    from public.location_pings l
    where l.user_id = p_user and l.created_at between p_from and p_to
    union all
    select b.received_at, b.lat, b.lng, b.accuracy_m, 'app'
    from public.device_beacons b
    where b.user_id = p_user and b.received_at between p_from and p_to and b.lat is not null
    union all
    select a.created_at, a.lat, a.lng, a.accuracy_m, case when a.type::text = 'opening' then 'clock_in' else 'clock_out' end
    from public.attendance a
    where a.user_id = p_user and a.created_at between p_from and p_to
  ),
  placed as (
    select p.*, s.name as store, s.radius_m,
           public.distance_metres(p.lat, p.lng, s.lat, s.lng) as store_m
    from positions p
    left join lateral (
      select st.name, st.radius_m, st.lat, st.lng from stores st
      order by public.distance_metres(p.lat, p.lng, st.lat, st.lng) limit 1
    ) s on true
  )
  select jsonb_build_object(
    'stores', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'radius_m', radius_m)) from stores), '[]'::jsonb),
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', at, 'lat', lat, 'lng', lng, 'accuracy_m', round(accuracy_m::numeric, 1), 'source', source,
        'store', store, 'store_m', round(store_m::numeric), 'radius_m', radius_m) order by at)
      from (select * from placed order by at limit 500) x), '[]'::jsonb),
    'location_problems', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.created_at, 'kind', a.alert_type::text,
                                          'distance_m', round(a.distance_m::numeric)) order by a.created_at)
      from public.location_alerts a
      where a.user_id = p_user and a.created_at between p_from and p_to), '[]'::jsonb),
    'photos_refused', coalesce((
      select jsonb_agg(jsonb_build_object('at', c.created_at, 'kind', c.kind, 'problem', c.problem,
                                          'message', c.message) order by c.created_at)
      from public.photo_checks c
      where c.user_id = p_user and c.verdict = 'reject' and c.created_at between p_from and p_to), '[]'::jsonb),
    'queued', (
      select jsonb_build_object('most', max(b.outbox_count), 'oldest', min(b.oldest_queued_at))
      from public.device_beacons b
      where b.user_id = p_user and b.received_at between p_from and p_to and b.outbox_count > 0),
    'clock', coalesce((
      select jsonb_agg(jsonb_build_object('at', a.created_at, 'type', a.type::text, 'status', a.status::text,
                                          'distance_m', round(a.distance_m::numeric)) order by a.created_at)
      from public.attendance a
      where a.user_id = p_user and a.created_at between p_from and p_to), '[]'::jsonb),
    'visits', coalesce((
      select jsonb_agg(jsonb_build_object('at', v.created_at, 'status', v.arrived_status::text) order by v.created_at)
      from public.store_visits v
      where v.user_id = p_user and v.created_at between p_from and p_to), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.check_excuse_more(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.check_excuse_more(uuid, timestamptz, timestamptz) to authenticated, service_role;

-- Checks kept, so a pattern of excuses shows.
create table if not exists public.excuse_checks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  claim        text not null check (claim in ('no_network', 'phone_off', 'gps_failed', 'at_store', 'app_failed')),
  window_from  timestamptz not null,
  window_to    timestamptz not null,
  verdict      text not null check (verdict in ('false', 'doubtful', 'fits', 'unknown')),
  headline     text not null check (length(headline) between 1 and 500),
  note         text check (note is null or length(note) <= 500),
  checked_by   uuid not null references public.profiles(id) on delete restrict,
  created_at   timestamptz not null default now(),
  check (window_to > window_from)
);
create index if not exists excuse_checks_by_user on public.excuse_checks (user_id, created_at desc);

alter table public.excuse_checks enable row level security;
drop policy if exists excuse_checks_read on public.excuse_checks;
create policy excuse_checks_read on public.excuse_checks for select
  using (public.is_admin() or public.supervises_user(user_id));
revoke insert, update, delete, truncate on public.excuse_checks from anon, authenticated;

create or replace function public.record_excuse_check(
  p_user uuid, p_claim text, p_from timestamptz, p_to timestamptz,
  p_verdict text, p_headline text, p_note text
) returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if not (public.is_admin() or public.supervises_user(p_user)) then
    raise exception 'You can only check your own team';
  end if;
  insert into public.excuse_checks (user_id, claim, window_from, window_to, verdict, headline, note, checked_by)
  values (p_user, p_claim, p_from, p_to, p_verdict, left(btrim(p_headline), 500),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.record_excuse_check(uuid, text, timestamptz, timestamptz, text, text, text) from public, anon;
grant execute on function public.record_excuse_check(uuid, text, timestamptz, timestamptz, text, text, text)
  to authenticated, service_role;

create or replace view public.excuse_check_detail
with (security_invoker = true) as
  select e.*, p.full_name as staff_name, c.full_name as checked_by_name
  from public.excuse_checks e
  join public.profiles p on p.id = e.user_id
  left join public.profiles c on c.id = e.checked_by;
grant select on public.excuse_check_detail to authenticated;

select 'Check an excuse, advanced (048) installed' as result;
