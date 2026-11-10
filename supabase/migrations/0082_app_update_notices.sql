-- 0082: tell everyone when a new phone app is out.
--
-- The site already shows "A new Xtend app is ready" inside the app, but
-- only to someone who opens it. Now the five-minute alerts job also sends a
-- phone notification to every active person whose Android or iPhone app is
-- older than the newest one (app_installs, 0057): once when the build comes
-- out, and again every two days while they stay on an older one, three
-- times in all per build. Updating stops it, since the app reports its
-- build each time it opens.

create table if not exists public.app_update_notices (
  user_id  uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios')),
  build    integer not null check (build >= 0),
  times    integer not null default 1 check (times between 1 and 10),
  first_at timestamptz not null default now(),
  last_at  timestamptz not null default now(),
  primary key (user_id, platform, build)
);
alter table public.app_update_notices enable row level security;
revoke all on public.app_update_notices from anon, authenticated;
grant select on public.app_update_notices to authenticated;

-- Admins see who was told; nobody writes but the job.
drop policy if exists app_update_notices_read on public.app_update_notices;
create policy app_update_notices_read on public.app_update_notices
  for select to authenticated using (public.is_admin());

-- Who to tell now, recorded as told. p_android / p_ios: the newest builds
-- (null: none published). Only phones seen in the last 30 days, and only
-- people still active.
create or replace function public.claim_app_update_notices(
  p_android integer,
  p_ios integer,
  p_max_times integer default 3,
  p_every interval default interval '2 days'
)
returns table (user_id uuid, platform text, build integer, times integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select i.user_id, i.platform,
           case i.platform when 'android' then p_android else p_ios end as latest
    from public.app_installs i
    join public.profiles p on p.id = i.user_id and p.is_active
    where i.app_build is not null
      and i.last_seen > now() - interval '30 days'
      and ((i.platform = 'android' and p_android is not null and i.app_build < p_android)
        or (i.platform = 'ios' and p_ios is not null and i.app_build < p_ios))
  ), told as (
    insert into public.app_update_notices as n (user_id, platform, build)
    select d.user_id, d.platform, d.latest from due d
    on conflict on constraint app_update_notices_pkey do update
      set times = n.times + 1, last_at = now()
      where n.times < greatest(p_max_times, 1) and n.last_at <= now() - p_every
    returning n.user_id, n.platform, n.build, n.times
  )
  select t.user_id, t.platform, t.build, t.times from told t;
end;
$$;
revoke all on function public.claim_app_update_notices(integer, integer, integer, interval) from public, anon, authenticated;
grant execute on function public.claim_app_update_notices(integer, integer, integer, interval) to service_role;

-- A test-run reset clears these with the other notifications.
create or replace function public.reset_category_tables()
returns table (category text, table_name text, step integer)
language sql immutable as $$
  select split_part(v.x, ':', 1), split_part(v.x, ':', 2), v.n::integer
  from unnest(array[
    'teams:staff_outlets', 'xm:xm_reconciliations', 'xm:xm_expiry_alerts', 'xm:xm_count_lines',
    'xm:xm_counts', 'xm:xm_sale_lines', 'xm:xm_sales', 'xm:xm_policy_reads',
    'xm:xm_monthly_grades', 'xm:xm_targets', 'xm:xm_supplies', 'xm:xm_supply_imports',
    'stock_counts:store_count_sheets', 'stock_counts:store_counts',
    'stock_counts:count_request_targets', 'stock_counts:count_requests', 'reports:report_files',
    'reports:report_photos', 'reports:reports', 'visits_places:place_naming_due',
    'visits_places:store_visits', 'clock_ins:follow_sessions',
    'clock_ins:location_alerts',
    'clock_ins:location_pings', 'clock_ins:excuse_checks', 'clock_ins:phone_checks',
    'clock_ins:photo_checks', 'clock_ins:device_beacons', 'clock_ins:clock_out_reminders',
    'clock_ins:tracking_tokens', 'clock_ins:integrity_flags', 'clock_ins:attendance',
    'leave_schedules:leave_requests', 'leave_schedules:schedule_overrides',
    'leave_schedules:work_patterns', 'support:message_reads', 'support:messages',
    'support:message_threads', 'support:support_messages', 'support:support_threads',
    'notifications:app_update_notices', 'notifications:notification_deliveries', 'notifications:scheduled_notifications',
    'notifications:notifications', 'activity:user_activity', 'ask:assistant_conversations',
    'stores:xm_stores', 'stores:outlets', 'audit:audit_log'
  ]) with ordinality as v(x, n);
$$;
