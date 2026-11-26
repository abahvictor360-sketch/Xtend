-- =====================================================================
-- XTEND migration 0115 — Location turned off during a shift
--
-- A phone cannot be located with its location switched off, and the
-- tracker used to go quiet without saying why. Now the phone's tracker
-- notices the moment location is switched off during a shift, asks the
-- person to turn it back on, and tells the server:
--
--   * location_off_spells: each time it was off (from, to), with the last
--     position Xtend had before it went off. One open spell per person;
--   * record_location_state(token, off_since, on_at, sent_at): from the
--     tracker (service role, with the phone's tracking token, as 0050).
--     off_since set: a spell is open from then (never before the clock-in);
--     off_since null: an open spell ends at on_at (or now). The phone's
--     clock is corrected with sent_at;
--   * a clock-out ends any open spell;
--   * claim_location_off_alerts(): spells open for
--     system_settings.location_off_alert_minutes (default 15; 0 never)
--     while the person is still clocked in, marked as told: the alerts job
--     tells their supervisor and the admins;
--   * admins and the person's supervisor read the spells.
--
-- Rerunnable.
-- =====================================================================

alter table public.system_settings add column if not exists location_off_alert_minutes integer not null default 15;
alter table public.system_settings drop constraint if exists system_settings_location_off_alert_minutes_check;
alter table public.system_settings add constraint system_settings_location_off_alert_minutes_check
  check (location_off_alert_minutes between 0 and 600);
comment on column public.system_settings.location_off_alert_minutes is
  'Minutes a phone''s location may stay off during a shift before the supervisor is told (0115); 0 never.';

create table if not exists public.location_off_spells (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  last_lat        double precision,
  last_lng        double precision,
  last_accuracy_m double precision,
  last_fix_at     timestamptz,
  last_place      text,
  alerted_at      timestamptz,
  created_at      timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists location_off_spells_one_open on public.location_off_spells (user_id) where ended_at is null;
create index if not exists location_off_spells_by_person on public.location_off_spells (user_id, started_at desc);
alter table public.location_off_spells enable row level security;
revoke all on public.location_off_spells from anon, authenticated;
grant select on public.location_off_spells to authenticated;
drop policy if exists location_off_spells_read on public.location_off_spells;
create policy location_off_spells_read on public.location_off_spells
  for select to authenticated using (public.is_admin() or public.supervises_user(user_id));

-- From the phone's tracker. Returns {ok, open} (open: a spell is open now).
create or replace function public.record_location_state(
  p_token text, p_off_since timestamptz, p_on_at timestamptz, p_sent_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
  skew interval := coalesce(p_sent_at - now(), interval '0');
  opened timestamptz;
  closed timestamptz;
  since timestamptz;
  ended timestamptz;
  last record;
begin
  select * into t from public.tracking_tokens
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if t.id is null or not exists (select 1 from public.profiles where id = t.user_id and is_active) then
    return jsonb_build_object('ok', false);
  end if;

  select min(a.created_at) filter (where a.type = 'opening'), min(a.created_at) filter (where a.type = 'closing')
    into opened, closed
  from public.attendance a
  where a.user_id = t.user_id and a.attendance_date = public.business_date();

  if p_off_since is not null then
    since := least(p_off_since - skew, now());
    if opened is null or closed is not null then
      return jsonb_build_object('ok', true, 'open', false);
    end if;
    since := greatest(since, opened);
    if exists (select 1 from public.location_off_spells where user_id = t.user_id and ended_at is null) then
      return jsonb_build_object('ok', true, 'open', true);
    end if;
    -- The last position Xtend had before it went off.
    select p.lat, p.lng, p.accuracy_m, p.created_at, p.place_name into last
    from public.location_pings p
    where p.user_id = t.user_id and p.created_at <= since and p.created_at >= opened
    order by p.created_at desc limit 1;
    if last.lat is null then
      select a.lat, a.lng, a.accuracy_m, a.created_at, a.place_name into last
      from public.attendance a
      where a.user_id = t.user_id and a.attendance_date = public.business_date() and a.type = 'opening';
    end if;
    insert into public.location_off_spells (user_id, started_at, last_lat, last_lng, last_accuracy_m, last_fix_at, last_place)
    values (t.user_id, since, last.lat, last.lng, last.accuracy_m, last.created_at, last.place_name)
    on conflict do nothing;
    return jsonb_build_object('ok', true, 'open', true);
  end if;

  ended := least(coalesce(p_on_at - skew, now()), now());
  update public.location_off_spells
     set ended_at = greatest(ended, started_at)
   where user_id = t.user_id and ended_at is null;
  return jsonb_build_object('ok', true, 'open', false);
end;
$$;
revoke all on function public.record_location_state(text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.record_location_state(text, timestamptz, timestamptz, timestamptz) to service_role;

-- A clock-out ends an open spell.
create or replace function public.attendance_end_location_off()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'closing' then
    update public.location_off_spells
       set ended_at = greatest(new.created_at, started_at)
     where user_id = new.user_id and ended_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.attendance_end_location_off() from public, anon, authenticated;
drop trigger if exists trg_attendance_end_location_off on public.attendance;
create trigger trg_attendance_end_location_off
  after insert on public.attendance
  for each row execute function public.attendance_end_location_off();

-- For the alerts job: spells open long enough, the person still clocked in.
create or replace function public.claim_location_off_alerts()
returns table (spell_id uuid, user_id uuid, started_at timestamptz, last_lat double precision,
               last_lng double precision, last_place text, last_fix_at timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  minutes integer := coalesce((select s.location_off_alert_minutes from public.system_settings s where s.id), 15);
begin
  if minutes <= 0 then
    return;
  end if;
  return query
  update public.location_off_spells l
     set alerted_at = now()
   where l.ended_at is null
     and l.alerted_at is null
     and l.started_at <= now() - make_interval(mins => minutes)
     and exists (select 1 from public.attendance a
                 where a.user_id = l.user_id and a.attendance_date = public.business_date() and a.type = 'opening')
     and not exists (select 1 from public.attendance a
                     where a.user_id = l.user_id and a.attendance_date = public.business_date() and a.type = 'closing')
  returning l.id, l.user_id, l.started_at, l.last_lat, l.last_lng, l.last_place, l.last_fix_at;
end;
$$;
revoke all on function public.claim_location_off_alerts() from public, anon, authenticated;
grant execute on function public.claim_location_off_alerts() to service_role;

-- Admins change the minutes (0 never).
create or replace function public.set_location_off_alert_minutes(p_minutes integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change this';
  end if;
  if p_minutes is null or p_minutes < 0 or p_minutes > 600 then
    raise exception 'Give the minutes as a number from 0 to 600';
  end if;
  update public.system_settings set location_off_alert_minutes = p_minutes, updated_at = now() where id;
end;
$$;
revoke all on function public.set_location_off_alert_minutes(integer) from public, anon;
grant execute on function public.set_location_off_alert_minutes(integer) to authenticated;

-- A test-run reset clears the spells with the clock-ins.
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
    'clock_ins:location_off_spells', 'clock_ins:location_alerts',
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

select 'Location turned off (0115) installed' as result;
