-- =====================================================================
-- XTEND migration 0099 — "Check out of the store before you leave"
--
-- Marketers check in at each store they visit and should check out before
-- they leave it. While someone is checked in at a store, Xtend now reminds
-- them every visit_reminder_minutes() (25) minutes: "Still at Justrite
-- Ogba? Check out of the store before you leave." The five-minute alerts
-- job (/api/cron/alerts) sends them as notifications on the phone.
--
--   * visit_checkout_reminders: one row per open visit, how many reminders
--     went and when the last one did (no policies: only the server reads it);
--   * claim_visit_checkout_reminders(now): hands over each reminder that is
--     due exactly once (concurrent runs never send one twice): a visit
--     checked in today, still open, of an active person who has not clocked
--     out, the first after 25 minutes in the store, then every 25 minutes,
--     at most visit_reminder_max() (16, about seven hours) per visit.
--
-- Rerunnable.
-- =====================================================================

create or replace function public.visit_reminder_minutes()
returns integer language sql immutable as $$ select 25 $$;

create or replace function public.visit_reminder_max()
returns integer language sql immutable as $$ select 16 $$;

grant execute on function public.visit_reminder_minutes() to authenticated, service_role;
grant execute on function public.visit_reminder_max() to authenticated, service_role;

create table if not exists public.visit_checkout_reminders (
  visit_id uuid primary key references public.store_visits(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  sent integer not null default 0,
  last_sent_at timestamptz not null default now()
);

alter table public.visit_checkout_reminders enable row level security;
revoke all on public.visit_checkout_reminders from anon, authenticated;

create or replace function public.claim_visit_checkout_reminders(p_now timestamptz default now())
returns table (user_id uuid, visit_id uuid, store text, since text, reminder integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  at_now timestamptz := coalesce(p_now, now());
  today date := (at_now at time zone 'Africa/Lagos')::date;
  gap interval := make_interval(mins => public.visit_reminder_minutes());
begin
  return query
    with due as (
      select v.id as vid, v.user_id as uid, v.arrived_at
      from public.store_visits v
      join public.profiles p on p.id = v.user_id and p.is_active
      left join public.visit_checkout_reminders r on r.visit_id = v.id
      where v.status = 'open'
        and v.departed_at is null
        and v.visit_date = today
        and v.arrived_at <= at_now - gap
        and not exists (select 1 from public.attendance a
                        where a.user_id = v.user_id and a.attendance_date = today and a.type = 'closing')
        and (r.visit_id is null or (r.last_sent_at <= at_now - gap and r.sent < public.visit_reminder_max()))
    ),
    claimed as (
      insert into public.visit_checkout_reminders as r (visit_id, user_id, sent, last_sent_at)
      select d.vid, d.uid, 1, at_now from due d
      on conflict on constraint visit_checkout_reminders_pkey do update
        set sent = r.sent + 1, last_sent_at = excluded.last_sent_at
        where r.last_sent_at <= at_now - gap and r.sent < public.visit_reminder_max()
      returning r.visit_id, r.user_id, r.sent
    )
    select c.user_id, c.visit_id,
           coalesce(d.store_label, d.outlet_name, 'the store'),
           to_char(d.arrived_at at time zone 'Africa/Lagos', 'HH24:MI'),
           c.sent
    from claimed c
    join public.store_visit_detail d on d.id = c.visit_id;
end;
$$;

revoke all on function public.claim_visit_checkout_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_visit_checkout_reminders(timestamptz) to service_role;

-- The test-run reset clears the reminders with the store visits.
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
    'visits_places:visit_checkout_reminders', 'visits_places:store_visits', 'clock_ins:follow_sessions',
    'clock_ins:location_alerts',
    'clock_ins:location_pings', 'clock_ins:excuse_checks', 'clock_ins:phone_checks',
    'clock_ins:photo_checks', 'clock_ins:device_beacons', 'clock_ins:clock_out_reminders',
    'clock_ins:tracking_tokens', 'clock_ins:integrity_flags', 'clock_ins:field_corrections',
    'clock_ins:attendance',
    'leave_schedules:leave_requests', 'leave_schedules:schedule_overrides',
    'leave_schedules:work_patterns', 'support:message_reads', 'support:messages',
    'support:message_threads', 'support:support_messages', 'support:support_threads',
    'notifications:app_update_notices', 'notifications:notification_deliveries', 'notifications:scheduled_notifications',
    'notifications:notifications', 'activity:user_activity', 'ask:assistant_conversations',
    'stores:xm_stores', 'stores:outlets', 'audit:audit_log'
  ]) with ordinality as v(x, n);
$$;

select 'Store check-out reminders (0099) installed' as result;
