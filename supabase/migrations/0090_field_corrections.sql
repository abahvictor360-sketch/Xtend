-- =====================================================================
-- XTEND migration 0090 — the office fixes a clock-in, clock-out or visit
--
-- When the phone could not clock someone in or out, or a capture went
-- wrong, an admin, HR (field staff) or the person's supervisor can:
--
--   * RECORD IT FOR THEM (office_record_clock, office_record_visit): a
--     clock-in or clock-out at one of the person's stores, at a time today
--     they choose (not in the future), or a store check-in or check-out.
--     It is recorded as the person, at the store's position, with no
--     selfie, marked device_info.source = 'office' with who and why. Only
--     the phone-evidence rules are skipped for it (notifications on,
--     selfie, phone clock, integrity flags, learned places, place naming);
--     who, where, the store, punctuality and alerts work as always.
--   * ASK THEM TO DO IT AGAIN (office_request_redo): a clock-in or
--     clock-out: Home shows the button again and their next capture
--     replaces the old record; a store check-in: the visit is abandoned so
--     they check in again; a store check-out: the visit is opened again so
--     they check out again.
--
-- Nothing is lost: field_corrections keeps every one, with the old record
-- as it was, who asked, why and when it was done. A replaced clock record
-- hands its movement trail (location_pings) to the new one.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.field_corrections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  action         text not null check (action in (
                   'office_clock_in', 'office_clock_out', 'office_check_in', 'office_check_out',
                   'redo_clock_in', 'redo_clock_out', 'redo_check_in', 'redo_check_out')),
  reason         text not null check (length(btrim(reason)) between 3 and 500),
  requested_by   uuid references public.profiles(id) on delete set null,
  correction_date date not null default public.business_date(),
  status         text not null default 'open' check (status in ('open', 'done')),
  record_id      uuid,
  old_record     jsonb,
  ping_ids       uuid[] not null default '{}',
  new_record_id  uuid,
  created_at     timestamptz not null default now(),
  done_at        timestamptz
);

create index if not exists field_corrections_by_user on public.field_corrections (user_id, correction_date desc);
create unique index if not exists field_corrections_one_open
  on public.field_corrections (user_id, correction_date, action) where status = 'open';

alter table public.field_corrections enable row level security;
revoke all on public.field_corrections from anon, authenticated;
grant select on public.field_corrections to authenticated;

drop policy if exists field_corrections_read on public.field_corrections;
create policy field_corrections_read on public.field_corrections
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or public.is_hr()
    or public.supervises_user(user_id)
  );

-- ---------------------------------------------------------------------
-- Who may fix whose day: an active merchandiser or marketer, by an admin,
-- HR, or their own supervisor.
-- ---------------------------------------------------------------------
create or replace function public.may_correct_field(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and p.is_active and p.role in ('merchandiser', 'marketer')
  ) and (public.is_admin() or public.is_hr() or public.supervises_user(p_user));
$$;

revoke all on function public.may_correct_field(uuid) from public, anon;
grant execute on function public.may_correct_field(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- An office entry skips only the phone-evidence rules. The flag is a
-- transaction setting only these functions set; nobody can set it from
-- outside (PostgREST passes request.* settings only).
-- ---------------------------------------------------------------------
create or replace function public.office_entry_on()
returns boolean
language sql stable as $$
  select coalesce(current_setting('xtend.office_entry', true), '') <> '';
$$;

drop trigger if exists trg_attendance_push_check on public.attendance;
create trigger trg_attendance_push_check before insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.attendance_push_check();
drop trigger if exists trg_attendance_selfie_check on public.attendance;
create trigger trg_attendance_selfie_check before insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.selfie_check();
drop trigger if exists trg_attendance_timing on public.attendance;
create trigger trg_attendance_timing before insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.attendance_timing();
drop trigger if exists trg_attendance_timing_flag on public.attendance;
create trigger trg_attendance_timing_flag after insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.attendance_timing_flag();
drop trigger if exists trg_attendance_integrity on public.attendance;
create trigger trg_attendance_integrity after insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.attendance_integrity();
drop trigger if exists trg_attendance_learn_waiting_store on public.attendance;
create trigger trg_attendance_learn_waiting_store after insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.attendance_learn_waiting_store();
drop trigger if exists trg_attendance_zz_place_due on public.attendance;
create trigger trg_attendance_zz_place_due after insert on public.attendance
  for each row when (not public.office_entry_on()) execute function public.attendance_place_due();
drop trigger if exists trg_store_visit_selfie_check on public.store_visits;
create trigger trg_store_visit_selfie_check before insert on public.store_visits
  for each row when (not public.office_entry_on()) execute function public.selfie_check();
drop trigger if exists trg_store_visits_place_due_guard on public.store_visits;
create trigger trg_store_visits_place_due_guard before insert on public.store_visits
  for each row when (not public.office_entry_on()) execute function public.place_due_guard();
drop trigger if exists trg_store_visits_zz_place_due on public.store_visits;
create trigger trg_store_visits_zz_place_due after insert on public.store_visits
  for each row when (not public.office_entry_on()) execute function public.visit_place_due();

-- An office clock record: the time they chose (attendance_enforce sets
-- now(); this runs after it, by name).
create or replace function public.attendance_office_time()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.office_entry_on() then
    new.created_at := least(new.client_captured_at, now());
  end if;
  return new;
end;
$$;

revoke all on function public.attendance_office_time() from public, anon, authenticated;

drop trigger if exists trg_attendance_zy_office_time on public.attendance;
create trigger trg_attendance_zy_office_time before insert on public.attendance
  for each row execute function public.attendance_office_time();

-- ---------------------------------------------------------------------
-- Replacing a clock record. When a correction is open for this person,
-- day and kind, the old record is set aside (kept in the correction) just
-- before the new one goes in; its movement trail moves to the new one.
-- ---------------------------------------------------------------------
create or replace function public.attendance_replace_for_correction()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  req public.field_corrections;
  old public.attendance;
  pings uuid[];
begin
  select * into req from public.field_corrections c
  where c.user_id = new.user_id and c.status = 'open'
    and c.correction_date = new.attendance_date
    and c.action = any(case new.type
                         when 'opening' then array['redo_clock_in', 'office_clock_in']
                         else array['redo_clock_out', 'office_clock_out'] end)
  order by c.created_at desc
  limit 1;
  if not found then
    return new;
  end if;

  select * into old from public.attendance a
  where a.user_id = new.user_id and a.attendance_date = new.attendance_date and a.type = new.type;
  if found then
    select coalesce(array_agg(p.id), '{}') into pings from public.location_pings p where p.attendance_id = old.id;
    update public.location_pings set attendance_id = null where attendance_id = old.id;
    delete from public.attendance where id = old.id;
    update public.field_corrections
       set old_record = coalesce(old_record, to_jsonb(old)), record_id = coalesce(record_id, old.id), ping_ids = pings
     where id = req.id;
    new.device_info := coalesce(new.device_info, '{}'::jsonb) || jsonb_build_object('replaces', old.id);
  end if;
  perform set_config('xtend.correction', req.id::text, true);
  return new;
end;
$$;

create or replace function public.attendance_correction_done()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  cid uuid := nullif(current_setting('xtend.correction', true), '')::uuid;
  c public.field_corrections;
begin
  if cid is null then
    return null;
  end if;
  perform set_config('xtend.correction', '', true);
  select * into c from public.field_corrections where id = cid and user_id = new.user_id and status = 'open';
  if not found then
    return null;
  end if;
  update public.location_pings set attendance_id = new.id where id = any(c.ping_ids);
  update public.field_corrections set status = 'done', done_at = now(), new_record_id = new.id where id = cid;
  return null;
end;
$$;

revoke all on function public.attendance_replace_for_correction() from public, anon, authenticated;
revoke all on function public.attendance_correction_done() from public, anon, authenticated;

drop trigger if exists trg_attendance_zz_correction on public.attendance;
create trigger trg_attendance_zz_correction before insert on public.attendance
  for each row execute function public.attendance_replace_for_correction();
drop trigger if exists trg_attendance_zz_correction_done on public.attendance;
create trigger trg_attendance_zz_correction_done after insert on public.attendance
  for each row execute function public.attendance_correction_done();

-- ---------------------------------------------------------------------
-- Acting as the person for one office entry, then back to the caller.
-- ---------------------------------------------------------------------
create or replace function public.office_act_as(p_user uuid, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('xtend.office_caller_claims', coalesce(current_setting('request.jwt.claims', true), ''), true);
  perform set_config('xtend.office_caller_sub', coalesce(current_setting('request.jwt.claim.sub', true), ''), true);
  perform set_config('xtend.office_entry', p_actor::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end;
$$;

create or replace function public.office_act_done()
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claims', current_setting('xtend.office_caller_claims', true), true);
  perform set_config('request.jwt.claim.sub', current_setting('xtend.office_caller_sub', true), true);
  perform set_config('xtend.office_entry', '', true);
end;
$$;

revoke all on function public.office_act_as(uuid, uuid) from public, anon, authenticated;
revoke all on function public.office_act_done() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Recording a clock-in or clock-out for someone.
-- ---------------------------------------------------------------------
create or replace function public.office_record_clock(
  p_user uuid, p_type attendance_type, p_outlet uuid, p_at timestamptz, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  o record;
  at_time timestamptz := coalesce(p_at, now());
  opening timestamptz;
  new_id uuid;
begin
  if actor is null or not public.may_correct_field(p_user) then
    raise exception 'You can only fix the day of active field staff you look after';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, so the record explains itself';
  end if;
  if at_time > now() + interval '1 minute' then
    raise exception 'The time cannot be in the future';
  end if;
  if (at_time at time zone 'Africa/Lagos')::date <> public.business_date() then
    raise exception 'Only today can be fixed';
  end if;

  select x.id, x.name, x.address, x.lat, x.lng into o
  from public.outlets x
  where x.id = p_outlet and x.is_active
    and x.id in (select f.outlet_id from public.outlets_for_user(p_user) f);
  if not found then
    raise exception 'Pick one of their stores';
  end if;
  if o.lat is null or o.lng is null then
    raise exception 'That store has no location yet';
  end if;

  if p_type = 'closing' then
    select a.created_at into opening from public.attendance a
    where a.user_id = p_user and a.attendance_date = public.business_date() and a.type = 'opening';
    if opening is null then
      raise exception 'They have not clocked in today. Clock them in first';
    end if;
    if at_time < opening then
      raise exception 'The clock-out cannot be before they clocked in';
    end if;
  end if;

  -- Any record already there is replaced, and kept in the correction.
  insert into public.field_corrections (user_id, action, reason, requested_by)
  values (p_user, case p_type when 'opening' then 'office_clock_in' else 'office_clock_out' end,
          btrim(p_reason), actor)
  on conflict (user_id, correction_date, action) where status = 'open'
  do update set reason = excluded.reason, requested_by = excluded.requested_by, created_at = now();
  -- An open request to redo it themselves is overtaken by this.
  update public.field_corrections set status = 'done', done_at = now()
  where user_id = p_user and status = 'open' and correction_date = public.business_date()
    and action = case p_type when 'opening' then 'redo_clock_in' else 'redo_clock_out' end;

  perform public.office_act_as(p_user, actor);
  insert into public.attendance (type, lat, lng, accuracy_m, address, place_name, place_source,
                                 selfie_path, device_info, client_captured_at)
  values (p_type, o.lat, o.lng, 5, o.address, o.name, 'office', '',
          jsonb_build_object('source', 'office', 'recorded_by', actor, 'reason', btrim(p_reason)),
          at_time)
  returning id into new_id;
  perform public.office_act_done();
  return new_id;
end;
$$;

revoke all on function public.office_record_clock(uuid, attendance_type, uuid, timestamptz, text) from public, anon;
grant execute on function public.office_record_clock(uuid, attendance_type, uuid, timestamptz, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Recording a store check-in or check-out for someone.
-- ---------------------------------------------------------------------
create or replace function public.office_record_visit(
  p_user uuid, p_action text, p_outlet uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  o record;
  v record;
  new_id uuid;
begin
  if actor is null or not public.may_correct_field(p_user) then
    raise exception 'You can only fix the day of active field staff you look after';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, so the record explains itself';
  end if;
  if p_action not in ('check_in', 'check_out') then
    raise exception 'Unknown action';
  end if;

  if p_action = 'check_in' then
    if not exists (select 1 from public.attendance a where a.user_id = p_user
                   and a.attendance_date = public.business_date() and a.type = 'opening') then
      raise exception 'They have not clocked in today. Clock them in first';
    end if;
    if exists (select 1 from public.attendance a where a.user_id = p_user
               and a.attendance_date = public.business_date() and a.type = 'closing') then
      raise exception 'They have clocked out for today';
    end if;
    if exists (select 1 from public.store_visits s where s.user_id = p_user and s.status = 'open'
               and s.visit_date = public.business_date()) then
      raise exception 'They are still checked in at a store. Check them out first';
    end if;
    select x.id, x.name, x.address, x.lat, x.lng into o
    from public.outlets x
    where x.id = p_outlet and x.is_active
      and x.id in (select f.outlet_id from public.outlets_for_user(p_user) f);
    if not found then
      raise exception 'Pick one of their stores';
    end if;
    if o.lat is null or o.lng is null then
      raise exception 'That store has no location yet';
    end if;

    perform public.office_act_as(p_user, actor);
    insert into public.store_visits (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m,
                                     arrived_address, arrived_place_name, device_info, client_captured_at)
    values (o.id, o.lat, o.lng, 5, o.address, o.name,
            jsonb_build_object('source', 'office', 'recorded_by', actor, 'reason', btrim(p_reason)), now())
    returning id into new_id;
    perform public.office_act_done();

    insert into public.field_corrections (user_id, action, reason, requested_by, status, done_at, new_record_id)
    values (p_user, 'office_check_in', btrim(p_reason), actor, 'done', now(), new_id);
    return new_id;
  end if;

  select s.id, s.outlet_id, s.arrived_lat, s.arrived_lng, s.arrived_address, s.arrived_place_name into v
  from public.store_visits s
  where s.user_id = p_user and s.status = 'open'
  order by s.arrived_at desc limit 1;
  if not found then
    raise exception 'They are not checked in at any store';
  end if;
  select x.lat, x.lng, x.name, x.address into o from public.outlets x where x.id = v.outlet_id;

  perform public.office_act_as(p_user, actor);
  perform public.end_store_visit(v.id, coalesce(o.lat, v.arrived_lat), coalesce(o.lng, v.arrived_lng), 5,
                                 coalesce(o.name, v.arrived_place_name), coalesce(o.address, v.arrived_address));
  perform public.office_act_done();

  insert into public.field_corrections (user_id, action, reason, requested_by, status, done_at, record_id, new_record_id)
  values (p_user, 'office_check_out', btrim(p_reason), actor, 'done', now(), v.id, v.id);
  return v.id;
end;
$$;

revoke all on function public.office_record_visit(uuid, text, uuid, text) from public, anon;
grant execute on function public.office_record_visit(uuid, text, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Asking someone to do it again.
-- ---------------------------------------------------------------------
create or replace function public.office_request_redo(
  p_user uuid, p_action text, p_reason text, p_visit uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  a public.attendance;
  v public.store_visits;
  new_id uuid;
begin
  if actor is null or not public.may_correct_field(p_user) then
    raise exception 'You can only fix the day of active field staff you look after';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, so they know what to do';
  end if;

  if p_action in ('redo_clock_in', 'redo_clock_out') then
    select * into a from public.attendance x
    where x.user_id = p_user and x.attendance_date = public.business_date()
      and x.type = case p_action when 'redo_clock_in' then 'opening'::attendance_type else 'closing'::attendance_type end;
    if not found then
      raise exception 'There is nothing to redo today: they have not done that yet';
    end if;
    if p_action = 'redo_clock_in' and exists (
         select 1 from public.attendance x where x.user_id = p_user
           and x.attendance_date = public.business_date() and x.type = 'closing') then
      raise exception 'They have already clocked out today: clock them in yourself instead';
    end if;
    insert into public.field_corrections (user_id, action, reason, requested_by, record_id, old_record)
    values (p_user, p_action, btrim(p_reason), actor, a.id, to_jsonb(a))
    on conflict (user_id, correction_date, action) where status = 'open'
    do update set reason = excluded.reason, requested_by = excluded.requested_by, created_at = now()
    returning id into new_id;
    return new_id;
  end if;

  if p_action not in ('redo_check_in', 'redo_check_out') then
    raise exception 'Unknown action';
  end if;
  select * into v from public.store_visits s
  where s.id = p_visit and s.user_id = p_user and s.visit_date = public.business_date();
  if not found then
    raise exception 'Pick one of their store visits from today';
  end if;

  if p_action = 'redo_check_in' then
    -- The visit stays in the record as abandoned; they check in again.
    update public.store_visits set status = 'abandoned' where id = v.id;
  else
    if v.status <> 'closed' then
      raise exception 'They have not checked out of that store yet';
    end if;
    if exists (select 1 from public.store_visits s where s.user_id = p_user and s.status = 'open') then
      raise exception 'They are checked in at another store. Check them out of it first';
    end if;
    -- Open again, so they check out once more.
    update public.store_visits
       set status = 'open', departed_at = null, departed_lat = null, departed_lng = null,
           departed_distance_m = null, departed_status = null
     where id = v.id;
  end if;

  insert into public.field_corrections (user_id, action, reason, requested_by, status, done_at, record_id, old_record)
  values (p_user, p_action, btrim(p_reason), actor, 'done', now(), v.id, to_jsonb(v))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.office_request_redo(uuid, text, text, uuid) from public, anon;
grant execute on function public.office_request_redo(uuid, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The person's day: a record they were asked to redo shows as not done,
-- so Home offers the button again; and what the office asked, and why.
-- ---------------------------------------------------------------------
create or replace function public.my_day()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'date', public.business_date(),
    'can_file_report', public.can_file_report(),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'role', p.role,
        'must_change_password', p.must_change_password, 'is_active', p.is_active
      ) from public.profiles p where p.id = auth.uid()
    ),
    'outlet', (
      select jsonb_build_object(
        'id', o.id, 'name', o.name, 'address', o.address,
        'lat', o.lat, 'lng', o.lng, 'radius_m', o.geofence_radius_m,
        'shift_start', o.shift_start, 'shift_end', o.shift_end
      )
      from public.outlets o
      join public.profiles p on p.outlet_id = o.id
      where p.id = auth.uid()
    ),
    'opening', (
      select jsonb_build_object('id', a.id, 'at', a.created_at, 'status', a.status,
                                'distance_m', a.distance_m, 'address', a.address)
      from public.attendance a
      where a.user_id = auth.uid() and a.attendance_date = public.business_date()
        and a.type = 'opening'
        and not exists (select 1 from public.field_corrections c where c.user_id = auth.uid()
                        and c.status = 'open' and c.action = 'redo_clock_in'
                        and c.correction_date = public.business_date())
    ),
    'closing', (
      select jsonb_build_object('id', a.id, 'at', a.created_at, 'status', a.status,
                                'distance_m', a.distance_m, 'address', a.address)
      from public.attendance a
      where a.user_id = auth.uid() and a.attendance_date = public.business_date()
        and a.type = 'closing'
        and not exists (select 1 from public.field_corrections c where c.user_id = auth.uid()
                        and c.status = 'open' and c.action = 'redo_clock_out'
                        and c.correction_date = public.business_date())
    ),
    'report_filed', exists (
      select 1 from public.reports r
      where r.user_id = auth.uid() and r.report_date = public.business_date()
    ),
    'redo', coalesce((
      select jsonb_agg(jsonb_build_object('action', c.action, 'reason', c.reason, 'at', c.created_at)
                       order by c.created_at)
      from public.field_corrections c
      where c.user_id = auth.uid() and c.status = 'open' and c.action like 'redo_%'
        and c.correction_date = public.business_date()
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Test-mode reset (0066): corrections go with clock-ins.
-- ---------------------------------------------------------------------
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

select 'The office fixes a clock-in, clock-out or visit (0090) installed' as result;
