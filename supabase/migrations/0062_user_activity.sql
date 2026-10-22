-- =====================================================================
-- 0062: User activity log
--
-- "Admin should also monitor user activity logs." The Audit log (049)
-- covers changes the office makes; this covers what everybody does in
-- Xtend: signing in and out, opening the app, clocking in and out, store
-- visits, reports, stock counts, leave, support messages, password and
-- profile photo changes. With the time, the device and the IP address.
--
--   * user_activity holds what is not stored anywhere else: sign-ins,
--     sign-outs, app opens, password and photo changes. Rows are written
--     only by record_activity() (the server, with the service role) and by
--     set_my_avatar(); nobody writes the table directly.
--   * activity_feed() puts those rows together with the activity already
--     kept in attendance, store_visits, reports, store_counts, xm_counts,
--     xm_sales, leave_requests and support_messages, labelled in plain
--     English, newest first. Admins only: staff never see it, and
--     supervisors do not get it either.
--   * "Opened the app" is kept at most once per person per platform every
--     30 minutes, so a phone switching between apps all day does not
--     flood the log.
--   * purge_user_activity() deletes rows older than 180 days; the nightly
--     /api/cron/purge-selfies job calls it.
-- =====================================================================

create table if not exists public.user_activity (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('sign_in', 'sign_out', 'app_open', 'password_changed', 'photo_changed')),
  at          timestamptz not null default now(),
  ip          text,
  platform    text check (platform in ('web', 'android', 'ios')),
  app_build   integer,
  user_agent  text,
  device      jsonb,
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists user_activity_user_at on public.user_activity (user_id, at desc);
create index if not exists user_activity_at on public.user_activity (at desc);

alter table public.user_activity enable row level security;

-- Admins read everything; nobody else reads anything.
drop policy if exists user_activity_admin_read on public.user_activity;
create policy user_activity_admin_read on public.user_activity
  for select using (public.is_admin());

-- Append-only, and only through the functions below.
revoke all on public.user_activity from anon;
revoke insert, update, delete, truncate on public.user_activity from authenticated, service_role;
grant select on public.user_activity to authenticated;

-- The platform a browser string comes from: the Xtend app (it adds
-- "XtendApp" to its user agent) on Android or iPhone, otherwise the web.
create or replace function public.activity_platform(p_ua text)
returns text
language sql immutable set search_path = public as $$
  select case
    when p_ua is null or p_ua = '' then null
    when p_ua like '%XtendApp%' and p_ua ~ 'Android' then 'android'
    when p_ua like '%XtendApp%' and p_ua ~ 'iPhone|iPad|iPod' then 'ios'
    else 'web'
  end;
$$;
revoke all on function public.activity_platform(text) from public, anon;
grant execute on function public.activity_platform(text) to authenticated, service_role;

-- The server's side: one row for someone. p_at is only for the tests.
-- Returns false when an app open is skipped (one already within 30 minutes
-- from the same platform).
create or replace function public.record_activity(
  p_user       uuid,
  p_kind       text,
  p_ip         text default null,
  p_platform   text default null,
  p_app_build  integer default null,
  p_user_agent text default null,
  p_device     jsonb default null,
  p_detail     jsonb default '{}'::jsonb,
  p_at         timestamptz default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  plat text := case when p_platform in ('web', 'android', 'ios') then p_platform
                    else public.activity_platform(p_user_agent) end;
  stamp timestamptz := coalesce(p_at, now());
begin
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'Unknown person';
  end if;
  if p_kind is null or p_kind not in ('sign_in', 'sign_out', 'app_open', 'password_changed', 'photo_changed') then
    raise exception 'Unknown activity: %', coalesce(p_kind, 'none');
  end if;

  if p_kind = 'app_open' then
    -- One at a time per person and platform, so two opens sent together
    -- cannot both pass the check.
    perform pg_advisory_xact_lock(hashtext('user_activity:' || p_user::text || ':' || coalesce(plat, '')));
    if exists (select 1 from public.user_activity a
               where a.user_id = p_user and a.kind = 'app_open'
                 and a.platform is not distinct from plat
                 and a.at > stamp - interval '30 minutes'
                 and a.at <= stamp + interval '30 minutes') then
      return false;
    end if;
  end if;

  insert into public.user_activity (user_id, kind, at, ip, platform, app_build, user_agent, device, detail)
  values (p_user, p_kind, stamp, left(p_ip, 64), plat,
          case when p_app_build between 0 and 100000000 then p_app_build end,
          left(p_user_agent, 500),
          case when jsonb_typeof(p_device) = 'object' then p_device end,
          case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}'::jsonb end);
  return true;
end;
$$;
revoke all on function public.record_activity(uuid, text, text, text, integer, text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_activity(uuid, text, text, text, integer, text, jsonb, jsonb, timestamptz)
  to service_role;

-- A new profile photo is recorded where it is set. The browser calls this
-- through the Supabase API, so the address and browser string come from
-- the request headers PostgREST passes in.
create or replace function public.set_my_avatar(p_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hdr jsonb;
  ua text;
  ip text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_path is null or p_path not like uid::text || '/%' then
    raise exception 'That photo is not yours';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
    raise exception 'Upload the photo first';
  end if;
  perform set_config('xtend.own_photo', 'on', true);
  update public.profiles set avatar_path = p_path where id = uid;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    hdr := null;
  end;
  ua := left(hdr->>'user-agent', 500);
  ip := coalesce(hdr->>'cf-connecting-ip', hdr->>'x-real-ip',
                 nullif(btrim(split_part(coalesce(hdr->>'x-forwarded-for', ''), ',', 1)), ''));
  insert into public.user_activity (user_id, kind, ip, platform, user_agent)
  values (uid, 'photo_changed', left(ip, 64), public.activity_platform(ua), ua);
end;
$$;
revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- Everybody's activity between two Lagos dates, newest first. Admins only.
create or replace function public.activity_feed(
  p_from  date,
  p_to    date,
  p_user  uuid default null,
  p_kinds text[] default null,
  p_limit integer default 1000
) returns table (
  at          timestamptz,
  user_id     uuid,
  full_name   text,
  role        text,
  kind        text,
  label       text,
  detail      jsonb,
  ip          text,
  platform    text,
  device      text,
  user_agent  text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  d_from date := coalesce(p_from, (now() at time zone 'Africa/Lagos')::date);
  d_to   date := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  t_from timestamptz;
  t_to   timestamptz;
  lim    integer := least(greatest(coalesce(p_limit, 1000), 1), 5000);
begin
  if not public.is_admin() then
    raise exception 'Only admins can see the activity log';
  end if;
  if d_to < d_from then
    raise exception 'The end date cannot be before the start date';
  end if;
  if d_to - d_from > 366 then
    raise exception 'Pick at most a year at a time';
  end if;
  t_from := d_from::timestamp at time zone 'Africa/Lagos';
  t_to   := (d_to + 1)::timestamp at time zone 'Africa/Lagos';

  return query
  with events as (
    -- Sign-ins, sign-outs, app opens, password and photo changes.
    select a.at, a.user_id, a.kind,
           case a.kind
             when 'sign_in' then 'Signed in'
             when 'sign_out' then case when a.detail ? 'reason' then 'Signed out (login expired)' else 'Signed out' end
             when 'app_open' then 'Opened the app'
             when 'password_changed' then 'Changed their password'
             when 'photo_changed' then 'Changed their profile photo'
           end as label,
           a.detail || case when a.app_build is not null then jsonb_build_object('app_build', a.app_build) else '{}'::jsonb end as detail,
           a.ip, a.platform,
           nullif(concat_ws(' on ',
             case when coalesce((a.device->>'app')::boolean, false) then 'Xtend app' else a.device->>'browser' end,
             a.device->>'os'), '') as device,
           a.user_agent
    from public.user_activity a
    where a.at >= t_from and a.at < t_to
      and (p_user is null or a.user_id = p_user)
      and (p_kinds is null or a.kind = any (p_kinds))

    union all
    -- Clocking in and out.
    select t.created_at,
           t.user_id,
           case when t.type = 'opening' then 'clock_in' else 'clock_out' end,
           case when t.type = 'opening' then 'Clocked in' else 'Clocked out' end
             || coalesce(' at ' || coalesce(o.name, t.place_name), ''),
           jsonb_strip_nulls(jsonb_build_object(
             'store', o.name, 'place', t.place_name, 'status', t.status,
             'distance_m', round(t.distance_m::numeric))),
           null::text,
           coalesce(t.device_info->'native'->>'platform', public.activity_platform(t.device_info->>'ua')),
           null::text,
           left(t.device_info->>'ua', 500)
    from public.attendance t
    left join public.outlets o on o.id = t.outlet_id
    where t.attendance_date between d_from - 1 and d_to + 1
      and t.created_at >= t_from and t.created_at < t_to
      and (p_user is null or t.user_id = p_user)
      and (p_kinds is null or (case when t.type = 'opening' then 'clock_in' else 'clock_out' end) = any (p_kinds))

    union all
    -- Checking in at a store.
    select coalesce(v.arrived_at, v.created_at), v.user_id, 'visit_in',
           'Checked in at ' || coalesce(o.name, v.arrived_place_name, 'a store'),
           jsonb_strip_nulls(jsonb_build_object('store', coalesce(o.name, v.arrived_place_name),
             'status', v.arrived_status, 'distance_m', round(v.arrived_distance_m::numeric))),
           null::text,
           coalesce(v.device_info->'native'->>'platform', public.activity_platform(v.device_info->>'ua')),
           null::text,
           left(v.device_info->>'ua', 500)
    from public.store_visits v
    left join public.outlets o on o.id = v.outlet_id
    where v.visit_date between d_from - 1 and d_to + 1
      and coalesce(v.arrived_at, v.created_at) >= t_from and coalesce(v.arrived_at, v.created_at) < t_to
      and (p_user is null or v.user_id = p_user)
      and (p_kinds is null or 'visit_in' = any (p_kinds))

    union all
    -- Checking out of it.
    select v.departed_at, v.user_id, 'visit_out',
           'Checked out of ' || coalesce(o.name, v.departed_place_name, v.arrived_place_name, 'a store'),
           jsonb_strip_nulls(jsonb_build_object('store', coalesce(o.name, v.departed_place_name, v.arrived_place_name),
             'status', v.departed_status,
             'minutes', round(extract(epoch from (v.departed_at - coalesce(v.arrived_at, v.created_at))) / 60))),
           null::text,
           coalesce(v.device_info->'native'->>'platform', public.activity_platform(v.device_info->>'ua')),
           null::text,
           left(v.device_info->>'ua', 500)
    from public.store_visits v
    left join public.outlets o on o.id = v.outlet_id
    where v.departed_at is not null
      and v.visit_date between d_from - 1 and d_to + 1
      and v.departed_at >= t_from and v.departed_at < t_to
      and (p_user is null or v.user_id = p_user)
      and (p_kinds is null or 'visit_out' = any (p_kinds))

    union all
    -- The daily report.
    select r.created_at, r.user_id, 'report', 'Filed the daily report',
           jsonb_strip_nulls(jsonb_build_object('date', r.report_date, 'store', o.name,
             'visits', jsonb_array_length(coalesce(r.store_visits, '[]'::jsonb)))),
           null::text, null::text, null::text, null::text
    from public.reports r
    left join public.outlets o on o.id = r.outlet_id
    where r.report_date between d_from - 1 and d_to + 1
      and r.created_at >= t_from and r.created_at < t_to
      and (p_user is null or r.user_id = p_user)
      and (p_kinds is null or 'report' = any (p_kinds))

    union all
    -- A stock count: one per person, store and day, however many products.
    select min(c.created_at), c.user_id, 'stock_count',
           'Submitted a stock count' || coalesce(' at ' || min(o.name), ''),
           jsonb_strip_nulls(jsonb_build_object('store', min(o.name), 'date', c.count_date, 'products', count(*))),
           null::text, null::text, null::text, null::text
    from public.store_counts c
    left join public.outlets o on o.id = c.outlet_id
    where c.count_date between d_from - 1 and d_to + 1
      and (p_user is null or c.user_id = p_user)
      and (p_kinds is null or 'stock_count' = any (p_kinds))
    group by c.user_id, c.outlet_id, c.count_date
    having min(c.created_at) >= t_from and min(c.created_at) < t_to

    union all
    -- X Metrics batch counts.
    select x.created_at, x.user_id, 'xm_count',
           'Submitted an X Metrics count' || coalesce(' at ' || o.name, '')
             || case when x.voided_at is not null then ' (voided)' else '' end,
           jsonb_strip_nulls(jsonb_build_object('store', o.name, 'date', x.count_date,
             'opening', case when x.is_opening then true end,
             'voided', case when x.voided_at is not null then true end)),
           null::text, null::text, null::text, null::text
    from public.xm_counts x
    left join public.outlets o on o.id = x.outlet_id
    where x.count_date between d_from - 1 and d_to + 1
      and x.created_at >= t_from and x.created_at < t_to
      and (p_user is null or x.user_id = p_user)
      and (p_kinds is null or 'xm_count' = any (p_kinds))

    union all
    -- X Metrics daily sales.
    select s.created_at, s.user_id, 'xm_sales',
           'Logged the day''s sales' || coalesce(' at ' || o.name, '')
             || case when s.voided_at is not null then ' (voided)' else '' end,
           jsonb_strip_nulls(jsonb_build_object('store', o.name, 'date', s.sale_date,
             'voided', case when s.voided_at is not null then true end)),
           null::text, null::text, null::text, null::text
    from public.xm_sales s
    left join public.outlets o on o.id = s.outlet_id
    where s.sale_date between d_from - 1 and d_to + 1
      and s.created_at >= t_from and s.created_at < t_to
      and (p_user is null or s.user_id = p_user)
      and (p_kinds is null or 'xm_sales' = any (p_kinds))

    union all
    -- Asking for leave.
    select l.created_at, l.user_id, 'leave_applied', 'Asked for leave',
           jsonb_build_object('type', l.kind, 'from', l.from_date, 'to', l.to_date),
           null::text, null::text, null::text, null::text
    from public.leave_requests l
    where l.created_at >= t_from and l.created_at < t_to
      and (p_user is null or l.user_id = p_user)
      and (p_kinds is null or 'leave_applied' = any (p_kinds))

    union all
    -- Withdrawing it.
    select l.cancelled_at, l.user_id, 'leave_cancelled', 'Cancelled a leave request',
           jsonb_build_object('type', l.kind, 'from', l.from_date, 'to', l.to_date),
           null::text, null::text, null::text, null::text
    from public.leave_requests l
    where l.cancelled_at is not null
      and l.cancelled_at >= t_from and l.cancelled_at < t_to
      and (p_user is null or l.user_id = p_user)
      and (p_kinds is null or 'leave_cancelled' = any (p_kinds))

    union all
    -- Support messages the person wrote (not the office's replies).
    select m.created_at, m.sender_id, 'support_message', 'Sent a support message',
           jsonb_build_object('subject', th.subject),
           null::text, null::text, null::text, null::text
    from public.support_messages m
    join public.support_threads th on th.id = m.thread_id
    where m.sender_role = 'staff'
      and m.sender_id is not null
      and m.created_at >= t_from and m.created_at < t_to
      and (p_user is null or m.sender_id = p_user)
      and (p_kinds is null or 'support_message' = any (p_kinds))
  )
  select e.at, e.user_id, p.full_name, p.role::text, e.kind, e.label, e.detail,
         e.ip, e.platform, e.device, e.user_agent
  from events e
  join public.profiles p on p.id = e.user_id
  order by e.at desc
  limit lim;
end;
$$;
revoke all on function public.activity_feed(date, date, uuid, text[], integer) from public, anon;
grant execute on function public.activity_feed(date, date, uuid, text[], integer) to authenticated;

-- Activity is kept for 180 days. Called by the nightly job.
create or replace function public.purge_user_activity(p_days integer default 180)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  gone integer;
begin
  delete from public.user_activity where at < now() - make_interval(days => greatest(coalesce(p_days, 180), 30));
  get diagnostics gone = row_count;
  return gone;
end;
$$;
revoke all on function public.purge_user_activity(integer) from public, anon, authenticated;
grant execute on function public.purge_user_activity(integer) to service_role;

select 'user activity (0062) installed' as result;
