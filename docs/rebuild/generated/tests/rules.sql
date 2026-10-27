-- =====================================================================
-- Behavioural tests for the server-side rules. Local harness only.
-- Run after the stub and both migrations. Any failure raises.
--
-- These exercise triggers and functions, not RLS: a superuser session
-- bypasses row level security, so policies are verified on the project
-- itself, not here.
-- =====================================================================
set client_min_messages = notice;

create or replace function assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAIL: %', label;
  end if;
  raise notice 'ok: %', label;
end;
$$;

create or replace function act_as(p uuid) returns void
language sql as $$ select set_config('request.jwt.claim.sub', p::text, false); $$;

-- Stands in for the app uploading a photo just now: the object exists in
-- the signed-in person's folder, so the photo checks (migration 022) pass.
create or replace function fresh_photo(p_bucket text, p_label text) returns text
language plpgsql as $$
declare path text := auth.uid()::text || '/' || gen_random_uuid()::text || '-' || p_label;
begin
  insert into storage.buckets (id, name) values (p_bucket, p_bucket) on conflict do nothing;
  insert into storage.objects (bucket_id, name) values (p_bucket, path);
  -- And the server looked at it and passed it (migration 023).
  insert into public.photo_checks (path, bucket, user_id, kind, verdict)
  values (path, p_bucket, auth.uid(), case p_bucket when 'selfies' then 'selfie' else 'shelf' end, 'pass');
  return path;
end;
$$;

-- The nightly job announced yesterday what goes tonight (0067): nothing
-- is deleted that was not announced at least 20 hours before.
create or replace function announced_yesterday() returns void
language sql as $$
  insert into public.job_runs (job, last_run_at, last_result)
  values ('retention_notice', now() - interval '1 day',
          jsonb_build_object('at', now() - interval '1 day',
                             'through', now() - interval '1 day' - make_interval(days => public.retention_days() - 1)))
  on conflict (job) do update set last_run_at = excluded.last_run_at, last_result = excluded.last_result;
$$;

-- Notifications switched on for someone, on a real push service (027).
create or replace function notifications_on(p uuid) returns void
language sql as $$
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (p, 'https://fcm.googleapis.com/fcm/send/' || gen_random_uuid(), 'k', 'a');
$$;

-- A photo of a shop front, checked and passed, for naming a place (025).
create or replace function place_photo(p_label text) returns text
language plpgsql as $$
declare taken text := fresh_photo('reports', p_label);
begin
  update public.photo_checks set kind = 'storefront' where path = taken;
  return taken;
end;
$$;

-- A store count taken standing in the store, with a shelf photo just taken.
create or replace function count_here(p_outlet uuid, p_lines jsonb) returns integer
language sql as $$
  select public.submit_store_count(p_outlet, p_lines, o.lat, o.lng, 12,
                                   fresh_photo('reports', 'shelf.jpg'))
  from public.outlets o where o.id = p_outlet;
$$;

-- How many rows each table the reset knows about holds (066).
create or replace function reset_counts() returns jsonb
language plpgsql as $$
declare t text; n bigint; out jsonb := '{}'::jsonb;
begin
  for t in select c.table_name from public.reset_category_tables() c
           union all select unnest(public.reset_staff_tables())
           union all select unnest(array['products', 'staff_roles', 'role_store_counts', 'count_sheet_templates',
                                         'notification_templates', 'support_quick_replies', 'xm_settings',
                                         'xm_settings_history', 'xm_policy_versions', 'app_releases', 'job_runs',
                                         'system_settings']) loop
    execute format('select count(*) from public.%I', t) into n;
    out := out || jsonb_build_object(t, n);
  end loop;
  return out;
end;
$$;

do $$
declare
  mall_id    uuid;
  kiosk_id   uuid;
  ada        uuid := gen_random_uuid();
  bala       uuid := gen_random_uuid();
  boss       uuid := gen_random_uuid();
  grace      uuid := gen_random_uuid();
  row_status attendance_status;
  row_dist   double precision;
  alert_count integer;
  attendance_id uuid;
  report_id  uuid;
  visit_id   uuid;
  payload    jsonb;
  tunde      uuid := gen_random_uuid();
  depot_id   uuid;
  alloc      integer;
  soap       uuid;
  cream      uuid;
  counted    integer;
  req        uuid;
  req2       uuid;
  used_path  text;
  flagged    integer;
  place_id   uuid;
  i          integer;
begin
  insert into auth.users (id, email) values
    (ada, 'ada@xpel.ng'), (bala, 'bala@xpel.ng'), (boss, 'boss@xpel.ng'),
    (grace, 'grace@xpel.ng');

  insert into public.outlets (name, lat, lng, geofence_radius_m, shift_start, shift_end)
  values ('Ikeja City Mall', 6.6018, 3.3515, 150, '08:00', '18:00')
  returning id into mall_id;

  insert into public.outlets (name, lat, lng, geofence_radius_m)
  values ('Wuse Kiosk', 9.0765, 7.3986, 40)
  returning id into kiosk_id;

  insert into public.profiles (id, full_name, email, role, outlet_id) values
    (ada,  'Ada Okafor', 'ada@xpel.ng',  'merchandiser', mall_id),
    (bala, 'Bala Yusuf', 'bala@xpel.ng', 'merchandiser', kiosk_id),
    (boss, 'Ngozi Eze',  'boss@xpel.ng', 'admin',        null),
    (grace,'Grace Nnadi','grace@xpel.ng','marketer',     mall_id);
  perform notifications_on(ada);
  perform notifications_on(bala);
  perform notifications_on(grace);
  -- Every day is a working day for these three, so the absence checks
  -- below pass whatever day of the week the tests run on (059).
  insert into public.work_patterns (user_id, days) values
    (ada, '{0,1,2,3,4,5,6}'), (bala, '{0,1,2,3,4,5,6}'), (grace, '{0,1,2,3,4,5,6}');

  -- ---------------------------------------------------------------
  -- The trigger owns distance and status.
  -- ---------------------------------------------------------------
  perform act_as(ada);

  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at,
                                 -- deliberately lying: the trigger must overwrite all of these
                                 user_id, distance_m, status, attendance_date)
  values ('opening', 6.6019, 3.3516, 12, fresh_photo('selfies', 'x-1.jpg'), now(),
          bala, 0, 'on_site', date '2000-01-01')
  returning id, status, distance_m into attendance_id, row_status, row_dist;

  perform assert(row_status = 'on_site', 'a fix inside the fence is on_site');
  perform assert(row_dist < 30, 'distance is computed from the outlet, not sent');
  perform assert(
    (select user_id from public.attendance where id = attendance_id) = ada,
    'user_id is taken from the session, not the payload');
  perform assert(
    (select attendance_date from public.attendance where id = attendance_id)
      = (now() at time zone 'Africa/Lagos')::date,
    'attendance_date is the Lagos business date, not the client value');
  perform assert(
    (select outlet_radius_m from public.attendance where id = attendance_id) = 150,
    'the outlet geofence is snapshotted onto the row');

  -- ---------------------------------------------------------------
  -- One opening per person per day.
  -- ---------------------------------------------------------------
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.6019, 3.3516, 12, fresh_photo('selfies', 'x-2.jpg'), now());
    perform assert(false, 'a second opening must be rejected');
  exception when unique_violation then
    perform assert(true, 'a second opening the same day is rejected');
  end;

  -- ---------------------------------------------------------------
  -- Off site clocking is recorded honestly and raises an alert.
  -- ---------------------------------------------------------------
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('closing', 6.6100, 3.3600, 15, fresh_photo('selfies', 'x-3.jpg'), now())
  returning status, distance_m into row_status, row_dist;

  perform assert(row_status = 'off_site', 'a fix outside the fence is off_site');
  perform assert(row_dist > 150, 'the off-site distance is real');
  perform assert(
    (select count(*) from public.location_alerts
     where user_id = ada and alert_type = 'off_site_clock') = 1,
    'an off-site clock raises exactly one alert');

  -- ---------------------------------------------------------------
  -- A rough fix is flagged, whatever the distance.
  -- ---------------------------------------------------------------
  perform act_as(bala);
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('opening', 9.0765, 7.3986, 400, fresh_photo('selfies', 'y-1.jpg'), now())
  returning status into row_status;
  perform assert(row_status = 'flagged', 'accuracy worse than 100 m is flagged even at the outlet');
  perform assert(
    (select count(*) from public.location_alerts
     where user_id = bala and alert_type = 'low_accuracy') = 1,
    'a rough fix raises a low_accuracy alert');

  -- ---------------------------------------------------------------
  -- Device clocks are untrusted.
  -- ---------------------------------------------------------------
  perform act_as(boss);
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.6, 3.35, 10, fresh_photo('selfies', 'z-1.jpg'), now() - interval '30 hours');
    perform assert(false, 'a stale capture must be rejected');
  exception when others then
    perform assert(sqlerrm like '%Invalid capture timestamp%', 'a capture older than 24h is rejected');
  end;

  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.6, 3.35, 10, fresh_photo('selfies', 'z-2.jpg'), now() + interval '10 minutes');
    perform assert(false, 'a future capture must be rejected');
  exception when others then
    perform assert(sqlerrm like '%Invalid capture timestamp%', 'a capture in the future is rejected');
  end;

  -- ---------------------------------------------------------------
  -- Heartbeat: distance is measured from the clock-in point.
  -- ---------------------------------------------------------------
  perform act_as(ada);
  insert into public.location_pings (lat, lng, accuracy_m) values (6.6019, 3.3517, 20);
  perform assert(
    (select distance_m from public.location_pings order by created_at desc limit 1) < 50,
    'a ping near the clock-in point is close');
  perform assert(
    (select count(*) from public.location_alerts
     where user_id = ada and alert_type = 'left_geofence') = 0,
    'a nearby ping raises no geofence alert');

  -- ~1.1 km away.
  insert into public.location_pings (lat, lng, accuracy_m) values (6.6120, 3.3516, 20);
  perform assert(
    (select count(*) from public.location_alerts
     where user_id = ada and alert_type = 'left_geofence') = 1,
    'a ping beyond 300 m raises a left_geofence alert');

  insert into public.location_pings (lat, lng, accuracy_m) values (6.6125, 3.3516, 20);
  perform assert(
    (select count(*) from public.location_alerts
     where user_id = ada and alert_type = 'left_geofence') = 1,
    'a second breach inside 30 minutes does not flood the queue');

  -- Every ping records the gap since the previous one, which is how a
  -- locked phone or a backgrounded app becomes visible (migration 004).
  -- Every ping but the first records the gap since the previous one. All the
  -- fixture rows share one transaction timestamp, so the gaps here are zero;
  -- what matters is that they are recorded rather than left null.
  perform assert(
    (select count(*) from public.location_pings where user_id = ada and gap_seconds is null) = 1,
    'only the first ping of the day has no gap');
  perform assert(
    (select count(*) from public.location_pings where user_id = ada and gap_seconds is not null) = 2,
    'later pings record the gap since the previous one');

  payload := public.tracking_coverage(ada, public.business_date());
  perform assert((payload ->> 'ping_count')::int = 3, 'coverage counts the shift''s pings');
  perform assert((payload ->> 'last_ping_at') is not null, 'coverage reports the last ping');
  -- One uncapped first ping contributes the 6-minute cap, the two zero-gap
  -- pings contribute nothing.
  perform assert((payload ->> 'tracked_seconds')::int = 360, 'a ping covers at most six minutes');

  -- ---------------------------------------------------------------
  -- The location gate logs blocks, and throttles them.
  -- ---------------------------------------------------------------
  perform public.log_location_block('permission_denied', null);
  perform public.log_location_block('permission_denied', null);
  select count(*) into alert_count from public.location_alerts
   where user_id = ada and alert_type = 'permission_denied';
  perform assert(alert_count = 1, 'repeated permission denials collapse into one alert');

  -- ---------------------------------------------------------------
  -- Reports: one per day, server-stamped, same-day edits only.
  -- ---------------------------------------------------------------
  -- A merchandiser must not be able to file a report (migration 005).
  begin
    insert into public.reports (body) values ('merchandiser attempt');
    perform assert(false, 'a merchandiser must not file a report');
  exception when others then
    perform assert(sqlerrm like '%Only marketers%' or sqlerrm like '%row-level security%',
      'a merchandiser cannot file the daily report');
  end;

  -- The marketer files it instead.
  perform act_as(grace);
  insert into public.reports (body, sales_summary, stock_status, user_id, report_date)
  values ('Busy morning', 'Twelve tubs sold', 'Shampoo running low', bala, date '2001-01-01')
  returning id into report_id;

  perform assert(
    (select user_id from public.reports where id = report_id) = grace,
    'a report belongs to the session user');
  perform assert(
    (select report_date from public.reports where id = report_id) = (now() at time zone 'Africa/Lagos')::date,
    'report_date is server-set');
  perform assert(
    (select r.outlet_id from public.reports r where r.id = report_id) = mall_id,
    'the outlet is snapshotted onto the report');
  perform assert(public.can_file_report(), 'a marketer can file reports');
  perform assert(public.is_field_role('marketer'), 'a marketer is field staff');

  update public.reports set body = 'Busy afternoon' where id = report_id;
  perform assert(
    (select body from public.reports where id = report_id) = 'Busy afternoon',
    'a same-day report can be edited');

  insert into public.report_photos (report_id, storage_path)
  select report_id, format('ada/%s.jpg', g) from generate_series(1, 5) g;
  begin
    insert into public.report_photos (report_id, storage_path) values (report_id, 'ada/6.jpg');
    perform assert(false, 'a sixth photo must be rejected');
  exception when others then
    perform assert(sqlerrm like '%at most 5 photos%', 'a report carries at most five photos');
  end;

  -- Backdate the row to prove the edit window closes. The trigger refuses to
  -- move report_date itself, which is the point, so it is stood down for the
  -- one statement that fakes yesterday.
  alter table public.reports disable trigger trg_report_enforce;
  update public.reports set report_date = report_date - 1 where id = report_id;
  alter table public.reports enable trigger trg_report_enforce;
  begin
    update public.reports set body = 'Late edit' where id = report_id;
    perform assert(false, 'a next-day edit must be rejected');
  exception when others then
    perform assert(sqlerrm like '%only be edited on the day%', 'a report cannot be edited the next day');
  end;

  -- ---------------------------------------------------------------
  -- Read models.
  -- ---------------------------------------------------------------
  perform act_as(ada);
  perform assert(not public.can_file_report(), 'a merchandiser cannot file reports');
  payload := public.my_day();
  perform assert((payload ->> 'can_file_report')::boolean = false,
    'my_day tells a merchandiser they cannot file');
  perform assert(payload -> 'opening' ->> 'status' = 'on_site', 'my_day reports today''s opening');
  perform assert(payload -> 'outlet' ->> 'name' = 'Ikeja City Mall', 'my_day carries the outlet');
  perform assert((payload ->> 'report_filed')::boolean = false,
    'my_day sees no report once it is backdated');

  perform act_as(boss);
  payload := public.admin_overview();
  perform assert((payload ->> 'clocked_in')::int = 2, 'the overview counts today''s clock-ins');
  perform assert((payload ->> 'off_site')::int = 1, 'the overview counts flagged openings');
  perform assert((payload ->> 'open_alerts')::int >= 3, 'the overview counts open alerts');

  -- Both merchandisers clocked in; the marketer did not, and marketers are
  -- field staff too, so she is the one absentee.
  perform assert(
    (select count(*) from public.absentees_today()) = 1,
    'the marketer who never clocked in is the only absentee');
  perform assert(
    (select full_name from public.absentees_today()) = 'Grace Nnadi',
    'absentees name the right person');

  perform assert(
    (select count(*) from public.attendance_detail where staff_name = 'Ada Okafor') = 2,
    'the detail view joins staff names');

  -- The location label leads with the premises name and never comes back
  -- empty: coordinates are the floor (migration 008).
  perform act_as(ada);
  update public.attendance set place_name = 'Justrite Superstore Bariga',
                               address = '56/58 Jagun Molu St, Bariga, Lagos'
   where user_id = ada and type = 'opening';
  perform assert(
    (select location_label from public.attendance_detail
      where user_id = ada and type = 'opening')
      = 'Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos',
    'the label reads as name then street');

  update public.attendance set place_name = null, address = null
   where user_id = ada and type = 'opening';
  perform assert(
    (select location_label from public.attendance_detail
      where user_id = ada and type = 'opening') like '%.%,%',
    'with no name or address the label falls back to coordinates');

  -- Back to the admin: the assertions that follow read admin-only views.
  perform act_as(boss);

  perform assert(
    (select days_present from public.staff_analytics(
        (now() at time zone 'Africa/Lagos')::date - 7,
        (now() at time zone 'Africa/Lagos')::date)
     where full_name = 'Ada Okafor') = 1,
    'analytics counts one present day per opening');

  -- ---------------------------------------------------------------
  -- Alert resolution is admin-only and audited.
  -- ---------------------------------------------------------------
  perform public.resolve_alert(
    (select id from public.location_alerts where alert_type = 'off_site_clock' limit 1),
    'Spoke to Ada, she was at the back entrance');
  perform assert(
    (select is_resolved from public.location_alerts where alert_type = 'off_site_clock' limit 1),
    'an admin can resolve an alert');
  perform assert(
    (select count(*) from public.audit_log where action = 'alert.resolve') = 1,
    'resolving writes an audit row');
  perform assert(
    (select actor_id from public.audit_log where action = 'alert.resolve') = boss,
    'the audit actor is the session user');

  perform act_as(ada);
  begin
    perform public.resolve_alert(
      (select id from public.location_alerts where alert_type = 'low_accuracy' limit 1), 'nope');
    perform assert(false, 'a merchandiser must not resolve alerts');
  exception when others then
    perform assert(sqlerrm like '%Admins only%', 'a merchandiser cannot resolve an alert');
  end;

  -- The audit trail is admin-only. A merchandiser must not be able to
  -- forge a row naming themselves as the actor (migration 003).
  begin
    perform public.write_audit('user.delete', 'profiles', boss, '{"forged":true}'::jsonb);
    perform assert(false, 'a merchandiser must not write an audit row');
  exception when others then
    perform assert(sqlerrm like '%Admins and supervisors only%', 'a merchandiser cannot write an audit row');
  end;

  -- ---------------------------------------------------------------
  -- The no-show sweep, exercised through the real function by giving an
  -- outlet a shift start that has already passed today.
  -- ---------------------------------------------------------------
  perform act_as(boss);
  update public.outlets set shift_start = '00:01' where id = kiosk_id;
  -- Bala is at the kiosk and clocked in, so he is not a no-show; Grace is
  -- at the mall whose shift has not started.
  perform assert(
    (select count(*) from public.staff_no_show(0)
      where outlet_id = kiosk_id) = 0,
    'someone who clocked in is never a no-show');

  -- Move the marketer to the early outlet: she never clocked in.
  update public.profiles set outlet_id = kiosk_id where id = grace;
  perform assert(
    (select count(*) from public.staff_no_show(0) where user_id = grace) = 1,
    'a marketer who never clocked in is reported');
  perform assert(
    (select minutes_late from public.staff_no_show(0) where user_id = grace) > 0,
    'the sweep says how late they are');

  -- Put it back so later assertions see the original arrangement.
  update public.profiles set outlet_id = mall_id where id = grace;
  update public.outlets set shift_start = '09:00' where id = kiosk_id;

  -- ---------------------------------------------------------------
  -- Store visits: a marketer's day is a sequence of them (migration 010).
  -- ---------------------------------------------------------------
  -- Grace's round covers the kiosk as well as her home store.
  perform act_as(boss);
  perform set_staff_outlets(grace, array[kiosk_id]);

  perform act_as(grace);
  perform assert(public.can_visit_stores(), 'a marketer records store visits');

  -- Arrive at the mall, inside its fence.
  insert into public.store_visits
    (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at,
     selfie_path, arrived_place_name)
  values (mall_id, 6.6019, 3.3516, 12, now(), fresh_photo('selfies', 'grace-v1.jpg'), 'Ikeja City Mall')
  returning id into visit_id;

  perform assert(
    (select arrived_status from public.store_visits where id = visit_id) = 'on_site',
    'arriving inside the store fence is on_site');
  perform assert(
    (select round(arrived_distance_m) from public.store_visits where id = visit_id) < 30,
    'the distance is measured against the store being visited');
  perform assert(
    (select status from public.store_visits where id = visit_id) = 'open',
    'the visit is open until they check out');

  -- A second check-in without checking out is a mistake, not a visit.
  begin
    insert into public.store_visits
      (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
    values (kiosk_id, 9.0765, 7.3986, 12, now());
    perform assert(false, 'two open visits must be impossible');
  exception when unique_violation then
    perform assert(true, 'a marketer cannot be in two stores at once');
  end;

  -- Check out, then move to the next store.
  payload := public.end_store_visit(visit_id, 6.6019, 3.3516, 12, 'Ikeja City Mall', null);
  perform assert(payload ->> 'status' = 'on_site', 'checking out at the store is on_site');
  perform assert(
    (select status from public.store_visits where id = visit_id) = 'closed',
    'the visit closes');
  begin
    perform public.end_store_visit(visit_id, 6.6019, 3.3516, 12, null, null);
    perform assert(false, 'a closed visit must not close twice');
  exception when others then
    perform assert(sqlerrm like '%already closed%', 'a visit cannot be closed twice');
  end;

  -- Second store of the day, and this one is nowhere near.
  insert into public.store_visits
    (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at, selfie_path)
  values (kiosk_id, 9.0900, 7.4100, 15, now(), fresh_photo('selfies', 'grace-v2.jpg'))
  returning id into visit_id;
  perform assert(
    (select arrived_status from public.store_visits where id = visit_id) = 'off_site',
    'arriving away from the store is off_site');

  perform assert(
    (select count(*) from public.my_store_visits()) = 2,
    'the marketer sees both of today''s visits');

  -- A merchandiser has one fixed outlet and does not do this.
  perform act_as(ada);
  perform assert(not public.can_visit_stores(), 'a merchandiser does not record store visits');
  begin
    insert into public.store_visits
      (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
    values (mall_id, 6.6019, 3.3516, 12, now());
    perform assert(false, 'a merchandiser must not record a store visit');
  exception when others then
    perform assert(true, 'a merchandiser cannot record a store visit');
  end;

  -- The office sees the visits.
  perform act_as(boss);
  perform assert(
    (select count(*) from public.store_visits_today()) = 2,
    'the office sees today''s store visits');
  perform assert(
    (select outlet_name from public.store_visits_today() order by arrived_at limit 1)
      = 'Ikeja City Mall',
    'and which store each one was');

  -- ---------------------------------------------------------------
  -- The office can see where people are (migration 009).
  -- ---------------------------------------------------------------
  perform act_as(boss);
  perform assert(
    (select count(*) from public.live_locations()) = 1,
    'live locations lists the one person still on shift');
  perform assert(
    (select full_name from public.live_locations()) = 'Bala Yusuf',
    'and names them');
  perform assert(
    (select distance_from_outlet_m from public.live_locations()) is not null,
    'with their distance from the outlet');
  perform assert(
    (select inside_geofence from public.live_locations()) is not null,
    'and whether that is inside the fence');

  -- An alert now says where, not only how far.
  perform assert(
    (select location_label from public.alert_detail
      where alert_type = 'off_site_clock' limit 1) is not null,
    'an off-site alert carries the location it happened at');

  -- A merchandiser sees none of this.
  perform act_as(ada);
  perform assert(
    (select count(*) from public.live_locations()) = 0,
    'a merchandiser cannot see where anyone is');
  perform act_as(boss);

  -- ---------------------------------------------------------------
  -- Who gets told about a given person (migration 007).
  -- ---------------------------------------------------------------
  perform assert(
    (select count(*) from public.alert_watchers(ada)) = 1,
    'an admin is told about a merchandiser');
  perform assert(
    (select full_name from public.alert_watchers(ada)) = 'Ngozi Eze',
    'the watcher is the admin');
  perform assert(
    (select count(*) from public.alert_watchers(boss) where role = 'admin') = 0,
    'nobody is their own watcher');

  -- ---------------------------------------------------------------
  -- Push targeting: reach is the sender's, not the caller's wish.
  -- ---------------------------------------------------------------
  perform act_as(boss);
  perform assert(public.can_send_notifications(), 'an admin can send notifications');
  perform assert(
    (select count(*) from public.resolve_notification_targets('everyone')) = 4,
    'everyone reaches all four active staff');
  perform assert(
    (select count(*) from public.resolve_notification_targets(
      'role', jsonb_build_object('role', 'marketer'))) = 1,
    'targeting a role reaches only that role');
  perform assert(
    (select count(*) from public.resolve_notification_targets(
      'outlet', jsonb_build_object('outlet_id', kiosk_id))) = 1,
    'targeting an outlet reaches only that outlet');
  perform assert(
    (select count(*) from public.resolve_notification_targets(
      'users', jsonb_build_object('user_ids', jsonb_build_array(ada, grace)))) = 2,
    'targeting named people reaches exactly them');

  -- A merchandiser cannot address anybody.
  perform act_as(ada);
  perform assert(not public.can_send_notifications(), 'a merchandiser cannot send notifications');
  perform assert(
    (select count(*) from public.resolve_notification_targets('everyone')) = 0,
    'a merchandiser resolves no targets at all');

  -- ---------------------------------------------------------------
  -- Retention: both images go 14 days after the photo was taken (0067;
  -- 24 hours before it), and only once the deletion was announced.
  --
  -- The objects themselves are removed by the server through the Storage
  -- API, because Supabase refuses a direct DELETE. What is tested here is
  -- the database's half: which paths have expired, forgetting them, and
  -- the throttle that lets ordinary traffic drive the sweep.
  -- ---------------------------------------------------------------
  perform act_as(bala);
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, thumb_path, client_captured_at)
  values ('closing', 9.0765, 7.3986, 10, fresh_photo('selfies', 'old-full.jpg'), fresh_photo('selfies', 'old-thumb.jpg'), now())
  returning id into attendance_id;
  update public.attendance set created_at = now() - interval '25 hours'
   where id = attendance_id;
  perform announced_yesterday();
  perform assert(
    (select count(*) from public.expired_selfie_paths(24)) = 0,
    'retention 0067: a clock photo a day old is kept, whatever is asked');
  update public.attendance set created_at = now() - interval '15 days'
   where id = attendance_id;

  perform act_as(grace);
  -- Close whatever round she is still on, so a new visit can open.
  perform public.end_store_visit(v.id, 9.0765, 7.3986, 12, null, null)
  from public.store_visits v where v.user_id = grace and v.status = 'open';

  insert into public.store_visits
    (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at,
     selfie_path, thumb_path)
  values (kiosk_id, 9.0765, 7.3986, 12, now(), fresh_photo('selfies', 'fresh-full.jpg'), fresh_photo('selfies', 'fresh-thumb.jpg'))
  returning id into visit_id;

  perform assert(
    (select count(*) from public.expired_selfie_paths(24)) = 2,
    'both images of an expired clock event are listed for deletion');
  perform assert(
    exists (select 1 from public.expired_selfie_paths(24) where path like '%-old-thumb.jpg'),
    'the thumbnail expires with the full frame, not after it');
  perform assert(
    not exists (select 1 from public.expired_selfie_paths(24) where path like '%-fresh-%'),
    'a photo taken today is left alone');

  perform assert(public.forget_expired_selfies(24) = 1, 'one record forgets its photo');
  perform assert(
    (select selfie_path is null and thumb_path is null
     from public.attendance where id = attendance_id),
    'the attendance row no longer points at an image');
  perform assert(
    (select count(*) from public.attendance where id = attendance_id) = 1,
    'but the attendance record itself survives');
  perform assert(
    (select count(*) from public.expired_selfie_paths(24)) = 0,
    'and nothing is listed for deletion twice');

  -- A store visit photo expires on exactly the same rule.
  update public.store_visits set created_at = now() - interval '15 days' where id = visit_id;
  perform assert(
    (select count(*) from public.expired_selfie_paths(24)) = 2,
    'a store visit photo expires on the same rule');
  perform assert(public.forget_expired_selfies(24) = 1, 'and the visit forgets it too');
  perform assert(
    (select status from public.store_visits where id = visit_id) = 'open',
    'while the visit itself is untouched');

  -- The throttle hands the work to one caller and turns the rest away.
  perform assert(public.claim_selfie_sweep(10), 'the first sweep of the period is allowed');
  perform assert(not public.claim_selfie_sweep(10), 'a second one straight away is not');
  update public.job_runs set last_run_at = now() - interval '20 minutes'
   where job = 'purge_selfies';
  perform assert(public.claim_selfie_sweep(10), 'and it is allowed again once the period is up');

  -- An admin can see whether the rule is running; nobody else can.
  perform act_as(boss);
  perform assert(
    (public.selfie_retention_status() ->> 'photos_held') is not null,
    'an admin can see how many photos are still held');
  perform act_as(bala);
  perform assert(public.selfie_retention_status() is null,
    'a merchandiser cannot see the retention status');

  -- Supabase refuses a SQL delete on storage; the server must use the API.
  insert into storage.objects (bucket_id, name) values ('selfies', 'guard/1.jpg');
  begin
    delete from storage.objects where name = 'guard/1.jpg';
    raise exception 'NOT REFUSED';
  exception when others then
    perform assert(sqlerrm like '%Storage API%',
      'deleting from storage.objects in SQL is refused, as it is on Supabase');
  end;

  -- ---------------------------------------------------------------
  -- Allocating several stores to one person.
  -- ---------------------------------------------------------------
  insert into auth.users (id, email) values (tunde, 'tunde@xpel.ng');
  insert into public.outlets (name, lat, lng, geofence_radius_m)
  values ('Bariga Depot', 6.5390, 3.3841, 120) returning id into depot_id;
  insert into public.profiles (id, full_name, email, role, outlet_id)
  values (tunde, 'Tunde Bello', 'tunde@xpel.ng', 'supervisor', depot_id);

  -- Before anything is allocated, a person has exactly their home store.
  perform assert(
    (select count(*) from public.outlets_for_user(bala)) = 1,
    'with no allocation a person has only their home store');

  perform act_as(boss);
  perform assert(public.can_allocate_outlets(grace), 'an admin allocates stores to a marketer');
  perform set_staff_outlets(grace, array[kiosk_id, depot_id]);

  perform assert(
    (select count(*) from public.outlets_for_user(grace)) = 3,
    'the allocated stores are added to the home store');
  perform assert(
    (select count(*) from public.staff_outlets where user_id = grace) = 2,
    'both allocations are recorded');
  perform assert(
    (select assigned_by from public.staff_outlets where user_id = grace and outlet_id = kiosk_id)
      = boss,
    'the allocation records who made it');

  -- Sending a shorter list drops what is missing, in one statement.
  perform set_staff_outlets(grace, array[kiosk_id]);
  perform assert(
    (select count(*) from public.staff_outlets where user_id = grace) = 1,
    'a store left off the list is unallocated');
  perform assert(
    not exists (select 1 from public.staff_outlets
                where user_id = grace and outlet_id = depot_id),
    'and it is the right one that went');

  perform assert(
    (select count(*) from public.audit_log
      where action = 'staff.allocate_outlets' and target_id = grace) = 3,
    'every allocation leaves an audit row');

  -- A store that does not exist is refused rather than half-saved.
  begin
    perform set_staff_outlets(grace, array[gen_random_uuid()]);
    perform assert(false, 'an unknown store is refused');
  exception when others then
    perform assert(
      (select count(*) from public.staff_outlets where user_id = grace) = 1,
      'a refused allocation changes nothing');
  end;

  -- ---------------------------------------------------------------
  -- The daily clock measures against the nearest allocated store.
  -- ---------------------------------------------------------------
  perform act_as(grace);
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('opening', 9.0766, 7.3987, 10, fresh_photo('selfies', 'g-1.jpg'), now())
  returning id, status, distance_m into attendance_id, row_status, row_dist;

  perform assert(row_status = 'on_site',
    'clocking in at an allocated store that is not the home store is on_site');
  perform assert(
    (select outlet_id from public.attendance where id = attendance_id) = kiosk_id,
    'the clock event is attributed to the store they were actually at');
  perform assert(row_dist < 40, 'and measured against that store');

  -- ---------------------------------------------------------------
  -- A merchandiser with a second store has to say which one they are in.
  -- ---------------------------------------------------------------
  perform act_as(ada);
  perform assert(not public.can_visit_stores(),
    'a merchandiser with one store uses the daily clock');
  perform act_as(boss);
  perform set_staff_outlets(ada, array[kiosk_id]);
  perform act_as(ada);
  perform assert(public.can_visit_stores(),
    'a merchandiser covering two stores records store visits');

  -- ---------------------------------------------------------------
  -- A supervisor reaches whoever is allocated to their outlet.
  -- ---------------------------------------------------------------
  perform act_as(tunde);
  perform assert(not public.supervises_user(grace),
    'a marketer allocated elsewhere is not on the supervisor''s team');
  perform assert(not public.can_allocate_outlets(bala),
    'a supervisor cannot allocate to someone outside their team');

  perform act_as(boss);
  perform set_staff_outlets(grace, array[kiosk_id, depot_id]);

  perform act_as(tunde);
  perform assert(public.supervises_user(grace),
    'allocating someone to the supervisor''s outlet puts them on the team');
  perform assert(public.can_allocate_outlets(grace),
    'and the supervisor can then change their stores');
  perform assert(not public.can_allocate_outlets(boss),
    'a supervisor never allocates stores to an admin');

  perform set_staff_outlets(grace, array[depot_id]);
  perform assert(
    (select count(*) from public.staff_outlets where user_id = grace) = 1,
    'a supervisor''s allocation is saved');
  perform assert(
    exists (select 1 from public.audit_log
            where action = 'staff.allocate_outlets'
              and target_id = grace and actor_id = tunde),
    'and audited against the supervisor who made it');

  perform act_as(grace);
  select count(*) into alloc from public.my_outlets();
  perform assert(alloc = 2, 'the marketer sees their home store and the allocated one');

  -- ---------------------------------------------------------------
  -- A marketer's round needs no allocation at all (migration 016).
  -- ---------------------------------------------------------------
  perform act_as(boss);
  perform set_staff_outlets(grace, array[]::uuid[]);

  perform act_as(grace);
  perform public.end_store_visit(v.id, 9.0765, 7.3986, 12, null, null)
  from public.store_visits v where v.user_id = grace and v.status = 'open';

  perform assert(
    (select count(*) from public.staff_outlets where user_id = grace) = 0,
    'the marketer has no allocated stores');

  -- Standing inside a store Xtend knows, allocated to nobody.
  insert into public.store_visits
    (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at, selfie_path)
  values (9.0766, 7.3987, 10, now(), fresh_photo('selfies', 'auto-1.jpg'))
  returning id into visit_id;
  perform assert(
    (select outlet_id from public.store_visits where id = visit_id) = kiosk_id,
    'standing in a known store attributes the visit to it, with no allocation');
  perform assert(
    (select arrived_status from public.store_visits where id = visit_id) = 'on_site',
    'and reads on_site');
  perform public.end_store_visit(visit_id, 9.0766, 7.3987, 10, null, null);

  -- A shop Xtend has never heard of is a perfectly good visit. The map
  -- names it first, as the app's lookup does before the visit is saved.
  select count(*) into alert_count from public.location_alerts where user_id = grace;
  perform public.learn_place(6.4500, 3.4000, 'Justrite Superstore Bariga', null, 'google');
  insert into public.store_visits
    (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at, arrived_place_name)
  values (6.4500, 3.4000, 10, now(), 'Justrite Superstore Bariga')
  returning id into visit_id;
  perform assert(
    (select outlet_id from public.store_visits where id = visit_id) is null,
    'a shop Xtend does not know is recorded against no outlet');
  perform assert(
    (select arrived_status from public.store_visits where id = visit_id) is null,
    'and is neither on_site nor off_site, because there is nowhere they were due');
  perform assert(
    (select store_label from public.store_visit_detail where id = visit_id)
      = 'Justrite Superstore Bariga',
    'the map names it');
  perform assert(
    (select count(*) from public.location_alerts where user_id = grace) = alert_count,
    'and visiting it raises no alert');
  perform public.end_store_visit(visit_id, 6.45, 3.40, 10, null, null);
  perform assert(
    (select departed_status from public.store_visits where id = visit_id) is null,
    'checking out of it is just a time, too');
  delete from public.known_places where name = 'Justrite Superstore Bariga';

  -- Naming a store and not being at it still means something.
  insert into public.store_visits
    (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
  values (kiosk_id, 6.4500, 3.4000, 10, now())
  returning id into visit_id;
  perform assert(
    (select arrived_status from public.store_visits where id = visit_id) = 'off_site',
    'naming a store you are not at is still off_site');
  perform assert(
    (select count(*) from public.location_alerts where user_id = grace) > alert_count,
    'and that one does raise an alert');
  perform public.end_store_visit(visit_id, 6.45, 3.40, 10, null, null);

  -- ---------------------------------------------------------------
  -- The day, per person: in, stores, out.
  -- ---------------------------------------------------------------
  perform act_as(boss);
  select stores_visited into alloc from public.staff_day() where user_id = grace;
  perform assert(
    alloc = (select count(*) from public.store_visits
             where user_id = grace and visit_date = public.business_date()),
    'the day names how many stores were visited');
  perform assert(
    (select clocked_in_at from public.staff_day() where user_id = grace) is not null,
    'and when they clocked in');
  perform assert(
    (select minutes_in_store from public.staff_day() where user_id = grace) >= 0,
    'and how long they spent in store');
  perform assert(
    (select still_in_store from public.staff_day() where user_id = grace) is null,
    'and that they are not in a store right now');

  perform act_as(grace);
  perform assert(
    (select count(*) from public.staff_day()) = 1,
    'a marketer sees only their own day');

  -- The daily clock, for someone with no store of their own.
  perform act_as(boss);
  perform set_staff_outlets(grace, array[]::uuid[]);
  update public.profiles set outlet_id = null where id = grace;
  delete from public.attendance where user_id = grace;

  perform act_as(grace);
  select count(*) into alert_count from public.location_alerts where user_id = grace;
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('opening', 9.0766, 7.3987, 10, fresh_photo('selfies', 'g-clock.jpg'), now())
  returning id into attendance_id;
  perform assert(
    (select outlet_id from public.attendance where id = attendance_id) = kiosk_id,
    'clocking in inside a known store attributes it, with no store of their own');
  perform assert(
    (select status from public.attendance where id = attendance_id) = 'on_site',
    'and reads on_site');

  delete from public.attendance where id = attendance_id;
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('opening', 6.4500, 3.4000, 10, fresh_photo('selfies', 'g-clock2.jpg'), now())
  returning id into attendance_id;
  perform assert(
    (select outlet_id from public.attendance where id = attendance_id) is null,
    'clocking in nowhere known records the time and no store');
  perform assert(
    (select status from public.attendance where id = attendance_id) is null,
    'with no status, because there is nowhere they were due');
  perform assert(
    (select count(*) from public.location_alerts where user_id = grace) = alert_count,
    'and nobody is interrupted about it');
  -- But they must name the spot before their next store visit (045).
  perform assert((select count(*) from public.my_place_due()) = 1,
    'clocking in somewhere nobody can name asks them to name it');
  perform act_as(boss);
  perform public.dismiss_place_due((select id from public.place_naming_due where user_id = grace), 'Test: not a shop');
  perform act_as(grace);

  -- ---------------------------------------------------------------
  -- The map names the store when they are not in one of their own
  -- (migration 015).
  -- ---------------------------------------------------------------
  insert into public.store_visits
    (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at,
     arrived_place_name, arrived_address)
  values (6.5390, 3.3841, 10, now(), 'Justrite Superstore Bariga', '56/58 Jagun Molu St, Lagos')
  returning id into visit_id;
  perform assert(
    (select store_label from public.store_visit_detail where id = visit_id) = 'Bariga Depot',
    'inside their own fence the outlet names itself');
  perform assert(
    (select store_label_source from public.store_visit_detail where id = visit_id) = 'outlet',
    'and the label says so');
  perform public.end_store_visit(visit_id, 6.5390, 3.3841, 10, null, null);

  insert into public.store_visits
    (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at,
     arrived_place_name, arrived_address)
  values (6.4500, 3.4000, 10, now(), 'Justrite Superstore Bariga', '56/58 Jagun Molu St, Lagos')
  returning id into visit_id;
  perform assert(
    (select store_label from public.store_visit_detail where id = visit_id)
      = 'Justrite Superstore Bariga',
    'away from their stores the map names the premises');
  perform assert(
    (select store_label_source from public.store_visit_detail where id = visit_id) = 'map',
    'and it is marked as coming from the map');
  perform assert(
    (select arrived_status from public.store_visit_detail where id = visit_id) is null,
    'naming it does not make it on_site');
  perform assert(
    (select outlet_name from public.store_visit_detail where id = visit_id) is null,
    'and there is no outlet, because they were not in one');
  perform public.end_store_visit(visit_id, 6.45, 3.40, 10, null, null);

  insert into public.store_visits
    (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
  values (6.4500, 3.4000, 10, now())
  returning id into visit_id;
  perform assert(
    (select store_label from public.store_visit_detail where id = visit_id) = 'Unnamed place',
    'with nothing from the map and no outlet, the place is simply unnamed');
  perform public.end_store_visit(visit_id, 6.45, 3.40, 10, null, null);

  -- ---------------------------------------------------------------
  -- A supervisor's team, and what they may do to it (migration 017).
  -- ---------------------------------------------------------------
  -- Grace has no outlet and no allocation, so only reporting can link her.
  perform act_as(boss);
  update public.profiles set outlet_id = null, supervisor_id = null where id = grace;

  perform act_as(tunde);
  perform assert(not public.supervises_user(grace),
    'with no outlet and no reporting line, she is on nobody''s team');

  perform act_as(boss);
  update public.profiles set supervisor_id = tunde where id = grace;

  perform act_as(tunde);
  perform assert(public.supervises_user(grace),
    'naming the supervisor puts her on their team');
  perform assert(public.can_edit_staff(grace), 'and they may edit her account');
  perform assert(not public.can_edit_staff(boss), 'but not the admin''s');
  -- An admin who happens to sit at the supervisor's own outlet is still
  -- not theirs to touch.
  perform act_as(boss);
  update public.profiles set outlet_id = (select outlet_id from public.profiles where id = tunde)
   where id = boss;
  perform act_as(tunde);
  perform assert(not public.supervises_user(boss),
    'sharing an outlet with an admin does not make them your staff');
  perform assert(not public.can_edit_staff(boss), 'nor editable');
  perform act_as(boss);
  update public.profiles set outlet_id = null where id = boss;
  perform act_as(tunde);
  perform assert(public.can_create_staff('marketer'::user_role),
    'a supervisor creates marketers');
  perform assert(public.can_create_staff('merchandiser'::user_role),
    'and merchandisers');
  perform assert(not public.can_create_staff('supervisor'::user_role),
    'but never another supervisor');
  perform assert(not public.can_create_staff('admin'::user_role),
    'and never an admin');
  perform assert(
    (select count(*) from public.my_staff()) = 2,
    'their staff list is their team and themselves');

  perform act_as(boss);
  perform assert(public.can_create_staff('admin'::user_role), 'an admin creates anyone');
  perform assert(
    (select count(*) from public.my_staff()) = (select count(*) from public.profiles),
    'and sees everybody');

  perform act_as(ada);
  perform assert(not public.can_create_staff('merchandiser'::user_role),
    'a merchandiser creates nobody');

  -- Nonsense reporting lines are refused.
  perform act_as(boss);
  begin
    update public.profiles set supervisor_id = grace where id = ada;
    perform assert(false, 'a marketer must not be a supervisor');
  exception when others then
    perform assert(sqlerrm like '%not a supervisor%',
      'somebody who is not a supervisor cannot be named as one');
  end;
  begin
    update public.profiles set supervisor_id = tunde where id = tunde;
    perform assert(false, 'self-supervision must be refused');
  exception when others then
    perform assert(sqlerrm like '%supervise themselves%',
      'nobody supervises themselves');
  end;

  -- ---------------------------------------------------------------
  -- Promoting and demoting (migration 018).
  -- ---------------------------------------------------------------
  perform act_as(boss);
  update public.profiles set supervisor_id = tunde where id = grace;
  perform assert(
    (select supervisor_id from public.profiles where id = grace) = tunde,
    'the marketer reports to the supervisor');

  -- An admin may make anybody a supervisor, or an admin.
  update public.profiles set role = 'supervisor'::user_role where id = ada;
  perform assert(
    (select role from public.profiles where id = ada) = 'supervisor',
    'an admin promotes a merchandiser to supervisor');
  update public.profiles set role = 'admin'::user_role where id = ada;
  perform assert(
    (select role from public.profiles where id = ada) = 'admin',
    'and on to admin');
  perform assert(
    (select count(*) from public.available_supervisors()) >= 3,
    'and they are then offered as somebody to report to');

  -- Demote the supervisor: whoever reported to them is released.
  update public.profiles set role = 'marketer'::user_role where id = tunde;
  perform assert(
    (select supervisor_id from public.profiles where id = grace) is null,
    'demoting a supervisor releases the people who reported to them');

  -- Put it all back.
  update public.profiles set role = 'supervisor'::user_role where id = tunde;
  update public.profiles set role = 'merchandiser'::user_role where id = ada;

  perform act_as(tunde);
  perform assert(
    (select count(*) from public.available_supervisors()) = 0,
    'a supervisor is not offered the list of supervisors to assign');

  -- ---------------------------------------------------------------
  -- Store counts (migration 019).
  -- ---------------------------------------------------------------
  perform act_as(boss);
  insert into public.products (name) values ('Xpel Soap 100g') returning id into soap;

  begin
    insert into public.products (name) values ('  xpel soap 100G ');
    perform assert(false, 'the same product name twice is refused');
  exception when unique_violation then
    perform assert(true, 'the same product name twice is refused');
  end;

  -- Counting is open in the last three days of a month, whatever its length.
  perform assert(public.is_month_end_window(date '2026-09-28'), 'the 28th of September is month end');
  perform assert(public.is_month_end_window(date '2026-09-30'), 'so is the 30th');
  perform assert(not public.is_month_end_window(date '2026-09-27'), 'the 27th is not');
  perform assert(public.is_month_end_window(date '2026-02-26'), 'in a 28-day February the 26th is');
  perform assert(not public.is_month_end_window(date '2026-02-25'), 'and the 25th is not');
  perform assert(public.is_month_end_window(date '2026-12-31'), 'the year end is month end too');

  -- Outside month end, nobody counts until somebody asks.
  perform act_as(ada);
  if not public.is_month_end_window() then
    perform assert((public.store_count_status()->>'open')::boolean = false,
      'with no request and no month end, counting is closed');
    begin
      perform count_here(mall_id, jsonb_build_array(
        jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)));
      perform assert(false, 'a count nobody asked for is refused');
    exception when others then
      perform assert(sqlerrm like '%No store count is due%', 'a count nobody asked for is refused');
    end;
  end if;

  -- Asking for a count.
  begin
    perform public.request_store_count(array[bala], public.business_date() + 1, null);
    perform assert(false, 'a merchandiser cannot ask for a count');
  exception when others then
    perform assert(sqlerrm like '%Only a supervisor or an admin%', 'a merchandiser cannot ask for a count');
  end;

  perform act_as(tunde);
  begin
    perform public.request_store_count(array[ada], public.business_date() + 1, null);
    perform assert(false, 'a supervisor cannot ask somebody outside their team');
  exception when others then
    perform assert(sqlerrm like '%your own%', 'a supervisor cannot ask somebody outside their team');
  end;

  perform act_as(boss);
  begin
    perform public.request_store_count(array[ada], public.business_date() - 1, null);
    perform assert(false, 'a due date in the past is refused');
  exception when others then
    perform assert(sqlerrm like '%past%', 'a due date in the past is refused');
  end;
  begin
    perform public.request_store_count(array[tunde], public.business_date() + 1, null);
    perform assert(false, 'a supervisor is not asked to count');
  exception when others then
    perform assert(sqlerrm like '%merchandisers and marketers%', 'a supervisor is not asked to count');
  end;

  req := public.request_store_count(array[ada, ada], public.business_date() + 2, 'Month-end stock take');
  perform assert(
    (select count(*) from public.count_request_targets where request_id = req) = 1,
    'an admin asks a merchandiser to count, once however often they are named');

  update public.profiles set supervisor_id = tunde where id = grace;
  perform act_as(tunde);
  req2 := public.request_store_count(array[grace], public.business_date(), null);
  perform assert(req2 is not null, 'a supervisor asks their own team to count');
  begin
    perform public.close_count_request(req);
    perform assert(false, 'a supervisor cannot close somebody else''s request');
  exception when others then
    perform assert(sqlerrm like '%not yours%', 'a supervisor cannot close somebody else''s request');
  end;

  perform act_as(ada);
  perform assert(public.store_count_status()->>'reason' = 'request'
                   and public.store_count_status()->>'request_id' = req::text,
    'the person asked sees the request as their reason to count');

  counted := count_here(mall_id, jsonb_build_array(
    jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 40, 'sold', 12),
    jsonb_build_object('product_name', '  Xpel   Cream 400ml ', 'in_store', 0, 'sold', 3)));
  perform assert(counted = 2, 'a merchandiser counts two products in their store');
  select id into cream from public.products where name = 'Xpel Cream 400ml';
  perform assert(cream is not null, 'a product typed for the first time is added, tidied up');
  perform assert((select count(*) from public.products where sheet_order is null) = 2,
    'a product already known is reused, not added again');
  perform assert(
    (select count(*) from public.store_counts
     where user_id = ada and outlet_id = mall_id
       and count_date = (now() at time zone 'Africa/Lagos')::date) = 2,
    'the count is stored against them, their store and the Lagos business date');
  perform assert(
    (select bool_and(request_id = req) from public.store_counts where user_id = ada),
    'and against the request that asked for it');
  perform assert(
    (select p.counted from public.count_request_progress p where p.id = req) = 1
      and (select p.people from public.count_request_progress p where p.id = req) = 1,
    'the request shows who has counted');

  counted := count_here(mall_id, jsonb_build_array(
    jsonb_build_object('product_name', 'XPEL SOAP 100G', 'in_store', 38, 'sold', 14)));
  perform assert(
    (select in_store from public.store_counts where user_id = ada and product_id = soap) = 38
      and (select count(*) from public.store_counts where user_id = ada) = 2,
    'counting a product again the same day, however it is typed, replaces the figures');

  begin
    perform count_here(depot_id, jsonb_build_array(
      jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)));
    perform assert(false, 'a store that is not theirs is refused');
  exception when others then
    perform assert(sqlerrm like '%not one of yours%', 'a store that is not theirs is refused');
  end;

  begin
    perform count_here(mall_id, jsonb_build_array(
      jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', -1, 'sold', 1)));
    perform assert(false, 'a negative count is refused');
  exception when others then
    perform assert(sqlerrm like '%whole numbers%', 'a negative count is refused');
  end;

  begin
    perform count_here(mall_id, jsonb_build_array(
      jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 2.5, 'sold', 1)));
    perform assert(false, 'a fractional count is refused');
  exception when others then
    perform assert(sqlerrm like '%whole numbers%', 'a fractional count is refused');
  end;

  begin
    perform count_here(mall_id, jsonb_build_array(
      jsonb_build_object('product_name', '   ', 'in_store', 1, 'sold', 1)));
    perform assert(false, 'a product with no name is refused');
  exception when others then
    perform assert(sqlerrm like '%needs a name%', 'a product with no name is refused');
  end;

  begin
    perform count_here(mall_id, jsonb_build_array(
      jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1),
      jsonb_build_object('product_name', 'xpel soap 100g', 'in_store', 2, 'sold', 2)));
    perform assert(false, 'the same product twice in one count is refused');
  exception when others then
    perform assert(sqlerrm like '%twice%', 'the same product twice in one count is refused');
  end;

  perform assert(
    (select count(*) from public.counted_product_names() n where n.name in ('Xpel Soap 100g', 'Xpel Cream 400ml')) = 2,
    'the names counted so far are offered as suggestions');

  perform act_as(tunde);
  begin
    perform count_here(mall_id, jsonb_build_array(
      jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)));
    perform assert(false, 'a supervisor does not submit counts');
  exception when others then
    perform assert(sqlerrm like '%cannot submit%', 'a supervisor does not submit counts');
  end;

  -- Closing the request closes counting for the people it asked.
  perform act_as(boss);
  perform public.close_count_request(req);
  perform act_as(ada);
  if not public.is_month_end_window() then
    perform assert((public.store_count_status()->>'open')::boolean = false,
      'once the request is closed, counting is closed again');
  end if;

  -- ---------------------------------------------------------------
  -- F. Selfies are taken in the app, now, by the person (migration 022).
  -- ---------------------------------------------------------------
  perform act_as(bala);
  -- These photos passed the check (023), so what is tested is the rest.
  insert into public.photo_checks (path, bucket, user_id, kind, verdict)
  values (bala::text || '/never-uploaded.jpg', 'selfies', bala, 'selfie', 'pass'),
         (bala::text || '/yesterday.jpg', 'selfies', bala, 'selfie', 'pass');
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, bala::text || '/never-uploaded.jpg', now());
    perform assert(false, 'a selfie that was never uploaded is refused');
  exception when others then
    perform assert(sqlerrm like '%taken in the app just now%', 'a selfie that was never uploaded is refused');
  end;

  insert into storage.objects (bucket_id, name, created_at)
  values ('selfies', bala::text || '/yesterday.jpg', now() - interval '2 hours');
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, bala::text || '/yesterday.jpg', now());
    perform assert(false, 'an old photo is refused');
  exception when others then
    perform assert(sqlerrm like '%taken in the app just now%', 'an old photo is refused');
  end;

  perform act_as(ada);
  used_path := fresh_photo('selfies', 'ada-face.jpg');
  perform act_as(bala);
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, used_path, now());
    perform assert(false, 'somebody else''s photo is refused');
  exception when others then
    perform assert(sqlerrm like '%taken in the app just now%', 'somebody else''s photo is refused');
  end;

  select a.selfie_path into used_path from public.attendance a
  where a.user_id = bala and a.selfie_path is not null limit 1;
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, used_path, now());
    perform assert(false, 'a selfie cannot be used twice');
  exception when others then
    perform assert(sqlerrm like '%already been used%', 'a selfie cannot be used twice');
  end;

  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, null, now());
    perform assert(false, 'a clock-in without a selfie is refused');
  exception when others then
    perform assert(sqlerrm like '%needs a selfie%', 'a clock-in without a selfie is refused');
  end;

  -- ---------------------------------------------------------------
  -- A. A store count is taken in the store, with a shelf photo.
  -- ---------------------------------------------------------------
  perform act_as(boss);
  req := public.request_store_count(array[ada], public.business_date() + 1, 'Integrity checks');
  perform act_as(ada);

  begin
    perform public.submit_store_count(mall_id,
      jsonb_build_array(jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)),
      6.4500, 3.4000, 12, fresh_photo('reports', 'shelf.jpg'));
    perform assert(false, 'a count sent from away from the store is refused');
  exception when others then
    perform assert(sqlerrm like '%must be in the store%', 'a count sent from away from the store is refused');
  end;

  begin
    perform public.submit_store_count(mall_id,
      jsonb_build_array(jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)),
      6.6018, 3.3515, 150, fresh_photo('reports', 'shelf.jpg'));
    perform assert(false, 'a vague location is refused');
  exception when others then
    perform assert(sqlerrm like '%not accurate enough%', 'a vague location is refused');
  end;

  begin
    perform public.submit_store_count(mall_id,
      jsonb_build_array(jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)),
      6.6018, 3.3515, 12, ada::text || '/no-photo.jpg');
    perform assert(false, 'a count without a fresh shelf photo is refused');
  exception when others then
    perform assert(sqlerrm like '%shelf photo%', 'a count without a fresh shelf photo is refused');
  end;

  select c.photo_path into used_path from public.store_counts c
  where c.user_id = ada and c.outlet_id = mall_id and c.photo_path is not null limit 1;
  begin
    perform public.submit_store_count(kiosk_id,
      jsonb_build_array(jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 1, 'sold', 1)),
      9.0765, 7.3986, 12, used_path);
    perform assert(false, 'a shelf photo from another store cannot be reused');
  exception when others then
    perform assert(sqlerrm like '%already been used%', 'a shelf photo from another store cannot be reused');
  end;

  perform assert(
    (select bool_and(distance_m < 30 and photo_path is not null)
     from public.store_counts where user_id = ada and outlet_id = mall_id),
    'a count records how far from the store it was taken, and its photo');

  -- ---------------------------------------------------------------
  -- B. Counts that do not add up are flagged, never refused.
  -- ---------------------------------------------------------------
  insert into public.store_counts (user_id, outlet_id, product_id, count_date, in_store, sold)
  values (ada, kiosk_id, soap, public.business_date() - 10, 50, 5),
         (ada, kiosk_id, cream, public.business_date() - 10, 20, 2);

  perform count_here(kiosk_id, jsonb_build_array(
    jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 30, 'sold', 10),
    jsonb_build_object('product_name', 'Xpel Cream 400ml', 'in_store', 18, 'sold', 2)));
  perform assert(
    (select count(*) from public.integrity_flags
     where user_id = ada and kind = 'count_units_missing'
       and jsonb_array_length(detail->'products') = 1
       and detail->'products'->0->>'missing' = '10') = 1,
    'ten units unaccounted for since the last count are flagged, for that product only');

  perform count_here(kiosk_id, jsonb_build_array(
    jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 40, 'sold', 10),
    jsonb_build_object('product_name', 'Xpel Cream 400ml', 'in_store', 18, 'sold', 2)));
  perform assert(
    (select count(*) from public.integrity_flags where user_id = ada and kind = 'count_units_missing') = 0,
    'correcting the count the same day clears the flag');

  perform count_here(kiosk_id, jsonb_build_array(
    jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 50, 'sold', 5),
    jsonb_build_object('product_name', 'Xpel Cream 400ml', 'in_store', 20, 'sold', 2)));
  perform assert(
    (select count(*) from public.integrity_flags where user_id = ada and kind = 'count_identical') = 1,
    'a count identical to the last one is flagged');
  perform assert(
    (select count(*) from public.integrity_flags where user_id = ada and kind = 'count_units_missing') = 0,
    'more units than before is a delivery, not a problem');

  perform count_here(kiosk_id, jsonb_build_array(
    jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 40, 'sold', 10),
    jsonb_build_object('product_name', 'Xpel Cream 400ml', 'in_store', 20, 'sold', 0),
    jsonb_build_object('product_name', 'Xpel Gel', 'in_store', 10, 'sold', 10),
    jsonb_build_object('product_name', 'Xpel Oil', 'in_store', 30, 'sold', 20)));
  perform assert(
    (select count(*) from public.integrity_flags where user_id = ada and kind = 'count_round_numbers') = 1,
    'a count made only of round numbers is flagged');

  -- ---------------------------------------------------------------
  -- C. Locations that look faked are flagged.
  -- ---------------------------------------------------------------
  update public.attendance set attendance_date = public.business_date() - 1
  where user_id = ada and type = 'opening';
  select count(*) into flagged from public.integrity_flags where user_id = ada;
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('opening', 6.6019, 3.3516, 1, fresh_photo('selfies', 'again.jpg'), now());
  perform assert(
    exists (select 1 from public.integrity_flags
            where user_id = ada and kind = 'repeated_exact_location' and outlet_id = mall_id),
    'the exact same GPS point as on another day is flagged, against the store');
  perform assert(
    exists (select 1 from public.integrity_flags where user_id = ada and kind = 'perfect_accuracy'),
    'a 1 m accuracy reading is flagged');

  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  select 'closing', 6.6019 + 0.0001, 3.3516, 14, fresh_photo('selfies', 'close.jpg'), now()
  where not exists (select 1 from public.attendance
                    where user_id = ada and type = 'closing'
                      and attendance_date = public.business_date());
  perform assert(
    not exists (select 1 from public.integrity_flags
                where user_id = ada and kind = 'impossible_journey'),
    'walking round the store is not a journey');

  -- Everything here happens inside one transaction, at one now(); the ping
  -- trigger stamps its own time, so the clock-in is moved two minutes back.
  update public.attendance set created_at = now() - interval '2 minutes'
  where user_id = ada and attendance_date = public.business_date();
  insert into public.location_pings (lat, lng, accuracy_m) values (9.0765, 7.3986, 15);
  perform assert(
    exists (select 1 from public.integrity_flags where user_id = ada and kind = 'impossible_journey'),
    'Lagos to Abuja in seconds is flagged');

  -- Reviewing a flag.
  begin
    perform public.review_integrity_flag(
      (select id from public.integrity_flags where user_id = ada limit 1), 'my own');
    perform assert(false, 'nobody reviews their own flags');
  exception when others then
    perform assert(sqlerrm like '%not yours%', 'nobody reviews their own flags');
  end;
  perform act_as(boss);
  perform public.review_integrity_flag(
    (select id from public.integrity_flags where user_id = ada and kind = 'impossible_journey' limit 1),
    'Checked with her: phone was on a fake-location app');
  perform assert(
    exists (select 1 from public.integrity_flags
            where user_id = ada and kind = 'impossible_journey'
              and reviewed_by = boss and review_note like 'Checked%'),
    'an admin reviews a flag with a note');

  -- ---------------------------------------------------------------
  -- Photos are checked before they count (migration 023).
  -- ---------------------------------------------------------------
  perform act_as(bala);
  used_path := fresh_photo('selfies', 'phone-screen.jpg');
  update public.photo_checks set verdict = 'reject', problem = 'screen' where path = used_path;
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, used_path, now());
    perform assert(false, 'a selfie rejected by the check is refused');
  exception when others then
    perform assert(sqlerrm like '%was rejected%', 'a selfie rejected by the check is refused');
  end;

  used_path := fresh_photo('selfies', 'skipped-check.jpg');
  delete from public.photo_checks where path = used_path;
  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 9.0765, 7.3986, 10, used_path, now());
    perform assert(false, 'a selfie that skipped the check is refused');
  exception when others then
    perform assert(sqlerrm like '%not been checked%', 'a selfie that skipped the check is refused');
  end;

  perform act_as(ada);
  used_path := fresh_photo('reports', 'screen-shelf.jpg');
  update public.photo_checks set verdict = 'reject', problem = 'screen' where path = used_path;
  begin
    perform public.submit_store_count(kiosk_id,
      jsonb_build_array(jsonb_build_object('product_name', 'Xpel Soap 100g', 'in_store', 40, 'sold', 10)),
      9.0765, 7.3986, 12, used_path);
    perform assert(false, 'a rejected shelf photo is refused');
  exception when others then
    perform assert(sqlerrm like '%shelf photo%', 'a rejected shelf photo is refused');
  end;

  -- The checking service was down: allowed, so nobody is stuck.
  perform act_as(grace);
  used_path := fresh_photo('selfies', 'service-down.jpg');
  update public.photo_checks set verdict = 'unchecked' where path = used_path;
  perform public.end_store_visit(v.id, 9.0765, 7.3986, 12, null, null)
  from public.store_visits v where v.user_id = grace and v.status = 'open';
  insert into public.store_visits
    (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at, selfie_path)
  values (kiosk_id, 9.0765, 7.3986, 12, now(), used_path);
  perform assert(
    exists (select 1 from public.store_visits where selfie_path = used_path),
    'a photo that could not be checked is still accepted');

  -- ---------------------------------------------------------------
  -- Xtend learns places (migration 024).
  -- ---------------------------------------------------------------
  perform act_as(grace);
  place_id := public.learn_place(6.5000, 3.3000, '  Mama   Nkechi Provisions  ', null, 'staff',
                                 place_photo('front.jpg'));
  perform assert(place_id is not null, 'a person names a place the maps did not know');
  perform assert(
    (select name from public.known_place_at(6.50010, 3.30010)) = 'Mama Nkechi Provisions',
    'the next person 15 m away is told its name, tidied up');
  perform assert(
    not exists (select 1 from public.known_place_at(6.5100, 3.3000)),
    'a kilometre away it is not that place');

  perform act_as(bala);
  perform assert(
    public.learn_place(6.50005, 3.30005, 'Some Other Name', null, 'google') = place_id,
    'the same spot is recognised, whatever name a map gives it');
  perform assert(
    (select times_seen from public.known_places where id = place_id) = 2
      and (select count(*) from public.known_places) = 1,
    'it is counted as seen again, not added twice');
  perform assert(
    (select visitors from public.known_places where id = place_id) = array[grace, bala],
    'and who was there is remembered');

  perform assert(
    public.learn_place(6.6018, 3.3515, 'Not a new place', null, 'staff') is null,
    'inside one of the stores nothing is learned: the store names it');

  begin
    perform public.learn_place(6.4000, 3.4000, 'x', null, 'staff', place_photo('x.jpg'));
    perform assert(false, 'a one-letter name is refused');
  exception when others then
    perform assert(sqlerrm like '%2 to 120%', 'a one-letter name is refused');
  end;

  -- ---------------------------------------------------------------
  -- Nobody passes their house off as a shop (migration 025).
  -- ---------------------------------------------------------------
  perform act_as(grace);
  begin
    perform public.learn_place(6.4500, 3.4500, 'ikeja city-mall', null, 'staff', place_photo('home.jpg'));
    perform assert(false, 'a store''s name, 17 km from the store, is refused');
  exception when others then
    perform assert(sqlerrm like '%does not match where you are standing%',
      'a store''s name, 17 km from the store, is refused');
  end;
  begin
    perform public.learn_place(6.4500, 3.4500, 'Ikeja City Mall Annex', null, 'staff', place_photo('home2.jpg'));
    perform assert(false, 'nor a name that contains a store''s name');
  exception when others then
    perform assert(sqlerrm like '%does not match%', 'nor a name that contains a store''s name');
  end;
  perform assert(
    public.learn_place(6.6050, 3.3530, 'Ikeja City Mall Car Park', null, 'staff',
                       place_photo('carpark.jpg')) is not null,
    'next to the store itself, its name may be used');
  perform assert(
    public.learn_place(6.4600, 3.4600, 'Mall Road Pharmacy', null, 'staff',
                       place_photo('pharmacy.jpg')) is not null,
    'a common word ("mall") on its own is not a clash');

  begin
    perform public.learn_place(6.4700, 3.4700, 'Blessing Stores', null, 'staff', null);
    perform assert(false, 'naming a place needs a photo of it');
  exception when others then
    perform assert(sqlerrm like '%photo of the shop front%', 'naming a place needs a photo of it');
  end;
  begin
    perform public.learn_place(6.4700, 3.4700, 'Blessing Stores', null, 'staff',
                               fresh_photo('reports', 'shelf-as-front.jpg'));
    perform assert(false, 'a shelf photo does not count as a shop front');
  exception when others then
    perform assert(sqlerrm like '%photo of the shop front%', 'a shelf photo does not count as a shop front');
  end;
  used_path := place_photo('a-house.jpg');
  update public.photo_checks set verdict = 'reject', problem = 'not_a_business' where path = used_path;
  begin
    perform public.learn_place(6.4700, 3.4700, 'Blessing Stores', null, 'staff', used_path);
    perform assert(false, 'a photo the check said shows a house is refused');
  exception when others then
    perform assert(sqlerrm like '%photo of the shop front%', 'a photo the check said shows a house is refused');
  end;
  used_path := place_photo('once.jpg');
  perform public.learn_place(6.4700, 3.4700, 'Blessing Stores', null, 'staff', used_path);
  begin
    perform public.learn_place(6.4800, 3.4800, 'Another Shop', null, 'staff', used_path);
    perform assert(false, 'one photo names one place');
  exception when others then
    perform assert(sqlerrm like '%new photo here%', 'one photo names one place');
  end;

  -- A place only its namer ever uses is flagged, once, on the third visit.
  place_id := (select id from public.known_places where name = 'Blessing Stores');
  perform public.note_place_visit(place_id);
  perform assert(
    not exists (select 1 from public.integrity_flags where kind = 'own_named_place'),
    'two visits are nothing yet');
  perform public.note_place_visit(place_id);
  perform public.note_place_visit(place_id);
  perform assert(
    (select count(*) from public.integrity_flags
     where kind = 'own_named_place' and user_id = grace and detail->>'place_id' = place_id::text) = 1,
    'a self-named place nobody else visits is flagged once');
  perform assert(
    (select only_namer_visits and visitor_count = 1 from public.known_place_detail where id = place_id),
    'and the Places page shows why');

  place_id := (select id from public.known_places where name = 'Mall Road Pharmacy');
  perform act_as(bala);
  perform public.note_place_visit(place_id);
  perform act_as(grace);
  perform public.note_place_visit(place_id);
  perform public.note_place_visit(place_id);
  perform public.note_place_visit(place_id);
  perform assert(
    not exists (select 1 from public.integrity_flags
                where kind = 'own_named_place' and detail->>'place_id' = place_id::text),
    'a place other staff visit too is not flagged');

  -- The daily limit still holds (4 staff names so far today).
  for i in 1..6 loop
    perform public.learn_place(6.40 + i * 0.01, 3.40, format('Shop %s', i), null, 'staff',
                               place_photo(format('shop-%s.jpg', i)));
  end loop;
  begin
    perform public.learn_place(6.30, 3.40, 'One too many', null, 'staff', place_photo('extra.jpg'));
    perform assert(false, 'nobody names more than 10 new places a day');
  exception when others then
    perform assert(sqlerrm like '%No more place names%', 'nobody names more than 10 new places a day');
  end;
  perform assert(
    public.learn_place(6.31, 3.40, 'Found by the map', null, 'google') is not null,
    'places named by a map are not limited, and need no photo');

  -- ---------------------------------------------------------------
  -- "My network was bad", "my phone was off" (migration 026).
  -- ---------------------------------------------------------------
  declare
    femi uuid := gen_random_uuid();
    got jsonb;
    again jsonb;
    anchor uuid;
    stamp text;
  begin
    insert into auth.users (id, email) values (femi, 'femi@xpel.ng');
    insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id)
    values (femi, 'Femi Ade', 'femi@xpel.ng', 'merchandiser', mall_id, tunde);

    -- No clock-in without notifications (027).
    perform act_as(femi);
    begin
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('opening', 6.6019, 3.3516, 12, fresh_photo('selfies', 'no-push.jpg'), now());
      perform assert(false, 'no clock-in with notifications off');
    exception when others then
      perform assert(sqlerrm like '%Turn on Xtend notifications%', 'no clock-in with notifications off');
    end;
    -- The server POSTs to these addresses, so only real push services (038).
    foreach used_path in array array[
      'https://example.com/made-up', 'http://127.0.0.1:5432/', 'http://169.254.169.254/latest',
      'https://fcm.googleapis.com@169.254.169.254/x', 'https://fcm.googleapis.com:8443/x'] loop
      begin
        insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
        values (femi, used_path, 'k', 'a');
        perform assert(false, 'a notification address that is not a push service is refused: ' || used_path);
      exception when check_violation then
        null;
      end;
    end loop;
    perform assert(not public.has_live_push(femi),
      'a notification address that is not a push service is refused, and does not count');
    update public.profiles set push_exempt = true, outlet_id = null where id = femi;
    perform assert(
      (select not push_exempt and outlet_id = mall_id from public.profiles where id = femi),
      'nobody excuses themselves, or moves their own store');
    perform act_as(boss);
    update public.profiles set push_exempt = true where id = femi;
    perform assert((select push_exempt from public.profiles where id = femi),
      'an admin can excuse a phone that cannot take notifications');
    update public.profiles set push_exempt = false where id = femi;
    perform notifications_on(femi);
    perform assert(public.has_live_push(femi), 'a real phone subscription counts');
    -- The Android and iOS apps register their own push token (033).
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'app@xpel.ng');
    insert into public.profiles (id, full_name, email, role, outlet_id)
    values ('00000000-0000-4000-8000-0000000000a1', 'App User', 'app@xpel.ng', 'merchandiser', mall_id);
    begin
      insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
      values ('00000000-0000-4000-8000-0000000000a1', 'native-fcm:short', 'native', 'native');
      perform assert(false, 'a made-up app token is refused');
    exception when check_violation then
      perform assert(not public.has_live_push('00000000-0000-4000-8000-0000000000a1'),
        'a made-up app token is refused, and does not count');
    end;
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('00000000-0000-4000-8000-0000000000a1',
            'native-apns:' || repeat('a1b2c3d4', 8), 'native', 'native');
    perform assert(public.has_live_push('00000000-0000-4000-8000-0000000000a1'),
      'a token from the iPhone app counts as notifications on');

    perform act_as(femi);
    got := public.record_beacon(jsonb_build_object('reason', 'open', 'battery_pct', 81,
      'charging', false, 'outbox_count', 0, 'device_time', now(), 'lat', 6.6019, 'lng', 3.3516,
      'connection', '4g'));
    perform assert(got->>'id' is not null and got->>'server_time' is not null,
      'the phone reports in and is given the server''s time');
    again := public.record_beacon(jsonb_build_object('reason', 'open', 'battery_pct', 'rubbish'));
    perform assert(again->>'id' = got->>'id', 'a burst of reports is one report');
    perform assert(
      (select battery_pct = 81 and lat is not null and connection = '4g'
       from public.device_beacons where id = (got->>'id')::uuid),
      'battery, place and network are recorded');

    -- Judging times, with the server's "now" fixed.
    delete from public.device_beacons where user_id = femi;
    perform assert(
      public.clock_timing(femi, now() - interval '20 seconds',
        jsonb_build_object('sent_at', now()), now())->>'verdict' = 'live',
      'sent as it was taken: live');
    perform assert(
      public.clock_timing(femi, now() + interval '2 hours',
        jsonb_build_object('sent_at', now() + interval '2 hours 10 seconds'), now())->>'verdict'
        = 'phone_clock_wrong',
      'a phone clock two hours out is caught');
    perform assert(
      public.clock_timing(femi, now() - interval '2 hours',
        jsonb_build_object('sent_at', now()), now())->>'verdict' = 'offline_unproven',
      'offline, with nothing heard from the phone at all: unproven');

    insert into public.device_beacons (user_id, received_at, reason, outbox_count)
    values (femi, now() - interval '3 hours', 'interval', 0) returning id into anchor;
    perform assert(
      public.clock_timing(femi, now() - interval '2 hours',
        jsonb_build_object('sent_at', now(), 'anchor_beacon', anchor), now())->>'verdict'
        = 'offline_confirmed',
      'last heard at 3 hours ago, taken 2 hours ago, silent since: a real network gap');

    insert into public.device_beacons (user_id, received_at, reason, outbox_count)
    values (femi, now() - interval '1 hour', 'visible', 1) returning id into anchor;
    got := public.clock_timing(femi, now() - interval '2 hours',
      jsonb_build_object('sent_at', now(), 'anchor_beacon', anchor), now());
    perform assert(got->>'verdict' = 'backdated' and got->>'how' = 'anchor',
      'claimed 2 hours ago, but the phone had been in touch an hour ago before taking it: faked time');
    perform assert(
      public.clock_timing(femi, now() - interval '2 hours',
        jsonb_build_object('sent_at', now()), now())->>'verdict' = 'network_was_available',
      'the phone had network an hour ago, with the clock-in waiting: sent late on purpose');

    insert into public.device_beacons (user_id, received_at, reason, outbox_count)
    values (femi, now() - interval '30 minutes', 'visible', 0);
    got := public.clock_timing(femi, now() - interval '2 hours',
      jsonb_build_object('sent_at', now()), now());
    perform assert(got->>'verdict' = 'backdated' and got->>'how' = 'nothing_waiting',
      'the phone said nothing was waiting half an hour ago: the clock-in was made later');

    -- The real thing: the verdict is stored and flagged.
    -- The phone's clock set 3 hours back (ahead is refused outright).
    stamp := (now() - interval '3 hours')::text;
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at, device_info)
    values ('opening', 6.6019, 3.3516, 12, fresh_photo('selfies', 'femi.jpg'), now() - interval '3 hours',
            jsonb_build_object('sent_at', stamp))
    returning id into attendance_id;
    perform assert(
      (select time_verdict from public.attendance where id = attendance_id) = 'phone_clock_wrong',
      'a clock-in from a phone with its clock changed is marked');
    perform assert(
      (select summary like '%180 minutes behind%' from public.integrity_flags
       where kind = 'phone_clock_wrong' and user_id = femi),
      'and flagged, saying by how much');

    -- A supervisor checks "my phone was off" for the last two hours.
    perform act_as(tunde);
    got := public.check_excuse(femi, now() - interval '2 hours 30 minutes', now() + interval '1 minute');
    perform assert(jsonb_array_length(got->'contacts') >= 3,
      'the check lists every time the phone was heard from');
    perform assert(got->'before'->>'at' is not null and (got->>'has_push')::boolean,
      'with the last report before the gap, and whether the phone can be pushed');

    -- The advanced check (048): every position with its accuracy and store
    -- distance, location problems, refused photos, work kept waiting.
    got := public.check_excuse_more(femi, now() - interval '2 days', now() + interval '1 minute');
    perform assert(exists (select 1 from jsonb_array_elements(got->'positions') p where p->>'source' = 'clock_in')
                   and got ? 'location_problems' and got ? 'photos_refused' and got ? 'queued' and got ? 'stores',
      'excuse: the advanced check lists positions, location problems, refused photos and queued work');
    perform assert((got->'queued'->>'most')::int >= 1, 'excuse: work kept waiting on the phone shows');
    perform assert(jsonb_typeof(public.check_excuse(femi, now() - interval '2 days', now())) = 'object',
      'excuse: a window of two days can be checked');
    begin
      perform public.check_excuse_more(femi, now() - interval '4 days', now());
      perform assert(false, 'excuse: windows are at most three days');
    exception when others then
      perform assert(sqlerrm like '%up to 3 days%', 'excuse: windows are at most three days');
    end;
    perform public.record_excuse_check(femi, 'phone_off', now() - interval '2 hours', now(), 'false',
      'Not true: the phone was on.', 'Told her we checked');
    perform assert((select count(*) from public.excuse_check_detail where user_id = femi and checked_by = tunde
                    and verdict = 'false' and note = 'Told her we checked') = 1,
      'excuse: a check is kept with its verdict, who checked, and a note');
    perform act_as(ada);
    begin
      perform public.record_excuse_check(femi, 'no_network', now() - interval '1 hour', now(), 'fits', 'x', null);
      perform assert(false, 'excuse: staff cannot keep checks on each other');
    exception when others then
      perform assert(sqlerrm like '%own team%', 'excuse: staff cannot keep checks on each other');
    end;
    begin
      perform public.check_excuse(femi, now() - interval '1 hour', now());
      perform assert(false, 'staff cannot check each other');
    exception when others then
      perform assert(sqlerrm like '%own team%', 'staff cannot check each other');
    end;
    begin
      perform public.request_phone_check(femi);
      perform assert(false, 'nor push each other''s phones');
    exception when others then
      perform assert(sqlerrm like '%own team%', 'nor push each other''s phones');
    end;
    perform act_as(tunde);
    anchor := public.request_phone_check(femi);
    perform assert(anchor is not null and public.request_phone_check(femi) = anchor,
      'a supervisor checks a team member''s phone, once at a time');

    -- Following Femi's day on a map (migration 028).
    perform act_as(femi);
    insert into public.location_pings (lat, lng, accuracy_m) values (6.6100, 3.3600, 15);
    perform public.record_beacon(jsonb_build_object('reason', 'visible', 'lat', 6.6050, 'lng', 3.3550));
    perform act_as(tunde);
    got := public.movement_trail(femi, public.business_date());
    perform assert(got->'person'->>'name' = 'Femi Ade'
                   and jsonb_array_length(got->'points') >= 3,
      'a supervisor sees a team member''s day: clock-in, location checks, phone reports');
    perform assert(
      (select bool_and(a <= b) from (
         select (e->>'at')::timestamptz as a,
                lead((e->>'at')::timestamptz) over (order by ord) as b
         from jsonb_array_elements(got->'points') with ordinality x(e, ord)) t where b is not null),
      'in time order');
    perform assert(
      exists (select 1 from jsonb_array_elements(got->'points') e where e->>'kind' = 'clock_in')
      and exists (select 1 from jsonb_array_elements(got->'stores') s where s->>'name' = 'Ikeja City Mall'),
      'with the clock-in and their store''s geofence');
    -- Positions kept while offline, sent on reconnect (migration 029).
    perform act_as(femi);
    alert_count := (select count(*) from public.location_alerts where user_id = femi);
    perform assert(
      public.record_offline_pings(jsonb_build_array(
        jsonb_build_object('lat', 6.7000, 'lng', 3.4000, 'accuracy_m', 12, 'captured_at', now() - interval '25 minutes'),
        jsonb_build_object('lat', 6.7001, 'lng', 3.4001, 'accuracy_m', 12, 'captured_at', now() - interval '20 minutes')),
        now()) = 2,
      'positions saved offline are kept when the phone reconnects');
    perform assert(
      (select count(*) from public.location_pings
       where user_id = femi and offline and received_at is not null
         and created_at between now() - interval '26 minutes' and now() - interval '19 minutes') = 2,
      'at the time they were taken, marked as sent late');
    perform assert(
      (select count(*) from public.location_alerts where user_id = femi) = alert_count,
      'an hour-old "left the store" raises no alert now');
    perform assert(
      public.record_offline_pings(jsonb_build_array(
        jsonb_build_object('lat', 6.7000, 'lng', 3.4000, 'accuracy_m', 12, 'captured_at', now() - interval '25 minutes')),
        now()) = 0,
      'a resend after a dropped connection is not stored twice');
    counted := public.record_offline_pings(jsonb_build_array(
        jsonb_build_object('lat', 6.7002, 'lng', 3.4002, 'accuracy_m', 12,
                           'captured_at', now() - interval '2 hours 15 minutes')),
        now() - interval '2 hours');
    perform assert(
      counted = 1
      and exists (select 1 from public.location_pings where user_id = femi and offline
                  and created_at between now() - interval '16 minutes' and now() - interval '14 minutes'),
      'a phone clock two hours behind is corrected');
    perform assert(
      public.record_offline_pings(jsonb_build_array(
        jsonb_build_object('lat', 6.7, 'lng', 3.4, 'accuracy_m', 12, 'captured_at', now() - interval '25 hours')),
        now()) = 0,
      'nothing older than a day');
    -- (Each call is its own statement: a check in the same statement would
    -- not yet see what the call wrote.)
    counted := public.record_offline_pings(jsonb_build_array(
        jsonb_build_object('lat', 6.7003, 'lng', 3.4003, 'accuracy_m', 12, 'captured_at', now() - interval '50 minutes')),
        now());
    perform assert(
      counted = 0
      and exists (select 1 from public.integrity_flags where user_id = femi and kind = 'backdated_clock'
                  and detail->>'source' = 'offline_positions'),
      'positions from before the phone said nothing was waiting are refused and flagged');
    perform act_as(tunde);
    got := public.check_excuse(femi, now() - interval '26 minutes', now() - interval '10 minutes');
    perform assert(
      jsonb_array_length(got->'offline_positions') = 3
      and not exists (select 1 from jsonb_array_elements(got->'contacts') c where c->>'what' = 'location'),
      'for an excuse, offline positions show the phone was on, not that it had network');
    perform assert(
      -- The day the offline positions were taken, which just after
      -- midnight is yesterday.
      exists (select 1 from jsonb_array_elements(public.movement_trail(femi,
                (now() at time zone 'Africa/Lagos' - interval '15 minutes')::date)->'points') e
              where e->>'kind' = 'location_offline'),
      'the route marks positions that were saved offline');

    perform act_as(ada);
    begin
      perform public.movement_trail(femi, public.business_date());
      perform assert(false, 'staff cannot follow each other');
    exception when others then
      perform assert(sqlerrm like '%own team%', 'staff cannot follow each other');
    end;
    perform act_as(tunde);
  end;

  -- Profile photos and onboarding (037).
  declare
    kemi uuid := gen_random_uuid();
    yemi uuid := gen_random_uuid();
  begin
    insert into auth.users (id, email) values (kemi, 'photo-kemi@xpel.ng'), (yemi, 'photo-yemi@xpel.ng');
    insert into public.profiles (id, full_name, email, role, supervisor_id)
    values (kemi, 'Kemi', 'photo-kemi@xpel.ng', 'merchandiser', tunde),
           (yemi, 'Yemi', 'photo-yemi@xpel.ng', 'merchandiser', tunde);
    insert into storage.objects (bucket_id, name)
    values ('avatars', kemi::text || '/me.jpg'), ('avatars', yemi::text || '/yemi.jpg');

    perform act_as(kemi);
    begin
      perform public.set_my_avatar(yemi::text || '/yemi.jpg');
      perform assert(false, 'nobody can use someone else''s photo');
    exception when others then
      perform assert(sqlerrm like '%not yours%', 'nobody can use someone else''s photo');
    end;
    begin
      perform public.set_my_avatar(kemi::text || '/missing.jpg');
      perform assert(false, 'a photo must be uploaded before it is used');
    exception when others then
      perform assert(sqlerrm like '%Upload the photo first%', 'a photo must be uploaded before it is used');
    end;
    perform public.set_my_avatar(kemi::text || '/me.jpg');
    perform public.finish_onboarding();
    perform set_config('xtend.own_photo', '', true);
    update public.profiles set avatar_path = yemi::text || '/yemi.jpg' where id = kemi;
    perform act_as(tunde);

    perform assert((select avatar_path from public.profiles where id = kemi) = kemi::text || '/me.jpg',
      'a person''s photo changes only through set_my_avatar');
    perform assert((select onboarded_at from public.profiles where id = kemi) is not null,
      'finishing onboarding is remembered');
  end;

  -- Every flag kind the triggers and the attendance route raise is allowed.
  declare
    def text := (select pg_get_constraintdef(oid) from pg_constraint
                 where conname = 'integrity_flags_kind_check');
    k text;
  begin
    foreach k in array array['selfie_at_home', 'own_named_place', 'backdated_clock',
      'late_sync_with_network', 'photo_rejected', 'vpn_suspected', 'mock_location_confirmed',
      'device_integrity_failed'] loop
      perform assert(def like '%''' || k || '''%', 'flag kind ' || k || ' is allowed');
    end loop;
  end;

  -- ---------------------------------------------------------------
  -- Stores waiting for their location, pinned from clock-ins (034).
  -- ---------------------------------------------------------------
  declare
    kemi    uuid := gen_random_uuid();
    ope     uuid := gen_random_uuid();
    tayo    uuid := gen_random_uuid();
    pinned  uuid;
    waiting uuid;
    other   uuid;
    spot    uuid;
    rec     record;
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values
      (kemi, 'kemi@xpel.ng'), (ope, 'ope@xpel.ng'), (tayo, 'tayo@xpel.ng');
    insert into public.outlets (name, lat, lng, geofence_radius_m)
    values ('Jendol Badagry', 6.4150, 2.8800, 150) returning id into pinned;
    insert into public.outlets (name) values ('Justrite Badagry') returning id into waiting;
    insert into public.outlets (name) values ('Market Square Badagry') returning id into other;
    perform assert(
      (select lat is null from public.outlets where id = waiting),
      'a store can be added before its location is known');
    begin
      insert into public.outlets (name, lat) values ('Half a location', 6.4);
      perform assert(false, 'a store has both coordinates or neither');
    exception when check_violation then
      perform assert(true, 'a store has both coordinates or neither');
    end;

    insert into public.profiles (id, full_name, email, role, outlet_id) values
      (kemi, 'Kemi Shabi',  'kemi@xpel.ng', 'merchandiser', pinned),
      (ope,  'Ope Ojo',     'ope@xpel.ng',  'merchandiser', other),
      (tayo, 'Tayo Bello',  'tayo@xpel.ng', 'merchandiser', waiting);
    insert into public.staff_outlets (user_id, outlet_id) values (kemi, waiting);
    perform notifications_on(kemi);
    perform notifications_on(ope);
    perform notifications_on(tayo);

    -- Kemi clocks in 2 km from her pinned store: she may be in the other.
    perform act_as(kemi);
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.4300, 2.8950, 12, fresh_photo('selfies', 'kemi-1.jpg'), now())
    returning status, outlet_id, distance_m into rec;
    perform assert(rec.status is null and rec.outlet_id is null and rec.distance_m is null,
      'away from the pinned store, with a store waiting for its location: not measured');
    perform assert(
      not exists (select 1 from public.location_alerts where user_id = kemi),
      'a clock-in that was not measured raises no alert');
    select id into spot from public.known_places
    where source = 'clock_in' and waiting = any(store_candidates);
    perform assert(spot is not null,
      'the spot is kept as a place that could be the waiting store');
    perform assert(
      not (select pinned = any(store_candidates) from public.known_places where id = spot),
      'only waiting stores are offered for it');

    -- Inside her pinned store she is measured as usual.
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 6.4151, 2.8801, 12, fresh_photo('selfies', 'kemi-2.jpg'), now())
    returning status, outlet_id into rec;
    perform assert(rec.status = 'on_site' and rec.outlet_id = pinned,
      'inside a pinned store, somebody with a waiting store is still on site');

    -- A rough fix teaches nothing.
    perform act_as(ope);
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.5000, 2.9500, 80, fresh_photo('selfies', 'ope-1.jpg'), now());
    perform assert(
      not exists (select 1 from public.known_places where other = any(store_candidates)),
      'a clock-in with a rough fix is not kept as a possible store location');
    -- A good one at Kemi's spot joins it.
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('closing', 6.43001, 2.89501, 10, fresh_photo('selfies', 'ope-2.jpg'), now());
    select * into rec from public.known_places where id = spot;
    perform assert(other = any(rec.store_candidates) and cardinality(rec.visitors) = 2,
      'a second person at the same spot joins the same place, with their stores');

    -- Store visits and counts cannot be measured against a waiting store.
    perform act_as(grace);
    update public.store_visits set status = 'closed', departed_at = now() where user_id = grace and status = 'open';
    insert into public.store_visits
      (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at, selfie_path)
    values (waiting, 6.43, 2.895, 12, now(), fresh_photo('selfies', 'grace-w.jpg'))
    returning arrived_status into rec;
    perform assert(rec.arrived_status is null,
      'a visit to a store waiting for its location is neither on nor off site');

    -- Only an admin confirms which store a spot is.
    perform act_as(kemi);
    begin
      perform public.pin_store_from_place(spot, waiting);
      perform assert(false, 'staff cannot pin a store');
    exception when others then
      perform assert(sqlerrm like '%Only an admin%', 'staff cannot pin a store');
    end;
    perform act_as(boss);
    perform public.pin_store_from_place(spot, waiting);
    select * into rec from public.outlets where id = waiting;
    perform assert(abs(rec.lat - 6.4300) < 0.00001 and abs(rec.lng - 2.8950) < 0.00001,
      'a confirmed spot becomes the store''s location');
    perform assert(not exists (select 1 from public.known_places where id = spot),
      'the place goes once the store names the spot');
    begin
      insert into public.known_places (name, lat, lng, source, store_candidates)
      values ('Another spot', 6.46, 2.92, 'clock_in', array[waiting]);
      perform public.pin_store_from_place(
        (select id from public.known_places where name = 'Another spot'), waiting);
      perform assert(false, 'a pinned store is not re-pinned from a place');
    exception when others then
      perform assert(sqlerrm like '%already has a location%', 'a pinned store is not re-pinned from a place');
    end;

    -- From then on the store is measured normally.
    perform act_as(tayo);
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.4301, 2.8951, 12, fresh_photo('selfies', 'tayo-1.jpg'), now())
    returning status, outlet_id into rec;
    perform assert(rec.status = 'on_site' and rec.outlet_id = waiting,
      'once pinned, clock-ins at the store are on site');
    perform act_as(boss);
  end;

  -- ---------------------------------------------------------------
  -- Paper count sheets (035).
  -- ---------------------------------------------------------------
  declare
    sade     uuid := gen_random_uuid();
    shop     uuid;
    other    uuid;
    req_id   uuid;
    sheet    uuid;
    prog     record;
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values (sade, 'sade@xpel.ng');
    insert into public.outlets (name, lat, lng) values ('Sade Shop', 6.5, 3.6) returning id into shop;
    insert into public.outlets (name, lat, lng) values ('Not Sade''s', 6.51, 3.61) returning id into other;
    insert into public.profiles (id, full_name, email, role, outlet_id)
    values (sade, 'Sade Ade', 'sade@xpel.ng', 'merchandiser', shop);
    insert into storage.buckets (id, name) values ('reports', 'reports') on conflict do nothing;

    perform act_as(sade);
    insert into storage.objects (bucket_id, name, metadata) values
      ('reports', sade || '/sheet-1.pdf', '{"mimetype":"application/pdf","size":120000}'),
      ('reports', sade || '/sheet-2.txt', '{"mimetype":"text/plain","size":100}'),
      ('reports', sade || '/sheet-3.pdf', '{"mimetype":"application/pdf","size":20000000}'),
      ('reports', bala || '/not-mine.pdf', '{"mimetype":"application/pdf","size":100}');

    -- A sheet nobody asked for is kept since 0064 (sent from the profile);
    -- see "Count sheets from the profile" near the end.

    perform act_as(boss);
    req_id := public.request_store_count(array[sade], public.business_date() + 1, null);
    perform act_as(sade);

    begin
      perform public.submit_count_sheet(other, sade || '/sheet-1.pdf', 'count.pdf');
      perform assert(false, 'a sheet for somebody else''s store is refused');
    exception when others then
      perform assert(sqlerrm like '%not one of yours%', 'a sheet for somebody else''s store is refused');
    end;
    begin
      perform public.submit_count_sheet(shop, bala || '/not-mine.pdf', 'count.pdf');
      perform assert(false, 'a file from somebody else''s folder is refused');
    exception when others then
      perform assert(sqlerrm like '%Upload the filled count sheet again%', 'a file from somebody else''s folder is refused');
    end;
    begin
      perform public.submit_count_sheet(shop, sade || '/sheet-2.txt', 'count.txt');
      perform assert(false, 'only the Excel sheet, a PDF or a photo is accepted');
    exception when others then
      perform assert(sqlerrm like '%as the Excel file, a PDF%', 'only the Excel sheet, a PDF or a photo is accepted');
    end;
    begin
      perform public.submit_count_sheet(shop, sade || '/sheet-3.pdf', 'big.pdf');
      perform assert(false, 'a file over 10 MB is refused');
    exception when others then
      perform assert(sqlerrm like '%smaller than 10 MB%', 'a file over 10 MB is refused');
    end;

    sheet := public.submit_count_sheet(shop, sade || '/sheet-1.pdf', E'my\ncount.pdf');
    select * into prog from public.store_count_sheets where id = sheet;
    perform assert(prog.user_id = sade and prog.request_id = req_id and prog.size_bytes = 120000
                   and prog.content_type = 'application/pdf' and prog.file_name = 'my count.pdf',
      'a filled sheet is kept against the request, with its type and size from storage');
    select * into prog from public.count_request_progress where id = req_id;
    perform assert(prog.counted = 1 and cardinality(prog.waiting_on) = 0,
      'sending a sheet counts as having counted');
    begin
      perform public.submit_count_sheet(shop, sade || '/sheet-1.pdf', 'again.pdf');
      perform assert(false, 'the same file cannot be sent twice');
    exception when others then
      perform assert(sqlerrm like '%already been sent%', 'the same file cannot be sent twice');
    end;

    -- The Xpel sheet comes back as the Excel file it was downloaded as (040).
    perform act_as(sade);
    insert into storage.objects (bucket_id, name, metadata) values
      ('reports', sade || '/sheet-4.xlsx',
       '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":30000}');
    sheet := public.submit_count_sheet(shop, sade || '/sheet-4.xlsx', 'Xpel stock count.xlsx');
    perform assert(
      (select content_type from public.store_count_sheets where id = sheet)
        = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'a filled Excel count sheet is accepted');

    -- The blank sheet comes from an admin, as a PDF.
    insert into storage.objects (bucket_id, name, metadata) values
      ('reports', sade || '/template.pdf', '{"mimetype":"application/pdf","size":5000}');
    begin
      perform public.set_count_sheet_template(sade || '/template.pdf', 'Xpel count sheet.pdf');
      perform assert(false, 'only an admin sets the count sheet');
    exception when others then
      perform assert(sqlerrm like '%Only an admin%', 'only an admin sets the count sheet');
    end;
    perform act_as(boss);
    insert into storage.objects (bucket_id, name, metadata) values
      ('reports', boss || '/template.pdf', '{"mimetype":"application/pdf","size":5000}'),
      ('reports', boss || '/template.docx', '{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":5000}');
    begin
      perform public.set_count_sheet_template(boss || '/template.docx', 'sheet.docx');
      perform assert(false, 'the count sheet must be a PDF');
    exception when others then
      perform assert(sqlerrm like '%must be a PDF%', 'the count sheet must be a PDF');
    end;
    begin
      perform public.set_count_sheet_template(sade || '/template.pdf', 'sheet.pdf');
      perform assert(false, 'an admin uploads the sheet from their own folder');
    exception when others then
      perform assert(sqlerrm like '%Upload the count sheet again%', 'an admin uploads the sheet from their own folder');
    end;
    perform public.set_count_sheet_template(boss || '/template.pdf', 'Xpel count sheet.pdf');
    perform assert(
      (select file_name from public.count_sheet_templates order by created_at desc limit 1) = 'Xpel count sheet.pdf',
      'an admin''s PDF becomes the count sheet staff download');
  end;

  -- ---------------------------------------------------------------
  -- Supervisors hear about it (036).
  -- ---------------------------------------------------------------
  declare
    lola     uuid := gen_random_uuid();
    lead     uuid := gen_random_uuid();
    stranger uuid := gen_random_uuid();
    early    uuid;
    far      uuid;
    local_now time := (now() at time zone 'Africa/Lagos')::time;
    claimed  integer;
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values
      (lola, 'lola@xpel.ng'), (lead, 'lead@xpel.ng'), (stranger, 'stranger@xpel.ng');
    insert into public.outlets (name, lat, lng) values ('Lead''s own store', 6.2, 3.2) returning id into far;
    insert into public.outlets (name, lat, lng, shift_start, shift_end)
    values ('Lola Store', 6.3, 3.3, '08:00', '18:00') returning id into early;
    insert into public.profiles (id, full_name, email, role, outlet_id) values
      (lead, 'Lead Supervisor', 'lead@xpel.ng', 'supervisor', far),
      (stranger, 'Other Supervisor', 'stranger@xpel.ng', 'supervisor', far);
    insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id)
    values (lola, 'Lola Bello', 'lola@xpel.ng', 'merchandiser', early, lead);
    update public.profiles set outlet_id = null where id = stranger;
    perform notifications_on(lola);

    perform assert(
      exists (select 1 from public.alert_watchers(lola) w where w.user_id = lead),
      'a supervisor is told about their team, even from another store');
    perform assert(
      not exists (select 1 from public.alert_watchers(lola) w where w.user_id = stranger),
      'a supervisor is not told about somebody else''s team');
    perform assert(
      exists (select 1 from public.alert_watchers(lola) w where w.user_id = boss),
      'admins are always told');

    perform assert(
      not exists (select 1 from public.claim_flag_alerts(200) c where c.created_at < now() - interval '1 minute'),
      'flags from before alerts were pushed are not sent now');

    -- Late: the shift started 40 minutes ago. (Skipped just after
    -- midnight, when "40 minutes ago" was yesterday.)
    if local_now > '01:30' and local_now < '22:00' then
      update public.outlets
      set shift_start = (local_now - interval '40 minutes')::time,
          shift_end = (local_now + interval '30 minutes')::time
      where id = early;
      perform act_as(lola);
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('opening', 6.3, 3.3, 10, fresh_photo('selfies', 'lola-1.jpg'), now());
      perform assert(
        exists (select 1 from public.integrity_flags
                where user_id = lola and kind = 'late_clock_in' and severity = 'medium'
                  and summary like 'Clocked in % min late at Lola Store%'),
        'clocking in 40 minutes after the shift starts is flagged');
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('closing', 6.3, 3.3, 10, fresh_photo('selfies', 'lola-2.jpg'), now());
      perform assert(
        exists (select 1 from public.integrity_flags
                where user_id = lola and kind = 'early_clock_out' and summary like 'Clocked out % min early at Lola Store%'),
        'clocking out 30 minutes before the shift ends is flagged');

      perform act_as(boss);
      select count(*) into claimed from public.claim_flag_alerts(200) c where c.user_id = lola;
      perform assert(claimed = 2, 'each new flag is handed over to be sent');
      select count(*) into claimed from public.claim_flag_alerts(200) c where c.user_id = lola;
      perform assert(claimed = 0, 'and only once');
    end if;

    -- On time is not flagged.
    perform act_as(boss);
    delete from public.attendance where user_id = lola;
    update public.outlets set shift_start = '00:00', shift_end = '23:59' where id = early;
    delete from public.integrity_flags where user_id = lola;
    perform act_as(lola);
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.3, 3.3, 10, fresh_photo('selfies', 'lola-3.jpg'),
            (date_trunc('day', now() at time zone 'Africa/Lagos') + interval '5 minutes') at time zone 'Africa/Lagos');
    perform assert(
      not exists (select 1 from public.integrity_flags where user_id = lola and kind = 'late_clock_in'),
      'clocking in within the grace period is not flagged');
    perform act_as(boss);

    -- ---------------------------------------------------------------
    -- The Xpel stock count sheet (040).
    -- ---------------------------------------------------------------
    perform assert(
      (select count(*) from public.products where sheet_order is not null) = 233,
      'the products on the Xpel count sheet are the list to count');
    perform assert(
      (select barcode from public.products where name = 'Argan oil conditioner') = '5060120164087',
      'sheet products carry their barcode');

    perform public.request_store_count(array[lola], public.business_date() + 1, 'Sheet count');
    perform act_as(lola);
    perform count_here(early, jsonb_build_array(
      jsonb_build_object('product_name', 'Argan oil conditioner', 'back_store', 4, 'shop_floor', 6,
                         'sold', 2, 'expiry_date', '2027-03-31'),
      jsonb_build_object('product_name', 'argan  OIL shampoo (12''s)', 'shop_floor', 3),
      jsonb_build_object('product_name', 'A product not on the sheet', 'in_store', 5, 'sold', 1)));
    perform assert(
      (select in_store = 10 and back_store = 4 and shop_floor = 6 and sold = 2
              and expiry_date = date '2027-03-31'
       from public.store_count_detail
       where user_id = lola and product_name = 'Argan oil conditioner'),
      'a sheet line keeps back store, shop floor and expiry, and its total is what is in the store');
    perform assert(
      (select in_store = 3 and back_store is null and sold = 0
       from public.store_count_detail
       where user_id = lola and product_name = 'Argan oil shampoo (12''s)'),
      'a sheet product typed differently lands on the sheet product, and a blank figure is not counted');
    perform assert(
      (select in_store = 5 and back_store is null and barcode is null
       from public.store_count_detail
       where user_id = lola and product_name = 'A product not on the sheet'),
      'a product off the sheet can still be counted the old way');

    begin
      perform count_here(early, jsonb_build_array(
        jsonb_build_object('product_name', 'Argan oil conditioner', 'back_store', 1.5, 'shop_floor', 1)));
      perform assert(false, 'half units are refused');
    exception when others then
      perform assert(sqlerrm like '%whole numbers%', 'half units are refused');
    end;
    begin
      perform count_here(early, jsonb_build_array(
        jsonb_build_object('product_name', 'Argan oil conditioner', 'sold', 1)));
      perform assert(false, 'a line with nothing counted is refused');
    exception when others then
      perform assert(sqlerrm like '%whole numbers%', 'a line with nothing counted is refused');
    end;
    begin
      perform count_here(early, jsonb_build_array(
        jsonb_build_object('product_name', 'Argan oil conditioner', 'back_store', 1, 'expiry_date', 'next year')));
      perform assert(false, 'an expiry date that is not a date is refused');
    exception when others then
      perform assert(sqlerrm like '%real dates%', 'an expiry date that is not a date is refused');
    end;
    perform act_as(boss);

    -- ---------------------------------------------------------------
    -- Temporary passwords for the login sheet (041).
    -- ---------------------------------------------------------------
    insert into public.staff_temp_passwords (user_id, password) values (lola, 'ABC-2345-DEF');
    update public.profiles set must_change_password = true where id = lola;
    perform assert(
      (select password from public.staff_temp_passwords where user_id = lola) = 'ABC-2345-DEF',
      'a temporary password is kept while the person still has to change it');
    perform act_as(lola);
    update public.profiles set must_change_password = false where id = lola;
    perform act_as(boss);
    perform assert(
      (select password is null from public.staff_temp_passwords where user_id = lola),
      'choosing their own password clears the temporary one');
  end;

  -- ---------------------------------------------------------------
  -- What each field accepts (039).
  -- ---------------------------------------------------------------
  declare
    bad text;
  begin
    perform act_as(boss);
    foreach bad in array array['Chidi123', 'a', 'http://spam.com', '.....'] loop
      begin
        update public.profiles set full_name = bad where id = bala;
        perform assert(false, 'a name that is not a name is refused: ' || bad);
      exception when check_violation then null;
      end;
    end loop;
    update public.profiles set full_name = 'Bala Yusuf-Ade' where id = bala;
    perform assert((select full_name from public.profiles where id = bala) = 'Bala Yusuf-Ade',
      'names with letters, spaces and hyphens are taken; others are refused');

    foreach bad in array array['12345', '+2348031234567', '08031234567000', 'call me'] loop
      begin
        update public.profiles set phone = bad where id = bala;
        perform assert(false, 'a phone that is not a mobile number is refused: ' || bad);
      exception when check_violation then null;
      end;
    end loop;
    update public.profiles set phone = '08031234567' where id = bala;
    perform assert((select phone from public.profiles where id = bala) = '08031234567',
      'a mobile number is kept as 0803…; anything else is refused');

    perform assert(public.text_is_clean('Sold 40 tubs, shampoo low.'), 'plain text is clean');
    perform assert(not public.text_is_clean('Promo at www.cheap.ng'), 'a link is not');
    perform assert(not public.text_is_clean('buy now at deals.xyz'), 'nor is a bare domain');
    perform assert(not public.text_has_words('ok', 10), 'two letters is not a report section');
    perform assert(not public.text_has_words('..............', 10), 'nor are dots');
    perform assert(not public.text_has_words('aaaaaaaaaaaaa', 10), 'nor one key held down');
    perform assert(public.text_has_words('All in stock today', 10), 'a short real sentence is');

    -- ---------------------------------------------------------------
    -- Roles an admin adds (042).
    -- ---------------------------------------------------------------
    declare
      ar uuid;
      promo uuid;
      lola uuid := gen_random_uuid();
    begin
      perform act_as(boss);
      insert into auth.users (id, email) values (lola, 'roles-test@xpel.ng');
      insert into public.profiles (id, full_name, email, role) values (lola, 'Role Tester', 'roles-test@xpel.ng', 'merchandiser');
      insert into public.staff_roles (name, base_role) values ('Account Receivable', 'merchandiser') returning id into ar;
      insert into public.staff_roles (name, base_role) values ('Promoter', 'marketer') returning id into promo;
      begin
        insert into public.staff_roles (name, base_role) values ('account  receivable', 'marketer');
        perform assert(false, 'two roles cannot share a name');
      exception when unique_violation then
        perform assert(true, 'two roles cannot share a name');
      end;
      begin
        insert into public.staff_roles (name, base_role) values ('Admins', 'supervisor');
        perform assert(false, 'an added role cannot take a built-in name');
      exception when check_violation then
        perform assert(true, 'an added role cannot take a built-in name');
      end;
      begin
        insert into public.staff_roles (name, base_role) values ('Boss', 'admin');
        perform assert(false, 'an added role cannot work like an admin');
      exception when check_violation then
        perform assert(true, 'an added role cannot work like an admin');
      end;

      update public.profiles set staff_role_id = promo where id = lola;
      perform assert((select role = 'marketer' from public.profiles where id = lola),
        'giving someone an added role gives them its base role');
      update public.profiles set role = 'merchandiser' where id = lola;
      perform assert((select staff_role_id is null and role = 'merchandiser' from public.profiles where id = lola),
        'changing the role on its own clears the added role');
      update public.profiles set staff_role_id = ar where id = lola;

      perform act_as(lola);
      update public.profiles set staff_role_id = promo where id = lola;
      perform assert((select staff_role_id = ar and role = 'merchandiser' from public.profiles where id = lola),
        'nobody changes their own added role');
      perform act_as(boss);
    end;
    -- ---------------------------------------------------------------
    -- X Metrics (043): supplies, counts, sales, reconciliation,
    -- expiry and grades.
    -- ---------------------------------------------------------------
    declare
      kem    uuid := gen_random_uuid();
      shop   uuid;
      oil    uuid;
      gel    uuid;
      c1     uuid;
      c2     uuid;
      s1     uuid;
      s2     uuid;
      sup    uuid;
      d1     date := ((now() - interval '50 hours') at time zone 'Africa/Lagos')::date;
      d2     date := ((now() - interval '26 hours') at time zone 'Africa/Lagos')::date;
      g      jsonb;
      rec    record;
    begin
      perform act_as(boss);
      insert into auth.users (id, email) values (kem, 'xm-test@xpel.ng');
      insert into public.outlets (name, lat, lng, geofence_radius_m)
      values ('XM Test Store', 6.5000, 3.3000, 100) returning id into shop;
      insert into public.profiles (id, full_name, email, role, outlet_id)
      values (kem, 'Kemi Adebayo', 'xm-test@xpel.ng', 'merchandiser', shop);
      insert into public.products (name, sku, category, unit) values ('XM Body Oil', 'XM-OIL', 'Body', 'bottle')
      returning id into oil;
      insert into public.products (name, sku, category, unit) values ('XM Hair Gel', 'XM-GEL', 'Hair', 'tub')
      returning id into gel;
      begin
        insert into public.products (name, sku) values ('XM Other', 'xm-oil');
        perform assert(false, 'xm: two products cannot share a SKU');
      exception when unique_violation then
        perform assert(true, 'xm: two products cannot share a SKU');
      end;

      perform act_as(kem);
      begin
        perform public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
          'product_id', oil, 'batch', 'B1', 'expiry_date', public.business_date() + 100,
          'on_shelf', 150, 'in_backroom', 50)), 6.5, 3.3, 10,
          fresh_photo('reports', 'xm-0.jpg'), now() - interval '50 hours');
        perform assert(false, 'xm: a store not in X Metrics takes no counts');
      exception when others then
        perform assert(sqlerrm like '%not in X Metrics%', 'xm: a store not in X Metrics takes no counts');
      end;
      begin
        perform public.xm_set_store(shop, true);
        perform assert(false, 'xm: staff cannot add a store');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%', 'xm: staff cannot add a store');
      end;

      perform act_as(boss);
      perform public.xm_set_store(shop, true);

      perform act_as(kem);
      begin
        perform public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
          'product_id', oil, 'batch', 'B1', 'on_shelf', 1, 'in_backroom', 0)), 6.6, 3.4, 10,
          fresh_photo('reports', 'xm-far.jpg'), now() - interval '50 hours');
        perform assert(false, 'xm: a count from outside the store is refused');
      exception when others then
        perform assert(sqlerrm like '%must be in the store%', 'xm: a count from outside the store is refused');
      end;
      begin
        perform public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
          'product_id', oil, 'batch', 'B1', 'on_shelf', 1, 'in_backroom', 0)), 6.5, 3.3, 10,
          'someone-else/photo.jpg', now() - interval '50 hours');
        perform assert(false, 'xm: a count needs its own checked photo');
      exception when others then
        perform assert(sqlerrm like '%shelf photo%', 'xm: a count needs its own checked photo');
      end;
      begin
        perform public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
          'product_id', oil, 'batch', 'B1', 'on_shelf', 1.5, 'in_backroom', 0)), 6.5, 3.3, 10,
          fresh_photo('reports', 'xm-frac.jpg'), now() - interval '50 hours');
        perform assert(false, 'xm: units are whole numbers');
      exception when others then
        perform assert(sqlerrm like '%whole numbers%', 'xm: units are whole numbers');
      end;
      begin
        perform public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
          'product_id', oil, 'batch', 'B1', 'on_shelf', 1, 'in_backroom', 0)), 6.5, 3.3, 10,
          fresh_photo('reports', 'xm-old.jpg'), now() - interval '4 days');
        perform assert(false, 'xm: a count held offline over 3 days is refused');
      exception when others then
        perform assert(sqlerrm like '%Invalid capture time%', 'xm: a count held offline over 3 days is refused');
      end;

      -- Opening stock: 200 bottles of oil.
      c1 := public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
        'product_id', oil, 'batch', 'B1', 'expiry_date', public.business_date() + 100,
        'on_shelf', 150, 'in_backroom', 50)), 6.5001, 3.3001, 10,
        fresh_photo('reports', 'xm-1.jpg'), now() - interval '50 hours');
      perform assert((select is_opening and count_date = d1 and user_id = kem from public.xm_counts where id = c1),
        'xm: the first count of a store is its opening stock, dated when it was taken');

      perform act_as(boss);
      begin
        perform public.xm_log_supply(shop, oil, 300, 'B1', public.business_date() + 100, d2 + 1, null);
        perform assert(d2 + 1 > public.business_date(), 'xm: a supply cannot be dated in the future');
      exception when others then
        perform assert(sqlerrm like '%future%', 'xm: a supply cannot be dated in the future');
      end;
      sup := public.xm_log_supply(shop, oil, 300, 'B1', public.business_date() + 100, d2, 'Delivery');
      perform assert((select logged_by = boss from public.xm_supplies where id = sup), 'xm: a supply records who logged it');

      perform act_as(kem);
      begin
        perform public.xm_log_supply(shop, oil, 10, 'B1', null, d2, null);
        perform assert(false, 'xm: only admins log supplies');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%', 'xm: only admins log supplies');
      end;
      begin
        perform public.xm_submit_sales(shop, d2, jsonb_build_array(jsonb_build_object('product_id', oil, 'units', 80)),
                                       null, now());
        perform assert(false, 'xm: sales need a photo while the setting is on');
      exception when others then
        perform assert(sqlerrm like '%photo%', 'xm: sales need a photo while the setting is on');
      end;
      s1 := public.xm_submit_sales(shop, d2, jsonb_build_array(jsonb_build_object('product_id', oil, 'units', 80)),
                                   fresh_photo('reports', 'xm-s1.jpg'), now());
      s2 := public.xm_submit_sales(shop, d2, jsonb_build_array(jsonb_build_object('product_id', oil, 'units', 100)),
                                   fresh_photo('reports', 'xm-s2.jpg'), now());
      perform assert((select superseded_by = s2 from public.xm_sales where id = s1)
                     and (select sum(units) from public.xm_live_sale_lines where outlet_id = shop) = 100,
        'xm: sending a day''s sales again supersedes the first, which is kept');

      -- 200 + 300 supplied - 100 sold = 400 expected; 300 counted.
      c2 := public.xm_submit_count(shop, jsonb_build_array(
        jsonb_build_object('product_id', oil, 'batch', 'B1', 'expiry_date', public.business_date() + 100,
                           'on_shelf', 200, 'in_backroom', 100),
        jsonb_build_object('product_id', gel, 'batch', 'G7', 'expiry_date', public.business_date() + 20,
                           'on_shelf', 50, 'in_backroom', 0)), 6.5, 3.3, 10,
        fresh_photo('reports', 'xm-2.jpg'), now() - interval '26 hours');
      perform assert((select not is_opening from public.xm_counts where id = c2), 'xm: later counts are not opening stock');
      perform assert((select count(*) from public.xm_my_store_batches() where outlet_id = shop) = 2,
        'xm: the next count starts from the batches last counted');

      begin
        perform public.xm_reconcile_pending();
        perform assert(false, 'xm: staff cannot run reconciliation');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%', 'xm: staff cannot run reconciliation');
      end;

      perform act_as(boss);
      perform assert(public.xm_reconcile_pending() = 2, 'xm: both earlier counts are reconciled');
      select * into rec from public.xm_reconciliations where count_id = c2 and product_id = oil;
      perform assert(rec.expected_units = 400 and rec.actual_units = 300 and rec.variance_units = -100
                     and rec.variance_pct = 25 and rec.flagged,
        'xm: expected = last count + supplied - sold, and a 25% gap is flagged');
      perform assert((select kind = 'stock_discrepancy' and severity = 'high' and user_id = kem
                             and outlet_id = shop and summary like '100 units of XM Body Oil missing%'
                      from public.integrity_flags where id = rec.flag_id),
        'xm: the gap raises a high discrepancy flag on the person and the store');
      perform assert(not exists (select 1 from public.xm_reconciliations where count_id = c2 and product_id = gel),
        'xm: a product counted for the first time is its own baseline');
      perform assert(public.xm_reconcile_pending() = 0, 'xm: a count is reconciled once');

      -- Expiry.
      perform assert(public.xm_expiry_scan() = 2, 'xm: both batches on hand are in an alert window');
      perform assert((select window_days = 180 and not consider_pulling
                      from public.xm_expiry_alerts where outlet_id = shop and product_id = oil),
        'xm: 100 days left is the 6-month window, and selling fast enough is not pulled');
      perform assert((select window_days = 30 and consider_pulling and days_to_sell is null
                      from public.xm_expiry_alerts where outlet_id = shop and product_id = gel),
        'xm: 20 days left with no sales says consider pulling');
      perform assert(public.xm_expiry_scan() = 0, 'xm: each window alerts once');
      perform assert((select count(*) from public.xm_claim_expiry_alerts()) = 2
                     and (select count(*) from public.xm_claim_expiry_alerts()) = 0,
        'xm: new expiry alerts are handed out once to push');

      -- Settings are kept, never overwritten.
      update public.xm_settings set tolerance_pct = 10, updated_by = boss;
      perform assert((select count(*) from public.xm_settings_history where (settings->>'tolerance_pct')::numeric = 5 and changed_by = boss) >= 1,
        'xm: the previous settings are kept when changed');
      begin
        update public.xm_settings set weight_sales = 50;
        perform assert(false, 'xm: the weights must add up to 100');
      exception when check_violation then
        perform assert(true, 'xm: the weights must add up to 100');
      end;
      update public.xm_settings set tolerance_pct = 5, updated_by = boss;

      -- Grade: sales 100 of 200 = 50, accuracy 0 of 1 = 0, expiry 100, no
      -- attendance so consistency is left out: (50x40 + 0x30 + 100x10) / 80.
      perform public.xm_set_target(d2, kem, null, 200);
      g := public.xm_grade(kem, d2);
      perform assert((g->'sales'->>'score')::numeric = 50 and (g->'accuracy'->>'score')::numeric = 0
                     and g->'consistency'->>'score' is null and (g->'expiry'->>'score')::numeric = 100
                     and (g->>'score')::numeric = 37.5 and g->>'band' = 'Poor',
        'xm: the grade weighs the factors it has and bands the score');
      perform public.xm_set_target(d2, kem, null, 100);
      g := public.xm_grade(kem, d2);
      perform assert((g->'sales'->>'score')::numeric = 100 and g->>'band' = 'Average',
        'xm: the latest target counts, and a better score moves the band');
      -- Consistency: a day they clocked in, with that day's sales taken
      -- before the day ended (sent later is not late) and a count that day.
      perform notifications_on(kem);
      perform act_as(kem);
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('opening', 6.5, 3.3, 10, fresh_photo('selfies', 'xm-in.jpg'), now());
      perform act_as(boss);
      update public.attendance set attendance_date = d2 where user_id = kem;
      perform act_as(kem);
      perform public.xm_submit_sales(shop, d2, jsonb_build_array(jsonb_build_object('product_id', oil, 'units', 100)),
        fresh_photo('reports', 'xm-s3.jpg'), ((d2 + 1)::timestamp at time zone 'Africa/Lagos') - interval '1 hour');
      perform act_as(boss);
      g := public.xm_grade(kem, d2);
      perform assert((g->'consistency'->>'days_present')::int = 1 and (g->'consistency'->>'score')::numeric = 100,
        'xm: a day present with that day''s sales and a count is fully consistent');

      begin
        perform public.xm_finalise_month(public.business_date());
        perform assert(false, 'xm: a month is finalised only once it has ended');
      exception when others then
        perform assert(sqlerrm like '%once it has ended%', 'xm: a month is finalised only once it has ended');
      end;

      perform act_as(kem);
      perform assert((public.xm_grade(kem, d2)->>'user_id')::uuid = kem, 'xm: staff can see their own grade');
      begin
        perform public.xm_grade(bala, d2);
        perform assert(false, 'xm: staff cannot see another person''s grade');
      exception when others then
        perform assert(sqlerrm like '%own team%', 'xm: staff cannot see another person''s grade');
      end;

      -- Scoring policy (044): admins publish versions, staff mark them read.
      declare
        first_policy uuid := (select id from public.xm_current_policy);
        pol uuid;
      begin
        perform assert(first_policy is not null, 'xm: there is a starting scoring policy');
        perform act_as(kem);
        begin
          perform public.xm_publish_policy('My rules', 'Staff should not be able to write this policy.', null);
          perform assert(false, 'xm: staff cannot publish the scoring policy');
        exception when others then
          perform assert(sqlerrm like '%Only an admin%', 'xm: staff cannot publish the scoring policy');
        end;
        perform public.xm_mark_policy_read(first_policy);
        perform public.xm_mark_policy_read(first_policy);
        perform assert((select count(*) from public.xm_policy_reads where user_id = kem) = 1,
          'xm: reading the policy is recorded once');
        perform act_as(boss);
        pol := public.xm_publish_policy('Scoring policy 2', 'Counts are due every Monday and sales every working day.', 'Monday counts');
        perform assert((select id from public.xm_current_policy) = pol
                       and exists (select 1 from public.xm_policy_versions where id = first_policy),
          'xm: a new policy version is current and the old one is kept');
      end;

      -- Voiding keeps the record and says why.
      perform act_as(boss);
      begin
        perform public.xm_void('supply', sup, 'x');
        perform assert(false, 'xm: a void needs a reason');
      exception when others then
        perform assert(sqlerrm like '%why%', 'xm: a void needs a reason');
      end;
      perform public.xm_void('supply', sup, 'Logged twice');
      perform assert((select voided_by = boss and void_reason = 'Logged twice' from public.xm_supplies where id = sup),
        'xm: a voided supply is kept with who voided it and why');
      begin
        perform public.xm_void('supply', sup, 'Again');
        perform assert(false, 'xm: a record is voided once');
      exception when others then
        perform assert(sqlerrm like '%already voided%', 'xm: a record is voided once');
      end;
    end;
    -- ---------------------------------------------------------------
    -- Which roles take store counts (046).
    -- ---------------------------------------------------------------
    declare
      rep   uuid;
      tola  uuid := gen_random_uuid();
      femi  uuid := gen_random_uuid();
    begin
      perform act_as(boss);
      insert into public.staff_roles (name, base_role, counts_stock) values ('Sales Rep', 'merchandiser', false) returning id into rep;
      insert into auth.users (id, email) values (tola, 'rep-test@xpel.ng'), (femi, 'mk-test@xpel.ng');
      insert into public.profiles (id, full_name, email, role, staff_role_id)
      values (tola, 'Rep Tester', 'rep-test@xpel.ng', 'merchandiser', rep);
      insert into public.profiles (id, full_name, email, role)
      values (femi, 'Marketer Tester', 'mk-test@xpel.ng', 'marketer');

      perform act_as(tola);
      perform assert(not public.can_count_stock(), 'a role set not to count cannot take store counts');
      perform assert(public.store_count_status()->>'reason' = 'not_allowed', 'the count form stays closed for a role that does not count');
      perform assert(public.xm_can_submit(), 'a role that does not count can still send X Metrics');

      perform act_as(femi);
      perform assert(public.can_count_stock(), 'built-in marketers count by default');
      update public.role_store_counts set counts_stock = false where role = 'marketer';
      perform assert(not public.can_count_stock(), 'turning a built-in role off stops its people counting');
      update public.role_store_counts set counts_stock = true where role = 'marketer';

      perform act_as(boss);
      perform assert(public.can_count_stock(), 'admins still count');
      begin
        perform public.request_store_count(array[tola], public.business_date(), null);
        perform assert(false, 'nobody is asked to count in a role that does not count');
      exception when others then
        perform assert(sqlerrm like '%does not take store counts%', 'nobody is asked to count in a role that does not count');
      end;
      update public.staff_roles set counts_stock = true where id = rep;
      perform act_as(tola);
      perform assert(public.can_count_stock(), 'turning a role back on lets its people count');
      perform act_as(boss);
    end;

    -- ---------------------------------------------------------------
    -- Naming an unknown place is mandatory (045).
    -- ---------------------------------------------------------------
    declare
      zed   uuid := gen_random_uuid();
      yemi  uuid := gen_random_uuid();
      due   uuid;
      front text;
      selfie text;
      named uuid;
    begin
      perform act_as(boss);
      insert into auth.users (id, email) values (zed, 'place-test@xpel.ng'), (yemi, 'place-test2@xpel.ng');
      insert into public.profiles (id, full_name, email, role) values
        (zed, 'Zainab Bello', 'place-test@xpel.ng', 'marketer'),
        (yemi, 'Yemi Ade', 'place-test2@xpel.ng', 'marketer');
      perform notifications_on(zed);
      perform notifications_on(yemi);

      perform act_as(zed);
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('opening', 7.1000, 4.1000, 150, fresh_photo('selfies', 'pl-rough.jpg'), now());
      perform assert(not exists (select 1 from public.my_place_due()),
        'place: a rough fix does not ask for a name');
      delete from public.attendance where user_id = zed;

      -- The selfie's own position is a kilometre from the first fix: the
      -- spot is not certain, so nobody is asked to save it.
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at, device_info)
      values ('opening', 7.1000, 4.1000, 10, fresh_photo('selfies', 'pl-jump.jpg'), now(),
              jsonb_build_object('position', jsonb_build_object(
                'shutter', jsonb_build_object('lat', 7.1100, 'lng', 4.1000, 'accuracy_m', 10))));
      perform assert(not exists (select 1 from public.my_place_due()),
        'place: when the photo''s position disagrees with the first fix, nothing is asked');
      delete from public.attendance where user_id = zed;

      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at, device_info)
      values ('opening', 7.1000, 4.1000, 25, fresh_photo('selfies', 'pl-in.jpg'), now(),
              jsonb_build_object('position', jsonb_build_object(
                'shutter', jsonb_build_object('lat', 7.10005, 'lng', 4.10005, 'accuracy_m', 8))));
      perform assert((select accuracy_m from public.place_naming_due where user_id = zed) = 8,
        'place: when they agree, the surer of the two readings is kept');
      due := (select id from public.my_place_due());
      perform assert(due is not null, 'place: clocking in somewhere unknown asks for its name');

      begin
        insert into public.store_visits (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
        values (7.1000, 4.1000, 10, now());
        perform assert(false, 'place: other work waits until the place is named');
      exception when others then
        perform assert(sqlerrm like 'Name the place%', 'place: other work waits until the place is named');
      end;

      front := place_photo('pl-front.jpg');
      begin
        perform public.name_place(due, 'Ojota Plaza', 7.1001, 4.1001, 10, front, fresh_photo('reports', 'pl-shelf.jpg'));
        perform assert(false, 'place: the selfie must be one with our product');
      exception when others then
        perform assert(sqlerrm like '%selfie holding our product%', 'place: the selfie must be one with our product');
      end;

      selfie := fresh_photo('reports', 'pl-selfie.jpg');
      update public.photo_checks set kind = 'product_selfie' where path = selfie;
      begin
        perform public.name_place(due, 'Ojota Plaza', 7.1100, 4.1000, 10, front, selfie);
        perform assert(false, 'place: it is named from where it was found');
      exception when others then
        perform assert(sqlerrm like '%from where you clocked in%', 'place: it is named from where it was found');
      end;
      begin
        perform public.name_place(due, 'Ojota Plaza', 7.1001, 4.1001, 300, front, selfie);
        perform assert(false, 'place: the position must be accurate');
      exception when others then
        perform assert(sqlerrm like '%not accurate enough%', 'place: the position must be accurate');
      end;

      begin
        perform public.name_place(due, 'Ojota Plaza', 7.1001, 4.1001, 10, front, selfie,
          jsonb_build_object('sign', jsonb_build_object('lat', 7.1050, 'lng', 4.1001, 'accuracy_m', 10)));
        perform assert(false, 'place: the sign photo is taken where the place is saved');
      exception when others then
        perform assert(sqlerrm like '%moved while you took the photo%', 'place: the sign photo is taken where the place is saved');
      end;
      begin
        perform public.name_place(due, 'Ojota Plaza', 7.1001, 4.1001, 10, front, selfie,
          jsonb_build_object('selfie', jsonb_build_object('lat', 7.1030, 'lng', 4.1001, 'accuracy_m', 10)));
        perform assert(false, 'place: the selfie is taken at the place');
      exception when others then
        perform assert(sqlerrm like '%selfie at the place%', 'place: the selfie is taken at the place');
      end;

      named := public.name_place(due, '  Ojota   Plaza ', 7.1001, 4.1001, 10, front, selfie,
        jsonb_build_object('sign', jsonb_build_object('lat', 7.10012, 'lng', 4.10008, 'accuracy_m', 9),
                           'selfie', jsonb_build_object('lat', 7.10014, 'lng', 4.10011, 'accuracy_m', 12)));
      perform assert((select name = 'Ojota Plaza' and source = 'staff' and named_by = zed
                             and photo_path = front and selfie_path = selfie
                             and abs(lat - 7.1001) < 1e-9 and position_evidence ? 'sign'
                      from public.known_places where id = named),
        'place: it is saved with its name, both photos and the phone''s position');
      perform assert(not exists (select 1 from public.my_place_due()),
        'place: once named, nothing is waiting');
      insert into public.store_visits (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
      values (7.1001, 4.1001, 10, now());
      perform assert(true, 'place: and work goes on');

      perform act_as(yemi);
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('opening', 7.10015, 4.10015, 12, fresh_photo('selfies', 'pl-yemi.jpg'), now());
      perform assert(not exists (select 1 from public.my_place_due())
                     and public.place_is_recognised(7.10015, 4.10015),
        'place: the next person there is recognised, and not asked');

      perform act_as(yemi);
      begin
        perform public.dismiss_place_due(due, 'Trying it on');
        perform assert(false, 'place: staff cannot let themselves off');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%' or sqlerrm like '%already%', 'place: staff cannot let themselves off');
      end;
      perform act_as(boss);
    end;

    -- ---------------------------------------------------------------
    -- Supplies in cartons, and from a file (047).
    -- ---------------------------------------------------------------
    declare
      depot  uuid;
      argan  uuid;
      soap2  uuid;
      imp    uuid;
      sup    uuid;
      n      integer;
    begin
      perform act_as(boss);
      insert into public.outlets (name, lat, lng, geofence_radius_m) values ('Carton Test Store', 6.40, 3.40, 100)
      returning id into depot;
      perform public.xm_set_store(depot, true);
      insert into public.products (name, sku, unit) values ('Argan Oil 100ml', 'ARG-100', 'bottle') returning id into argan;
      insert into public.products (name, sku, unit, units_per_carton) values ('Black Soap', 'BSP-1', 'bar', 48) returning id into soap2;

      begin
        perform public.xm_log_supply(depot, argan, null, 'A1', null, public.business_date(), null, 10);
        perform assert(false, 'cartons: a product with no carton size needs one');
      exception when others then
        perform assert(sqlerrm like '%units are in a carton of Argan Oil%', 'cartons: a product with no carton size needs one');
      end;

      sup := public.xm_log_supply(depot, argan, null, 'A1', null, public.business_date(), null, 10, 24);
      perform assert((select quantity = 240 and cartons = 10 and units_per_carton = 24 from public.xm_supplies where id = sup),
        'cartons: 10 cartons of 24 is logged as 240 units, and the cartons are kept');
      perform assert((select units_per_carton = 24 from public.products where id = argan),
        'cartons: the product learns its carton size');
      sup := public.xm_log_supply(depot, soap2, null, '', null, public.business_date(), null, 3);
      perform assert((select quantity from public.xm_supplies where id = sup) = 144,
        'cartons: the product''s own carton size is used when none is given');
      sup := public.xm_log_supply(depot, soap2, 50, '', null, public.business_date(), null);
      perform assert((select quantity = 50 and cartons is null from public.xm_supplies where id = sup),
        'cartons: units can still be logged as units');

      imp := public.xm_create_supply_import('invoice-0042.pdf', 'pdf', 'claude', 'Xpel Distributors', 'INV-0042', public.business_date(), 2);
      begin
        perform public.xm_log_supply_import(imp, jsonb_build_array(
          jsonb_build_object('outlet_id', depot, 'product_id', argan, 'cartons', 2, 'supplied_on', public.business_date()),
          jsonb_build_object('outlet_id', depot, 'product_id', soap2, 'quantity', 0, 'supplied_on', public.business_date())));
        perform assert(false, 'import: a bad line stops the whole import');
      exception when others then
        perform assert(sqlerrm like 'Line 2:%', 'import: a bad line stops the whole import, and says which');
      end;
      perform assert(not exists (select 1 from public.xm_supplies where import_id = imp),
        'import: nothing from a failed import is logged');

      n := public.xm_log_supply_import(imp, jsonb_build_array(
        jsonb_build_object('outlet_id', depot, 'product_id', argan, 'cartons', 2, 'batch', 'A2', 'supplied_on', public.business_date()),
        jsonb_build_object('outlet_id', depot, 'product_id', soap2, 'quantity', 30, 'supplied_on', public.business_date())));
      perform assert(n = 2 and (select rows_logged from public.xm_supply_imports where id = imp) = 2
                     and (select sum(quantity) from public.xm_supplies where import_id = imp) = 78
                     and (select import_file from public.xm_supply_detail where import_id = imp limit 1) = 'invoice-0042.pdf',
        'import: the checked lines are logged together, tied to the file');

      perform act_as(bala);
      begin
        perform public.xm_create_supply_import('x.csv', 'csv', 'table', null, null, null, 1);
        perform assert(false, 'import: only admins import supplies');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%', 'import: only admins import supplies');
      end;
      perform act_as(boss);
    end;

    -- ---------------------------------------------------------------
    -- Where and on what admin actions are done (049).
    -- ---------------------------------------------------------------
    declare
      aid uuid;
      r record;
    begin
      perform act_as(boss);
      aid := public.write_audit('test.where', 'outlets', null, '{"x":1}'::jsonb, jsonb_build_object(
        'ip', '102.89.1.1', 'user_agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/129',
        'device', jsonb_build_object('browser', 'Chrome 129', 'os', 'Android 14', 'type', 'phone'),
        'lat', 6.6018, 'lng', 3.3515, 'accuracy_m', 20, 'location_source', 'browser', 'country', 'NG', 'vpn', false));
      select * into r from public.audit_log where id = aid;
      perform assert(r.ip = '102.89.1.1' and r.device->>'os' = 'Android 14' and r.location_source = 'browser'
                     and r.place = 'Ikeja City Mall' and r.country = 'NG' and r.vpn = false,
        'audit: an action records its IP, device and location, named after the store it was in');
      aid := public.write_audit('test.junk', null, null, '{}'::jsonb,
        jsonb_build_object('lat', 'here', 'lng', 999, 'location_source', 'gps', 'device', 'phone'));
      select * into r from public.audit_log where id = aid;
      perform assert(r.lat is null and r.location_source is null and r.device is null,
        'audit: malformed context is left out, the action still recorded');
      insert into public.audit_log (actor_id, action, meta)
      values (boss, 'test.direct', jsonb_build_object('n', 1, '_context', jsonb_build_object('ip', '41.58.2.2', 'vpn', true)))
      returning id into aid;
      select * into r from public.audit_log where id = aid;
      perform assert(r.ip = '41.58.2.2' and r.vpn and not (r.meta ? '_context') and r.meta->>'n' = '1',
        'audit: rows the server writes directly fill the same columns');
      -- Rows written inside SQL functions read the x-xt-audit header.
      perform set_config('request.headers', jsonb_build_object('x-xt-audit',
        encode(convert_to('{"ip":"102.89.1.1","device":{"type":"phone","os":"Android 14","browser":"Chrome 128","app":false}}', 'utf8'), 'base64'))::text, true);
      insert into public.audit_log (actor_id, action) values (boss, 'test.in_sql') returning id into aid;
      select * into r from public.audit_log where id = aid;
      perform assert(r.ip = '102.89.1.1' and r.device->>'os' = 'Android 14',
        'audit: rows written inside database functions take the context from the request header');
      perform set_config('request.headers', '{"x-xt-audit":"not base64!!"}', true);
      insert into public.audit_log (actor_id, action) values (boss, 'test.bad_header') returning id into aid;
      perform assert((select ip from public.audit_log where id = aid) is null,
        'audit: a garbled header is ignored, the action still recorded');
      perform set_config('request.headers', '', true);
      perform act_as(tunde);
      perform public.write_audit('test.supervisor', null, null, '{}'::jsonb, null);
      perform assert(exists (select 1 from public.audit_log where action = 'test.supervisor' and actor_id = tunde),
        'audit: supervisors'' actions are recorded too');
      perform act_as(ada);
      begin
        perform public.write_audit('test.staff', null, null, '{}'::jsonb, null);
        perform assert(false, 'audit: staff cannot write the audit log');
      exception when others then
        perform assert(sqlerrm like '%Admins and supervisors only%', 'audit: staff cannot write the audit log');
      end;
      perform act_as(boss);
    end;

    -- Background tracking with the app closed (050).
    declare
      femi uuid := gen_random_uuid();
      tok jsonb;
      tok2 jsonb;
      res jsonb;
    begin
      insert into auth.users (id, email) values (femi, 'kayode@xpel.ng');
      insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id)
      values (femi, 'Kayode Bello', 'kayode@xpel.ng', 'merchandiser',
              (select id from public.outlets where name = 'Ikeja City Mall'), tunde);
      perform notifications_on(femi);
      perform act_as(femi);
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('opening', 6.6019, 3.3516, 12, fresh_photo('selfies', 'kayode-in.jpg'), now() - interval '10 minutes');
      perform act_as(boss);
      begin
        perform public.issue_tracking_token('android');
        perform assert(false, 'tracking: only field staff get a tracking token');
      exception when others then
        perform assert(sqlerrm like '%Only field staff%', 'tracking: only field staff get a tracking token');
      end;
      perform act_as(femi);
      tok := public.issue_tracking_token('android');
      perform assert(length(tok->>'token') = 64
                     and not exists (select 1 from public.tracking_tokens where token_hash = tok->>'token'),
        'tracking: a token is issued, and only its hash is kept');
      perform set_config('request.jwt.claim.sub', '', false);  -- the server's call has no signed-in user
      res := public.record_background_pings(tok->>'token', jsonb_build_array(
        jsonb_build_object('lat', 6.7100, 'lng', 3.4100, 'accuracy_m', 9, 'captured_at', now()),
        jsonb_build_object('lat', 6.7101, 'lng', 3.4101, 'accuracy_m', 9, 'captured_at', now() - interval '4 minutes', 'is_mock', true)),
        now());
      perform assert((res->>'ok')::boolean and (res->>'kept')::int = 2 and (res->>'user_id')::uuid = femi,
        'tracking: positions from the closed app are stored as the person''s own');
      perform assert(exists (select 1 from public.location_pings where user_id = femi and not offline and lat = 6.7100)
                     and exists (select 1 from public.location_pings where user_id = femi and offline and lat = 6.7101
                                 and created_at between now() - interval '5 minutes' and now() - interval '3 minutes'),
        'tracking: a fresh one is live, one kept without network is stored at the time it was taken');
      perform assert(exists (select 1 from public.integrity_flags where user_id = femi and kind = 'mock_location_confirmed'
                             and detail->>'source' = 'background'),
        'tracking: a fake-location position is flagged');
      res := public.record_background_pings(tok->>'token', jsonb_build_array(
        jsonb_build_object('lat', 6.7100, 'lng', 3.4100, 'accuracy_m', 9, 'captured_at', now())), now());
      perform assert((res->>'kept')::int = 0, 'tracking: a resend is not stored twice');
      perform assert(not (public.record_background_pings('not-a-token', '[]'::jsonb, now())->>'ok')::boolean,
        'tracking: an unknown token is refused');
      perform assert(not (public.record_background_pings(tok->>'token', jsonb_build_array(
        jsonb_build_object('lat', 6.7, 'lng', 3.4, 'accuracy_m', 9, 'captured_at', now() - interval '3 hours')), now())->>'kept')::int > 0,
        'tracking: nothing from before the token was issued');
      perform assert((res->>'shift_open')::boolean, 'tracking: the phone is told the shift is still open');
      perform act_as(femi);
      tok2 := public.issue_tracking_token('android');
      perform assert(not (public.record_background_pings(tok->>'token', '[]'::jsonb, now())->>'ok')::boolean,
        'tracking: a new token on the phone retires the old one');
      perform public.revoke_tracking_tokens();
      perform assert(not (public.record_background_pings(tok2->>'token', '[]'::jsonb, now())->>'ok')::boolean,
        'tracking: clocking out stops the token');
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
      values ('closing', 6.6019, 3.3516, 12, fresh_photo('selfies', 'kayode-out.jpg'), now());
      tok2 := public.issue_tracking_token('android');
      res := public.record_background_pings(tok2->>'token', '[]'::jsonb, now());
      -- 055: after clock-out nothing is stored; the phone is told to stop at once.
      perform assert(not (res->>'ok')::boolean and (res->>'stop')::boolean and not (res->>'shift_open')::boolean
                     and not (public.record_background_pings(tok2->>'token', '[]'::jsonb, now())->>'ok')::boolean,
        'tracking: after clock-out the phone is told to stop, and its token ends');
      perform act_as(boss);
    end;

    -- Store visits and alerts, advanced (052).
    declare
      lekki uuid;
      a1 uuid;
      a2 uuid;
      a3 uuid;
      n integer;
      cov record;
    begin
      perform act_as(boss);
      perform assert(exists (select 1 from public.store_visit_detail
                             where departed_at is not null and departed_lat is not null
                               and departed_label is not null),
        'visits: the read model shows where somebody checked out');
      perform assert(not exists (select 1 from public.store_visit_detail
                                 where departed_at is null and departed_label is not null),
        'visits: a visit still open has no departure place');
      perform act_as(grace);
      perform assert((select count(*) from public.my_store_visits()) >= 1,
        'visits: functions returning the visit row still work after it grew');
      perform act_as(boss);

      select * into cov from public.store_coverage where name = 'Ikeja City Mall';
      perform assert(cov.last_visit_at = (select max(arrived_at) from public.store_visits where outlet_id = cov.outlet_id)
                     and cov.visits_30d = (select count(*) from public.store_visits where outlet_id = cov.outlet_id
                                             and visit_date >= public.business_date() - 29)
                     and cov.last_visit_by is not null,
        'coverage: a store shows its last visit, who made it and its visits this month');
      perform assert(cov.staff_assigned >= 1, 'coverage: a store counts the staff whose store it is');
      insert into public.outlets (name, lat, lng) values ('Lekki Phase 1 Shop', 6.4474, 3.4720) returning id into lekki;
      select * into cov from public.store_coverage where outlet_id = lekki;
      perform assert(cov.last_visit_at is null and cov.visits_30d = 0 and cov.staff_assigned = 0,
        'coverage: a store nobody has visited or covers says so');

      insert into public.location_alerts (user_id, alert_type, distance_m) values (ada, 'left_geofence', 420) returning id into a1;
      insert into public.location_alerts (user_id, alert_type, distance_m) values (ada, 'off_site_clock', 900) returning id into a2;
      insert into public.location_alerts (user_id, alert_type, is_resolved, resolved_by, resolved_at, note)
      values (ada, 'low_accuracy', true, boss, now() - interval '1 hour', 'Earlier note') returning id into a3;
      perform act_as(ada);
      begin
        perform public.resolve_alerts(array[a1, a2], 'nope');
        perform assert(false, 'alerts: a merchandiser must not resolve alerts together');
      exception when others then
        perform assert(sqlerrm like '%Admins only%', 'alerts: a merchandiser cannot resolve alerts together');
      end;
      perform act_as(boss);
      n := public.resolve_alerts(array[a1, a2, a3], 'Spoke to Ada about the morning');
      perform assert(n = 2, 'alerts: resolving together counts only the ones still open');
      perform assert((select count(*) from public.location_alerts where id in (a1, a2) and is_resolved
                        and resolved_by = boss and note = 'Spoke to Ada about the morning') = 2,
        'alerts: each one is resolved with the one note');
      perform assert((select note from public.location_alerts where id = a3) = 'Earlier note',
        'alerts: one already resolved keeps its own note');
      perform assert((select count(*) from public.audit_log where action = 'alert.resolve'
                        and target_id in (a1, a2) and actor_id = boss) = 2
                     and not exists (select 1 from public.audit_log where action = 'alert.resolve' and target_id = a3
                                       and created_at > now() - interval '1 minute'),
        'alerts: one audit row for each alert resolved, none for the one skipped');
      perform assert(public.resolve_alerts(array[]::uuid[], 'x') = 0, 'alerts: an empty list resolves nothing');
    end;

    -- Integrity reviewed in bulk, and Ask Xtend conversations kept (054).
    declare
      kayode uuid := (select id from public.profiles where email = 'kayode@xpel.ng');
      f1 uuid;
      f2 uuid;
      f3 uuid;
      n integer;
      conv uuid;
    begin
      insert into public.integrity_flags (user_id, kind, severity, summary)
      values (kayode, 'perfect_accuracy', 'medium', 'test 054 one') returning id into f1;
      insert into public.integrity_flags (user_id, kind, severity, summary)
      values (kayode, 'repeated_exact_location', 'high', 'test 054 two') returning id into f2;
      insert into public.integrity_flags (user_id, kind, severity, summary)
      values (bala, 'perfect_accuracy', 'low', 'test 054 three') returning id into f3;

      perform act_as(tunde);
      perform assert(public.supervises_user(kayode) and not public.supervises_user(bala),
        'bulk review: the supervisor has Kayode in his team and not Bala');
      n := public.review_integrity_flags(array[f1, f2, f3], '  Spoke to him, GPS app removed  ');
      perform assert(n = 2
                     and (select count(*) from public.integrity_flags
                          where id in (f1, f2) and reviewed_by = tunde
                            and review_note = 'Spoke to him, GPS app removed') = 2,
        'bulk review: a supervisor marks his team''s flags reviewed with one note');
      perform assert((select reviewed_at from public.integrity_flags where id = f3) is null,
        'bulk review: and cannot touch a flag outside his team');
      n := public.review_integrity_flags(array[f1], 'Changed my mind');
      perform assert(n = 0 and (select review_note from public.integrity_flags where id = f1) = 'Spoke to him, GPS app removed',
        'bulk review: a reviewed flag keeps its first review');
      perform act_as(boss);
      n := public.review_integrity_flags(array[f3], null);
      perform assert(n = 1
                     and (select reviewed_by from public.integrity_flags where id = f3) = boss
                     and (select review_note from public.integrity_flags where id = f3) is null,
        'bulk review: an admin reviews anybody''s, a blank note is kept as none');
      begin
        perform public.review_integrity_flags(array[]::uuid[], 'x');
        perform assert(false, 'bulk review: an empty list is refused');
      exception when others then
        perform assert(sqlerrm like '%at least one%', 'bulk review: an empty list is refused');
      end;
      perform act_as(ada);
      begin
        perform public.review_integrity_flags(array[f1], 'x');
        perform assert(false, 'bulk review: field staff cannot review flags');
      exception when others then
        perform assert(sqlerrm like '%Only admins and supervisors%', 'bulk review: field staff cannot review flags');
      end;

      -- Conversations, under row level security as the API role.
      grant usage on schema public, auth to authenticated;
      grant execute on function auth.uid() to authenticated;
      perform act_as(boss);
      execute 'set local role authenticated';
      insert into public.assistant_conversations (title, turns)
      values ('Who was late', '[{"role":"user","content":"Who was late today?"},{"role":"assistant","content":"Nobody."}]')
      returning id into conv;
      perform assert((select user_id from public.assistant_conversations where id = conv) = boss
                     and (select turn_count from public.assistant_conversations where id = conv) = 2,
        'conversations: an admin keeps a chat as their own, with its turns counted');
      perform act_as(tunde);
      perform assert(not exists (select 1 from public.assistant_conversations where id = conv),
        'conversations: nobody else sees it, not even a supervisor');
      update public.assistant_conversations set title = 'Taken over' where id = conv;
      delete from public.assistant_conversations where id = conv;
      perform act_as(boss);
      perform assert((select title from public.assistant_conversations where id = conv) = 'Who was late',
        'conversations: nor renames or deletes it');
      update public.assistant_conversations set title = 'Late this week', user_id = tunde where id = conv;
      perform assert((select user_id from public.assistant_conversations where id = conv) = boss
                     and (select title from public.assistant_conversations where id = conv) = 'Late this week',
        'conversations: the owner renames it, and it stays theirs');
      perform act_as(ada);
      begin
        insert into public.assistant_conversations (title) values ('Mine');
        perform assert(false, 'conversations: field staff cannot keep chats');
      exception when others then
        perform assert(sqlerrm like '%row-level security%', 'conversations: field staff cannot keep chats');
      end;
      perform act_as(boss);
      delete from public.assistant_conversations where id = conv;
      perform assert(not exists (select 1 from public.assistant_conversations where id = conv),
        'conversations: the owner deletes it');
      reset role;
    end;
    -- ---------------------------------------------------------------
    -- Support inbox, quick replies, notification history and schedules (0053).
    -- ---------------------------------------------------------------
    declare
      kemi uuid := gen_random_uuid();
      tid  uuid;
      sid  uuid;
      sid2 uuid;
      nid  uuid;
      ids  uuid[];
      n    integer;
      w    timestamptz;
    begin
      insert into auth.users (id, email) values (kemi, 'funke.support@xpel.ng');
      insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id)
      values (kemi, 'Funke Alabi', 'funke.support@xpel.ng', 'merchandiser', null, tunde);

      perform act_as(kemi);
      tid := public.open_support_thread('Cannot clock in', 'The app says I am off site but I am inside the store.');
      perform assert((select waiting_since from public.support_inbox where id = tid) is not null,
        'support: a new thread is waiting for an answer');

      -- The helper passed it to the office three hours ago.
      update public.support_messages set created_at = now() - interval '3 hours' where thread_id = tid;
      insert into public.support_messages (thread_id, sender_id, sender_role, body, created_at)
      values (tid, null, 'ai', 'I have passed this to the office.', now() - interval '179 minutes');
      update public.support_threads set status = 'escalated', escalated_at = now() - interval '179 minutes' where id = tid;
      perform assert((select waiting_since from public.support_inbox where id = tid) = now() - interval '3 hours',
        'support: the wait runs from the member''s message, not the helper''s reply');

      perform act_as(tunde);
      perform public.post_support_message(tid, 'Hello Kemi, we are looking into it.');
      select i.waiting_since, i.office_replies into w, n from public.support_inbox i where i.id = tid;
      perform assert(w is null and n = 1
                     and (select last_sender from public.support_inbox where id = tid) = 'supervisor',
        'support: once a person answers, nothing is waiting');
      insert into public.support_messages (thread_id, sender_id, sender_role, body, created_at)
      values (tid, kemi, 'staff', 'It is still not working.', now() + interval '1 second');
      update public.support_threads set status = 'open' where id = tid;
      perform assert((select waiting_since from public.support_inbox where id = tid) = now() + interval '1 second',
        'support: writing again after the answer starts a new wait');

      perform assert(exists (select 1 from public.support_assignees(tid) where user_id = tunde)
                     and exists (select 1 from public.support_assignees(tid) where user_id = boss)
                     and not exists (select 1 from public.support_assignees(tid) where user_id = kemi),
        'support: a thread can go to the member''s supervisor or an admin, not to the member');
      perform public.assign_support_thread(tid, tunde);
      perform assert((select assigned_name from public.support_inbox where id = tid) = 'Tunde Bello',
        'support: the supervisor takes the thread');
      begin
        perform public.assign_support_thread(tid, bala);
        perform assert(false, 'support: a thread cannot go to someone outside the office');
      exception when others then
        perform assert(sqlerrm like '%cannot take%', 'support: a thread cannot go to someone outside the office');
      end;

      perform act_as(bala);
      begin
        perform public.assign_support_thread(tid, null);
        perform assert(false, 'support: staff cannot hand threads around');
      exception when others then
        perform assert(sqlerrm like '%not yours%', 'support: staff cannot hand threads around');
      end;

      perform act_as(boss);
      perform public.resolve_support_thread(tid);
      perform public.reopen_support_thread(tid);
      perform assert((select status from public.support_threads where id = tid) = 'escalated'
                     and (select resolved_at from public.support_threads where id = tid) is null
                     and (select waiting_since from public.support_inbox where id = tid) is not null,
        'support: a closed thread reopened goes back to the office, waiting');
      begin
        perform public.reopen_support_thread(tid);
        perform assert(false, 'support: only a closed thread is reopened');
      exception when others then
        perform assert(sqlerrm like '%not closed%', 'support: only a closed thread is reopened');
      end;
      perform public.resolve_support_thread(tid);
      perform act_as(kemi);
      begin
        perform public.reopen_support_thread(tid);
        perform assert(false, 'support: the member cannot reopen from the office side');
      exception when others then
        perform assert(sqlerrm like '%not yours%', 'support: the member cannot reopen from the office side');
      end;

      perform assert((select count(*) from public.support_quick_replies where created_by is null) >= 5
                     and (select count(*) from public.notification_templates where created_by is null) >= 4,
        'support: starter quick replies and notification templates are there');

      -- Scheduling: the audience is fixed with the sender's own reach.
      perform act_as(tunde);
      sid := public.schedule_notification('Team meeting', 'Meet at the depot at 4pm today.', '/field',
                                          'everyone', '{}'::jsonb, now() + interval '1 hour');
      select user_ids into ids from public.scheduled_notifications where id = sid;
      perform assert(kemi = any (ids) and not boss = any (ids) and not tunde = any (ids)
                     and not exists (select 1 from unnest(ids) u
                                     where not exists (select 1 from public.alert_watchers(u) aw where aw.user_id = tunde)),
        'notifications: a supervisor''s schedule reaches their own team only');
      begin
        perform public.schedule_notification('Late', 'Too late now.', null, 'everyone', '{}'::jsonb, now() - interval '1 hour');
        perform assert(false, 'notifications: cannot schedule in the past');
      exception when others then
        perform assert(sqlerrm like '%few minutes from now%', 'notifications: cannot schedule in the past');
      end;
      perform act_as(kemi);
      begin
        perform public.schedule_notification('Hi', 'Hello all of you.', null, 'everyone', '{}'::jsonb, now() + interval '1 hour');
        perform assert(false, 'notifications: staff cannot schedule');
      exception when others then
        perform assert(sqlerrm like '%Admins and supervisors only%', 'notifications: staff cannot schedule');
      end;
      perform act_as(bala);
      begin
        perform public.cancel_scheduled_notification(sid);
        perform assert(false, 'notifications: only the sender or an admin cancels');
      exception when others then
        perform assert(sqlerrm like '%not yours%', 'notifications: only the sender or an admin cancels');
      end;
      perform act_as(tunde);
      perform public.cancel_scheduled_notification(sid);
      perform assert((select status from public.scheduled_notifications where id = sid) = 'cancelled',
        'notifications: the sender cancels their schedule');
      begin
        perform public.cancel_scheduled_notification(sid);
        perform assert(false, 'notifications: a cancelled one cannot be cancelled again');
      exception when others then
        perform assert(sqlerrm like '%already gone%', 'notifications: a cancelled one cannot be cancelled again');
      end;

      perform act_as(boss);
      sid2 := public.schedule_notification('Clock in on time', 'Please clock in by 8:00 today.', null,
                                           'role', '{"role":"merchandiser"}'::jsonb, now() + interval '10 minutes');
      update public.scheduled_notifications set send_at = now() - interval '1 minute' where id = sid2;
      perform set_config('request.jwt.claim.sub', '', false);  -- the job has no signed-in user
      perform assert((select count(*) from public.claim_due_notifications(10) c where c.id = sid2) = 1,
        'notifications: the job takes a due schedule');
      perform assert((select status from public.scheduled_notifications where id = sid2) = 'sending',
        'notifications: and marks it as being sent');
      perform assert((select count(*) from public.claim_due_notifications(10) c where c.id = sid2) = 0,
        'notifications: and only once');
      update public.scheduled_notifications set claimed_at = now() - interval '20 minutes' where id = sid2;
      perform public.claim_due_notifications(10);
      perform assert((select status from public.scheduled_notifications where id = sid2) = 'failed',
        'notifications: one left half-sent is marked failed, never sent twice');

      perform act_as(tunde);
      sid := public.schedule_notification('Reminder', 'Daily report before you leave.', null,
                                          'everyone', '{}'::jsonb, now() + interval '2 hours');
      perform assert((select count(*) from public.claim_scheduled_notification(sid)) = 1,
        'notifications: the sender can send a schedule now');
      begin
        perform public.claim_scheduled_notification(sid);
        perform assert(false, 'notifications: and it cannot go twice');
      exception when others then
        perform assert(sqlerrm like '%already gone%', 'notifications: and it cannot go twice');
      end;

      -- The history: who sent what, and the sender can see who got it.
      insert into public.notifications (sender_id, title, body, audience, audience_detail, recipients, delivered)
      values (tunde, 'Team meeting', 'Meet at the depot at 4pm.', 'users',
              jsonb_build_object('user_ids', jsonb_build_array(kemi)), 1, 1)
      returning id into nid;
      insert into public.notification_deliveries (notification_id, user_id, status, read_at)
      values (nid, kemi, 'sent', now());
      perform assert(public.notification_sent_by_me(nid), 'notifications: the sender is recognised');
      perform assert((select kind from public.notification_log where id = nid) = 'message'
                     and (select sender_name from public.notification_log where id = nid) = 'Tunde Bello'
                     and (select read_count from public.notification_log where id = nid) = 1,
        'notifications: the log names the sender and counts who read it');
      perform act_as(boss);
      perform assert(not public.notification_sent_by_me(nid), 'notifications: somebody else is not the sender');
      insert into public.notifications (sender_id, title, body, audience, audience_detail, recipients)
      values (null, 'Ada: no show', 'Not clocked in.', 'users', '{"kind":"no_show","system":true}'::jsonb, 1),
             (boss, 'Reply from the office', 'Cannot clock in: fixed.', 'users', '{"kind":"support_reply"}'::jsonb, 1);
      perform assert((select kind from public.notification_log where title = 'Ada: no show') = 'alert'
                     and (select kind from public.notification_log where title = 'Reply from the office'
                          and body = 'Cannot clock in: fixed.') = 'support',
        'notifications: automatic alerts and support replies are told apart from messages');
    end;

    -- Updates (057).
    declare
      r1 uuid;
      r2 uuid;
    begin
      perform act_as(boss);
      insert into public.app_releases (title, notes, required, min_android_build)
      values ('Faster pages', 'Pages open faster.', false, 40) returning id into r1;
      insert into public.app_releases (title, min_android_build, min_ios_build)
      values ('New tracker', 52, 3) returning id into r2;
      perform assert((select android from public.app_minimum_builds) = 52
                     and (select ios from public.app_minimum_builds) = 3,
        'updates: the lowest app build allowed is the highest any release set');
      update public.app_releases set withdrawn_at = now() where id = r2;
      perform assert((select android from public.app_minimum_builds) = 40,
        'updates: a withdrawn release no longer sets the minimum');
      perform act_as(ada);
      perform public.report_app_install('android', '1.0.48', 48, 'abc123');
      perform public.report_app_install('android', '1.0.48', 48, 'abc123');
      perform assert((select count(*) from public.app_installs where user_id = ada and platform = 'android' and app_build = 48) = 1,
        'updates: each phone reports its app build, one row per platform');
      perform public.report_app_install('android', '1.0.53', 53, 'def456');
      perform assert((select app_build from public.app_installs where user_id = ada and platform = 'android') = 53,
        'updates: a new build is recorded at once');
      perform act_as(boss);
    end;

    -- Realtime broadcast (058): changes reach only the owner's topic, and
    -- carry no row data.
    perform assert(exists (select 1 from realtime.messages where topic = 'field:' || ada::text and event = 'change'),
      'realtime: a member''s own changes are announced on their own topic');
    perform assert(not exists (select 1 from realtime.messages m
                               where m.payload - 'table' - 'op' <> '{}'::jsonb),
      'realtime: an announcement carries only the table and the kind of change, never the row');
    perform assert(exists (select 1 from realtime.messages m where m.payload->>'table' = 'attendance')
                   and exists (select 1 from realtime.messages m where m.payload->>'table' = 'support_messages'),
      'realtime: clock-ins and support replies are both announced');


    -- Clock-out reminders (061).
    declare
      today date := public.business_date();
      shop uuid;
      cy1 uuid := gen_random_uuid();  -- clocked in at a store ending 17:00
      cy2 uuid := gen_random_uuid();  -- clocked in, no store: 18:00
      cy3 uuid := gen_random_uuid();  -- not clocked in
      cy4 uuid := gen_random_uuid();  -- clocked in and out
      cy5 uuid := gen_random_uuid();  -- the job was over an hour late
      mine uuid[];
      got  record;
      n    integer;
    begin
      insert into auth.users (id, email) values
        (cy1, 'cy1@xpel.ng'), (cy2, 'cy2@xpel.ng'), (cy3, 'cy3@xpel.ng'),
        (cy4, 'cy4@xpel.ng'), (cy5, 'cy5@xpel.ng');
      insert into public.outlets (name, lat, lng, geofence_radius_m, shift_start, shift_end)
      values ('Surulere Shop', 6.5000, 3.3500, 150, '08:00', '17:00') returning id into shop;
      insert into public.profiles (id, full_name, email, role, outlet_id) values
        (cy1, 'Chiamaka One',   'cy1@xpel.ng', 'merchandiser', shop),
        (cy2, 'Chinedu Two',    'cy2@xpel.ng', 'marketer',     null),
        (cy3, 'Chioma Three',   'cy3@xpel.ng', 'merchandiser', shop),
        (cy4, 'Chukwudi Four',  'cy4@xpel.ng', 'merchandiser', shop),
        (cy5, 'Chidinma Five',  'cy5@xpel.ng', 'merchandiser', shop);
      mine := array[cy1, cy2, cy3, cy4, cy5];

      -- Clock events written straight in (the clock-in rules are tested above).
      perform set_config('session_replication_role', 'replica', true);
      insert into public.attendance (user_id, type, lat, lng, accuracy_m, selfie_path, client_captured_at, attendance_date)
      values (cy1, 'opening', 6.5, 3.35, 10, 'x', now(), today),
             (cy2, 'opening', 6.5, 3.35, 10, 'x', now(), today),
             (cy4, 'opening', 6.5, 3.35, 10, 'x', now(), today),
             (cy4, 'closing', 6.5, 3.35, 10, 'x', now(), today),
             (cy5, 'opening', 6.5, 3.35, 10, 'x', now(), today);
      perform set_config('session_replication_role', 'origin', true);

      perform assert(public.shift_end_for(cy1) = time '17:00' and public.shift_end_for(cy2) = time '18:00',
        'clock-out reminders: the shift end is the home store''s, or 18:00 with no store');

      select count(*) into n from public.claim_clock_out_reminders((today + time '16:59') at time zone 'Africa/Lagos') c
      where c.user_id = any(mine);
      perform assert(n = 0, 'clock-out reminders: nobody is reminded before their shift ends');

      select count(*) into n from public.claim_clock_out_reminders((today + time '17:00') at time zone 'Africa/Lagos') c
      where c.user_id = any(mine) and c.user_id in (cy1) and c.stage = 1 and c.shift_end = '17:00';
      perform assert(n = 1 and not exists (select 1 from public.clock_out_reminders r where r.user_id in (cy3, cy4)),
        'clock-out reminders: the first goes at the shift end, not to anyone not clocked in or already out');
      perform assert(exists (select 1 from public.clock_out_reminders r where r.user_id = cy5 and r.stage = 1),
        'clock-out reminders: and to everyone else whose shift has ended');

      select count(*) into n from public.claim_clock_out_reminders((today + time '17:05') at time zone 'Africa/Lagos') c
      where c.user_id = any(mine);
      perform assert(n = 0, 'clock-out reminders: claiming again hands back nothing the second time');

      -- cy5 clocks out before the second reminder.
      perform set_config('session_replication_role', 'replica', true);
      insert into public.attendance (user_id, type, lat, lng, accuracy_m, selfie_path, client_captured_at, attendance_date)
      values (cy5, 'closing', 6.5, 3.35, 10, 'x', now(), today);
      perform set_config('session_replication_role', 'origin', true);

      select count(*) into n from public.claim_clock_out_reminders((today + time '17:59') at time zone 'Africa/Lagos') c
      where c.user_id = cy1;
      perform assert(n = 0, 'clock-out reminders: the second does not go before an hour has passed');

      perform assert(not exists (select 1 from public.clock_out_reminders r where r.user_id = cy2),
        'clock-out reminders: somebody with no store is not reminded at 17:00');
      create temp table cy_claim on commit drop as
        select * from public.claim_clock_out_reminders((today + time '18:00') at time zone 'Africa/Lagos') c
        where c.user_id = any(mine);
      perform assert(exists (select 1 from cy_claim c where c.user_id = cy2 and c.stage = 1 and c.shift_end = '18:00'),
        'clock-out reminders: somebody with no store is reminded at 18:00');
      perform assert((select count(*) from cy_claim c where c.stage = 2) = 1
                     and exists (select 1 from cy_claim c where c.user_id = cy1 and c.stage = 2),
        'clock-out reminders: the second goes an hour after the shift end');
      perform assert(not exists (select 1 from public.clock_out_reminders r where r.user_id = cy5 and r.stage = 2),
        'clock-out reminders: none after they clock out');

      select count(*) into n from public.claim_clock_out_reminders((today + time '22:00') at time zone 'Africa/Lagos') c
      where c.user_id = any(mine);
      perform assert(n = 1 and (select count(*) from public.clock_out_reminders r where r.user_id = cy1) = 2,
        'clock-out reminders: never more than two a day (only the no-store member''s second is left)');

      perform assert((select count(*) from public.claim_clock_out_reminders(((today + 1) + time '00:30') at time zone 'Africa/Lagos') c
                      where c.user_id = any(mine)) = 0,
        'clock-out reminders: nothing after midnight Lagos');

      -- A job more than an hour late sends only the second, once.
      update public.outlets set shift_end = '20:00' where id = shop;
      perform set_config('session_replication_role', 'replica', true);
      delete from public.attendance where user_id = cy3;
      insert into public.attendance (user_id, type, lat, lng, accuracy_m, selfie_path, client_captured_at, attendance_date)
      values (cy3, 'opening', 6.5, 3.35, 10, 'x', now(), today);
      perform set_config('session_replication_role', 'origin', true);
      select * into got from public.claim_clock_out_reminders((today + time '21:10') at time zone 'Africa/Lagos') c
      where c.user_id = cy3;
      perform assert(got.stage = 2 and got.shift_end = '20:00'
                     and not exists (select 1 from public.clock_out_reminders r where r.user_id = cy3 and r.stage = 1),
        'clock-out reminders: a late job sends one reminder, the second, not both at once');
      perform assert((select count(*) from public.claim_clock_out_reminders((today + time '21:15') at time zone 'Africa/Lagos') c
                      where c.user_id = cy3) = 0,
        'clock-out reminders: and the first is not sent after it');
      update public.outlets set shift_end = '17:00' where id = shop;
    end;

    -- Five-minute heads-ups before the shift starts and ends (069).
    declare
      today date := public.business_date();
      shop  uuid;
      shop2 uuid;
      sa1 uuid := gen_random_uuid();  -- merchandiser, store 09:00-17:30, working
      sa2 uuid := gen_random_uuid();  -- marketer, no store: 08:00-18:00
      sa3 uuid := gen_random_uuid();  -- day off today
      sa4 uuid := gen_random_uuid();  -- on approved leave today
      sa5 uuid := gen_random_uuid();  -- already clocked in
      sa6 uuid := gen_random_uuid();  -- supervisor
      sa7 uuid := gen_random_uuid();  -- admin
      sa8 uuid := gen_random_uuid();  -- deactivated
      sa9 uuid := gen_random_uuid();  -- store 10:00-18:00, the job ran late
      mine uuid[];
      got  record;
      n    integer;
      at   timestamptz;
    begin
      insert into auth.users (id, email) values
        (sa1, 'sa1@xpel.ng'), (sa2, 'sa2@xpel.ng'), (sa3, 'sa3@xpel.ng'), (sa4, 'sa4@xpel.ng'),
        (sa5, 'sa5@xpel.ng'), (sa6, 'sa6@xpel.ng'), (sa7, 'sa7@xpel.ng'), (sa8, 'sa8@xpel.ng'),
        (sa9, 'sa9@xpel.ng');
      insert into public.outlets (name, lat, lng, geofence_radius_m, shift_start, shift_end)
      values ('Ikeja Shop', 6.6000, 3.3500, 150, '09:00', '17:30') returning id into shop;
      insert into public.outlets (name, lat, lng, geofence_radius_m, shift_start, shift_end)
      values ('Yaba Shop', 6.5100, 3.3700, 150, '10:00', '18:00') returning id into shop2;
      insert into public.profiles (id, full_name, email, role, outlet_id, is_active) values
        (sa1, 'Sade One',   'sa1@xpel.ng', 'merchandiser', shop,  true),
        (sa2, 'Sani Two',   'sa2@xpel.ng', 'marketer',     null,  true),
        (sa3, 'Sola Three', 'sa3@xpel.ng', 'merchandiser', shop,  true),
        (sa4, 'Seun Four',  'sa4@xpel.ng', 'merchandiser', shop,  true),
        (sa5, 'Segun Five', 'sa5@xpel.ng', 'merchandiser', shop,  true),
        (sa6, 'Simi Six',   'sa6@xpel.ng', 'supervisor',   shop,  true),
        (sa7, 'Shola Seven','sa7@xpel.ng', 'admin',        shop,  true),
        (sa8, 'Sam Eight',  'sa8@xpel.ng', 'merchandiser', shop,  false),
        (sa9, 'Sule Nine',  'sa9@xpel.ng', 'merchandiser', shop2, true);
      mine := array[sa1, sa2, sa3, sa4, sa5, sa6, sa7, sa8, sa9];

      -- Today is a working day for everyone but sa3 (whatever weekday the
      -- tests run on); sa4 is on approved leave. Written straight in.
      perform set_config('session_replication_role', 'replica', true);
      insert into public.schedule_overrides (user_id, day, working)
      select u, today, u <> sa3 from unnest(mine) u;
      insert into public.leave_requests (user_id, kind, from_date, to_date, reason, status)
      values (sa4, 'annual', today, today, 'Family visit', 'approved');
      insert into public.attendance (user_id, type, lat, lng, accuracy_m, selfie_path, client_captured_at, attendance_date)
      values (sa5, 'opening', 6.6, 3.35, 10, 'x', now(), today);
      perform set_config('session_replication_role', 'origin', true);

      perform assert(public.shift_start_for(sa1) = time '09:00' and public.shift_start_for(sa2) = time '08:00',
        'shift heads-ups: the shift start is the home store''s, or 08:00 with no store');

      select count(*) into n from public.claim_shift_soon_reminders((today + time '08:54') at time zone 'Africa/Lagos') c
      where c.user_id = any(mine) and c.user_id <> sa2;
      perform assert(n = 0, 'shift heads-ups: nothing more than five minutes before the shift starts');

      create temp table sa_claim on commit drop as
        select * from public.claim_shift_soon_reminders((today + time '08:55') at time zone 'Africa/Lagos') c
        where c.user_id = any(mine);
      perform assert(exists (select 1 from sa_claim c where c.user_id = sa1 and c.stage = 'clock_in_soon'
                             and c.shift_time = '09:00' and c.store = 'Ikeja Shop'),
        'shift heads-ups: "time to clock in" goes five minutes before the start, with the time and the store');
      perform assert(not exists (select 1 from sa_claim c where c.user_id in (sa3, sa4)),
        'shift heads-ups: nobody on a day off or on leave is asked to clock in');
      perform assert(not exists (select 1 from sa_claim c where c.user_id = sa5),
        'shift heads-ups: nobody already clocked in is asked to clock in');
      perform assert(not exists (select 1 from sa_claim c where c.user_id in (sa6, sa7)),
        'shift heads-ups: never admins or supervisors');
      perform assert(not exists (select 1 from sa_claim c where c.user_id = sa8),
        'shift heads-ups: never a deactivated account');

      select count(*) into n from public.claim_shift_soon_reminders((today + time '08:59') at time zone 'Africa/Lagos') c
      where c.user_id = sa1;
      perform assert(n = 0, 'shift heads-ups: the clock-in reminder goes only once');

      select * into got from public.claim_shift_soon_reminders((today + time '07:57') at time zone 'Africa/Lagos') c
      where c.user_id = sa2;
      perform assert(got.stage = 'clock_in_soon' and got.shift_time = '08:00' and got.store is null,
        'shift heads-ups: somebody with no store is asked at 07:55-08:00, with no store named');

      -- sa9's job ran late: at 10:00 the start has passed, so nothing.
      select count(*) into n from public.claim_shift_soon_reminders((today + time '10:00') at time zone 'Africa/Lagos') c
      where c.user_id = sa9;
      perform assert(n = 0 and not exists (select 1 from public.clock_out_reminders r where r.user_id = sa9),
        'shift heads-ups: a late job does not send a clock-in reminder after the start has passed');

      -- sa1 and sa9 clock in.
      perform set_config('session_replication_role', 'replica', true);
      insert into public.attendance (user_id, type, lat, lng, accuracy_m, selfie_path, client_captured_at, attendance_date)
      values (sa1, 'opening', 6.6, 3.35, 10, 'x', now(), today),
             (sa9, 'opening', 6.6, 3.35, 10, 'x', now(), today);
      perform set_config('session_replication_role', 'origin', true);

      select count(*) into n from public.claim_shift_soon_reminders((today + time '17:24') at time zone 'Africa/Lagos') c
      where c.user_id in (sa1, sa5);
      perform assert(n = 0, 'shift heads-ups: no clock-out heads-up more than five minutes before the end');

      drop table sa_claim;
      create temp table sa_claim on commit drop as
        select * from public.claim_shift_soon_reminders((today + time '17:25') at time zone 'Africa/Lagos') c
        where c.user_id = any(mine);
      perform assert((select count(*) from sa_claim c where c.stage = 'clock_out_soon' and c.shift_time = '17:30'
                      and c.user_id in (sa1, sa5)) = 2,
        'shift heads-ups: "get ready to clock out" goes five minutes before the end to those clocked in');
      perform assert(not exists (select 1 from sa_claim c where c.user_id not in (sa1, sa5)),
        'shift heads-ups: not to anyone not clocked in, nor to admins or supervisors');
      perform assert((select array_agg(r.stage_name order by r.stage) from public.clock_out_reminders r where r.user_id = sa1)
                     = array['clock_in_soon', 'clock_out_soon'],
        'shift heads-ups: the clock-in and clock-out heads-ups are separate stages, one of each');

      select count(*) into n from public.claim_shift_soon_reminders((today + time '17:29') at time zone 'Africa/Lagos') c
      where c.user_id in (sa1, sa5);
      perform assert(n = 0, 'shift heads-ups: the clock-out heads-up goes only once');

      select count(*) into n from public.claim_clock_out_reminders((today + time '17:30') at time zone 'Africa/Lagos') c
      where c.user_id in (sa1, sa5) and c.stage = 1;
      perform assert(n = 2, 'shift heads-ups: the heads-up does not stop the reminder at the shift end');

      -- sa9's job ran late again: at 18:00 the heads-up is skipped, the
      -- at-end reminder goes.
      select count(*) into n from public.claim_shift_soon_reminders((today + time '18:00') at time zone 'Africa/Lagos') c
      where c.user_id = sa9;
      perform assert(n = 0, 'shift heads-ups: a late job does not send a stale clock-out heads-up');
      select count(*) into n from public.claim_clock_out_reminders((today + time '18:00') at time zone 'Africa/Lagos') c
      where c.user_id = sa9 and c.stage = 1;
      perform assert(n = 1, 'shift heads-ups: the at-end reminder covers a missed heads-up');

      perform assert((select count(*) from public.claim_shift_soon_reminders(((today + 1) + time '00:01') at time zone 'Africa/Lagos') c
                      where c.user_id = any(mine)) = 0,
        'shift heads-ups: nothing after midnight Lagos');
      delete from public.clock_out_reminders r where r.user_id = any(mine);
      perform set_config('session_replication_role', 'replica', true);
      delete from public.attendance a where a.user_id = any(mine);
      perform set_config('session_replication_role', 'origin', true);
      update public.profiles set is_active = false where id = any(mine);
    end;

    -- Work schedules and leave (059).
    declare
      kemi  uuid := gen_random_uuid();  -- on Sola's team
      obi   uuid := gen_random_uuid();  -- on nobody's team
      uche  uuid := gen_random_uuid();  -- on Sola's team, on leave today
      sola  uuid := gen_random_uuid();  -- supervisor
      sade  uuid := gen_random_uuid();  -- another supervisor
      shop  uuid;
      d0    date := public.business_date();
      sat   date;
      sun   date;
      mon   date;
      lv    uuid;
      lv2   uuid;
      res   jsonb;
      cal   record;
    begin
      sat := d0 + ((6 - extract(dow from d0)::int + 7) % 7) + 7;
      sun := sat + 1;
      mon := sat + 2;
      insert into auth.users (id, email) values
        (kemi, 'kemi.rota@xpel.ng'), (obi, 'obi.rota@xpel.ng'), (uche, 'uche.rota@xpel.ng'),
        (sola, 'sola.rota@xpel.ng'), (sade, 'sade.rota@xpel.ng');
      insert into public.outlets (name, lat, lng, geofence_radius_m, shift_start, shift_end)
      values ('Yaba Early Store', 6.5095, 3.3711, 100, '00:00', '23:59')
      returning id into shop;
      insert into public.profiles (id, full_name, email, role) values
        (sola, 'Sola Martins', 'sola.rota@xpel.ng', 'supervisor'),
        (sade, 'Sade Lawal', 'sade.rota@xpel.ng', 'supervisor');
      insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id) values
        (kemi, 'Kemi Adeyemi', 'kemi.rota@xpel.ng', 'merchandiser', shop, sola),
        (obi,  'Obi Nwosu',    'obi.rota@xpel.ng',  'merchandiser', shop, null),
        (uche, 'Uche Okeke',   'uche.rota@xpel.ng', 'marketer',     shop, sola);

      -- Nobody given a pattern works Monday to Saturday.
      perform act_as(boss);
      perform assert(public.is_working_day(obi, sat) and public.is_working_day(obi, mon)
                     and not public.is_working_day(obi, sun),
        'schedules: without a pattern, Monday to Saturday are working days and Sunday is off');

      -- Staff cannot set schedules; a supervisor only for their own team.
      perform act_as(kemi);
      begin
        perform public.set_work_pattern(array[kemi], '{0,1}'::smallint[]);
        perform assert(false, 'schedules: staff must not set schedules');
      exception when others then
        perform assert(sqlerrm like '%Only admins and supervisors%', 'schedules: staff cannot set their own schedule');
      end;
      perform act_as(sola);
      begin
        perform public.set_work_pattern(array[obi], '{1,2,3}'::smallint[]);
        perform assert(false, 'schedules: a supervisor must not set another team''s schedule');
      exception when others then
        perform assert(sqlerrm like '%own team%', 'schedules: a supervisor cannot set a schedule outside their team');
      end;
      begin
        perform public.set_work_pattern(array[kemi, obi], '{1,2,3}'::smallint[]);
        perform assert(false, 'schedules: a mixed list must be refused');
      exception when others then
        perform assert(sqlerrm like '%own team%', 'schedules: one person outside the team refuses the whole list');
      end;
      perform assert(not exists (select 1 from public.work_patterns where user_id = kemi),
        'schedules: and nobody on the list was changed');
      begin
        perform public.set_work_pattern(array[sade], '{1,2,3}'::smallint[]);
        perform assert(false, 'schedules: a supervisor has no schedule');
      exception when others then
        perform assert(sqlerrm like '%merchandisers and marketers%', 'schedules: only field staff have schedules');
      end;
      perform assert(public.is_working_day(obi, mon) is null,
        'schedules: a supervisor cannot read the schedule of someone outside their team');

      perform assert(public.set_work_pattern(array[kemi, uche], '{1,2,3,4,5,5}'::smallint[]) = 2,
        'schedules: a supervisor sets one pattern for several of their team at once');
      perform assert((select days from public.work_patterns where user_id = kemi) = '{1,2,3,4,5}'::smallint[],
        'schedules: the days are kept once each, in order');
      perform assert(not public.is_working_day(kemi, sat) and public.is_working_day(kemi, mon),
        'schedules: Monday to Friday means Saturday is off');
      perform assert((select count(*) from public.audit_log
                      where action = 'schedule.pattern' and actor_id = sola and target_id in (kemi, uche)) = 2,
        'schedules: each person changed has an audit row');

      -- One date changed: an extra day in, an extra day off.
      lv := public.set_schedule_override(kemi, sat, true, 'Stock count weekend');
      perform assert(public.is_working_day(kemi, sat), 'schedules: an extra day in makes a day off a working day');
      perform public.set_schedule_override(kemi, mon, false, '');
      perform assert(not public.is_working_day(kemi, mon), 'schedules: an extra day off makes a working day off');
      perform public.set_schedule_override(kemi, mon, true, 'Changed my mind');
      perform assert((select count(*) from public.schedule_overrides where user_id = kemi and day = mon) = 1
                     and public.is_working_day(kemi, mon),
        'schedules: a second change on the same date replaces the first');
      perform public.remove_schedule_override(lv);
      perform assert(not public.is_working_day(kemi, sat), 'schedules: removing the change puts the pattern back');
      perform assert(exists (select 1 from public.audit_log where action = 'schedule.override_remove' and target_id = kemi),
        'schedules: date changes are audited');
      begin
        perform public.set_schedule_override(kemi, d0 + 400, true, '');
        perform assert(false, 'schedules: a date years ahead must be refused');
      exception when others then
        perform assert(sqlerrm like '%within the next year%', 'schedules: a date more than a year ahead is refused');
      end;
      perform act_as(sade);
      begin
        perform public.set_schedule_override(kemi, sat, true, '');
        perform assert(false, 'schedules: another supervisor must not change the date');
      exception when others then
        perform assert(sqlerrm like '%own team%', 'schedules: another supervisor cannot change someone''s dates');
      end;

      -- Leave: asking, overlaps, limits.
      perform act_as(kemi);
      lv := public.apply_leave('annual', mon, mon + 2, 'Family wedding in Enugu');
      perform assert((select status from public.leave_requests where id = lv) = 'pending',
        'leave: a request starts as pending');
      perform assert(public.is_working_day(kemi, mon + 1), 'leave: a pending request does not change the day');
      begin
        perform public.apply_leave('sick', mon + 1, mon + 5, 'Malaria treatment');
        perform assert(false, 'leave: an overlap must be refused');
      exception when others then
        perform assert(sqlerrm like '%already have leave%', 'leave: a request overlapping one still waiting is refused');
      end;
      begin
        perform public.apply_leave('sick', d0 - 8, d0 - 8, 'Was ill');
        perform assert(false, 'leave: too far back must be refused');
      exception when others then
        perform assert(sqlerrm like '%7 days ago%', 'leave: a start more than 7 days back is refused');
      end;
      perform assert(public.apply_leave('sick', d0 - 7, d0 - 7, 'Was ill with fever') is not null,
        'leave: a start exactly 7 days back is accepted');
      begin
        perform public.apply_leave('casual', mon + 20, mon + 19, 'Errand');
        perform assert(false, 'leave: dates the wrong way round must be refused');
      exception when others then
        perform assert(sqlerrm like '%before the first day%', 'leave: the last day cannot be before the first');
      end;
      begin
        perform public.apply_leave('casual', mon + 20, mon + 20, '  ');
        perform assert(false, 'leave: a reason is required');
      exception when others then
        perform assert(sqlerrm like '%Say why%', 'leave: a reason is required');
      end;
      begin
        perform public.apply_leave('holiday', mon + 20, mon + 20, 'Rest');
        perform assert(false, 'leave: an unknown type must be refused');
      exception when others then
        perform assert(sqlerrm like '%type of leave%', 'leave: only the four types are accepted');
      end;

      -- Deciding: never the person themselves, only their supervisor or an admin.
      begin
        perform public.decide_leave(lv, true, '');
        perform assert(false, 'leave: staff must not decide leave');
      exception when others then
        perform assert(sqlerrm like '%Only admins and supervisors%', 'leave: staff cannot approve their own request');
      end;
      perform act_as(sade);
      begin
        perform public.decide_leave(lv, true, '');
        perform assert(false, 'leave: another team''s supervisor must not decide');
      exception when others then
        perform assert(sqlerrm like '%own team%', 'leave: a supervisor cannot decide leave outside their team');
      end;
      insert into public.leave_requests (user_id, kind, from_date, to_date, reason)
      values (boss, 'annual', mon, mon, 'Admin''s own day') returning id into lv2;
      perform act_as(boss);
      begin
        perform public.decide_leave(lv2, true, '');
        perform assert(false, 'leave: nobody decides their own leave');
      exception when others then
        perform assert(sqlerrm like '%your own leave%', 'leave: an admin cannot approve their own leave');
      end;
      delete from public.leave_requests where id = lv2;

      perform act_as(sola);
      res := public.decide_leave(lv, true, 'Enjoy the wedding');
      perform assert(res->>'status' = 'approved' and (res->>'user_id')::uuid = kemi,
        'leave: the supervisor approves, and is told whose request it was');
      perform assert(not public.is_working_day(kemi, mon) and not public.is_working_day(kemi, mon + 2),
        'leave: approved leave makes each of its days a non-working day');
      perform assert(public.day_kind(kemi, mon + 1) = 'leave' and public.day_kind(kemi, mon + 3) = 'working',
        'leave: the days read as leave, and the day after as working');
      perform assert(exists (select 1 from public.audit_log
                             where action = 'leave.approve' and actor_id = sola and target_id = lv),
        'leave: the decision is audited');
      begin
        perform public.decide_leave(lv, false, '');
        perform assert(false, 'leave: a decided request must not be decided again');
      exception when others then
        perform assert(sqlerrm like '%already been decided%', 'leave: a decision cannot be changed by deciding again');
      end;

      perform act_as(kemi);
      begin
        perform public.cancel_leave(lv);
        perform assert(false, 'leave: an approved request must not be cancelled by the person');
      exception when others then
        perform assert(sqlerrm like '%still waiting%', 'leave: only a pending request can be cancelled');
      end;
      begin
        perform public.apply_leave('casual', mon + 2, mon + 4, 'Another errand');
        perform assert(false, 'leave: an overlap with approved leave must be refused');
      exception when others then
        perform assert(sqlerrm like '%already have leave%', 'leave: a request overlapping approved leave is refused');
      end;
      lv2 := public.apply_leave('casual', mon + 10, mon + 10, 'Bank visit');
      perform public.cancel_leave(lv2);
      perform assert((select status from public.leave_requests where id = lv2) = 'cancelled',
        'leave: the person cancels a request still waiting');
      lv2 := public.apply_leave('casual', mon + 10, mon + 10, 'Bank visit again');
      perform act_as(boss);
      perform public.decide_leave(lv2, false, 'We are short that day');
      perform assert(public.is_working_day(kemi, mon + 10)
                     and (select decision_note from public.leave_requests where id = lv2) = 'We are short that day',
        'leave: an admin rejects with a note, and the day stays a working day');
      perform act_as(kemi);
      perform assert(public.apply_leave('casual', mon + 10, mon + 10, 'Bank visit, third try') is not null,
        'leave: cancelled and rejected requests do not block asking again');

      -- The no-show sweep and the absentee list skip days off and leave.
      perform act_as(boss);
      perform public.set_work_pattern(array[kemi, obi, uche], '{0,1,2,3,4,5,6}'::smallint[]);
      perform public.set_schedule_override(kemi, d0, false, 'Swapped for Saturday');
      perform act_as(uche);
      lv := public.apply_leave('sick', d0, d0, 'Hospital appointment');
      perform act_as(boss);
      perform public.decide_leave(lv, true, '');
      perform assert(exists (select 1 from public.staff_no_show(0) where user_id = obi),
        'sweep: someone working today with no clock-in is reported');
      perform assert(not exists (select 1 from public.staff_no_show(0) where user_id in (kemi, uche)),
        'sweep: nobody on a day off or on leave is reported');
      perform assert(exists (select 1 from public.absentees_today() where user_id = obi)
                     and not exists (select 1 from public.absentees_today() where user_id in (kemi, uche)),
        'sweep: the absentee list leaves out days off and leave');
      perform assert((public.admin_overview()->>'not_expected')::int >= 2,
        'sweep: the overview counts who is not expected today');

      -- The staff calendar: missed days in the past, days off, today.
      update public.profiles set created_at = now() - interval '10 days' where id = obi;
      perform public.set_schedule_override(obi, d0 - 2, false, '');
      perform act_as(obi);
      select * into cal from public.my_calendar(d0 - 1, d0 - 1);
      perform assert(cal.kind = 'working' and cal.missed and not cal.clocked_in,
        'calendar: a past working day with no clock-in is missed');
      select * into cal from public.my_calendar(d0 - 2, d0 - 2);
      perform assert(cal.kind = 'off' and not cal.missed, 'calendar: a day off is never missed');
      select * into cal from public.my_calendar(d0, d0);
      perform assert(not cal.missed, 'calendar: today is not missed yet');
      perform assert((select count(*) from public.my_calendar(d0 - 30, d0 - 1) where missed) = 9,
        'calendar: nothing is missed before the account was made');
      perform act_as(uche);
      select * into cal from public.my_calendar(d0, d0);
      perform assert(cal.kind = 'leave', 'calendar: approved leave shows as leave');
      perform act_as(ada);
      select * into cal from public.my_calendar(d0, d0);
      perform assert(cal.clocked_in, 'calendar: a day with a clock-in shows it');
      perform act_as(boss);
    end;
    -- Store visits keep to the person's own stores, and the report keeps
    -- the day's visits (060).
    declare
      mk      uuid := gen_random_uuid();
      allen   uuid;
      ogba    uuid;
      v1      uuid;
      rep     uuid;
      snap    jsonb;
    begin
      perform act_as(boss);
      insert into auth.users (id, email) values (mk, 'chidi.mkt@xpel.ng');
      insert into public.profiles (id, full_name, email, role, outlet_id)
      values (mk, 'Chidi Obi', 'chidi.mkt@xpel.ng', 'marketer', null);
      perform notifications_on(mk);
      insert into public.outlets (name, address, lat, lng, geofence_radius_m)
      values ('Allen Avenue Beauty', '12 Allen Avenue, Ikeja', 6.5200, 3.3700, 60) returning id into allen;
      insert into public.outlets (name, lat, lng, geofence_radius_m)
      values ('Ogba Cosmetics', 6.5300, 3.3700, 60) returning id into ogba;
      perform set_staff_outlets(mk, array[allen]);

      perform act_as(mk);
      perform assert(public.has_allocated_stores(mk), 'visits: the marketer has a store allocated');
      perform assert((select count(*) from public.my_visit_stores()) = 1
                     and (select name from public.my_visit_stores()) = 'Allen Avenue Beauty',
        'visits: the store picker lists only their allocated store');

      begin
        insert into public.store_visits (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
        values (ogba, 6.5300, 3.3700, 10, now());
        perform assert(false, 'visits: a store picked by hand that is not theirs is refused');
      exception when others then
        perform assert(sqlerrm = 'This store is not on your list. Ask your supervisor to add it.',
          'visits: a store picked by hand that is not theirs is refused');
      end;
      begin
        insert into public.store_visits (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
        values (6.5301, 3.3701, 10, now());
        perform assert(false, 'visits: standing in a store that is not theirs is refused');
      exception when others then
        perform assert(sqlerrm like 'This store is not on your list%',
          'visits: standing in a store that is not theirs is refused');
      end;
      perform assert(not exists (select 1 from public.store_visits where user_id = mk),
        'visits: and neither refusal left a visit behind');

      insert into public.store_visits (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at,
                                       arrived_place_name)
      values (6.5201, 3.3701, 10, now(), 'Allen Avenue Beauty') returning id into v1;
      perform assert((select outlet_id from public.store_visits where id = v1) = allen
                     and (select arrived_status from public.store_visits where id = v1) = 'on_site',
        'visits: standing in their own store is recognised and on site');
      perform public.end_store_visit(v1, 6.5201, 3.3701, 10, null, null);
      update public.store_visits set arrived_at = now() - interval '50 minutes', departed_at = now() - interval '5 minutes'
       where id = v1;

      insert into public.store_visits (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
      values (allen, 6.5201, 3.3701, 10, now()) returning id into v1;
      perform assert((select outlet_id from public.store_visits where id = v1) = allen,
        'visits: picking their own store by hand is allowed');

      -- The report: the database fills in the day's visits, whatever was sent.
      insert into public.reports (body, sales_summary, stock_status, store_visits)
      values ('A steady day at Allen.', 'Twelve units of toner.', 'Serum is running low.',
              '[{"store": "Made up by the phone", "minutes": 999}]'::jsonb)
      returning id into rep;
      snap := (select store_visits from public.reports where id = rep);
      perform assert(jsonb_array_length(snap) = 2,
        'reports: the report keeps the day''s two visits');
      perform assert(not exists (select 1 from jsonb_array_elements(snap) e where e->>'store' = 'Made up by the phone'),
        'reports: and ignores visits the phone sent');
      perform assert((snap->0->>'outlet_name') = 'Allen Avenue Beauty'
                     and (snap->0->>'minutes')::int = 45
                     and snap->0->>'departed_at' is not null
                     and snap->1->>'departed_at' is null
                     and (snap->0->>'address') = '12 Allen Avenue, Ikeja',
        'reports: each visit has its store, address, times and minutes, in order');

      perform public.end_store_visit(v1, 6.5201, 3.3701, 10, null, null);
      update public.reports set issues = 'Need more testers.', store_visits = '[]'::jsonb where id = rep;
      snap := (select store_visits from public.reports where id = rep);
      perform assert(jsonb_array_length(snap) = 2 and snap->1->>'departed_at' is not null,
        'reports: saving the report again refreshes the visits, and cannot clear them');

      -- With no allocation, any known store will do, as before.
      perform act_as(boss);
      perform set_staff_outlets(mk, array[]::uuid[]);
      perform act_as(mk);
      perform assert(not public.has_allocated_stores(mk)
                     and (select count(*) from public.my_visit_stores()) = 0,
        'visits: with no allocation, the picker has no stores to offer');
      insert into public.store_visits (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
      values (ogba, 6.5300, 3.3700, 10, now()) returning id into v1;
      perform assert((select outlet_id from public.store_visits where id = v1) = ogba,
        'visits: with no allocation, a store picked by hand is allowed');
      perform public.end_store_visit(v1, 6.5300, 3.3700, 10, null, null);
      insert into public.store_visits (arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at)
      values (6.5301, 3.3701, 10, now()) returning id into v1;
      perform assert((select outlet_id from public.store_visits where id = v1) = ogba,
        'visits: with no allocation, standing in a known store is recognised');
      perform public.end_store_visit(v1, 6.5301, 3.3701, 10, null, null);
      perform act_as(boss);
    end;

    -- Activity log (062): sign-ins, app opens and the rest, for admins only.
    declare
      femi   uuid := gen_random_uuid();
      d0     date := (now() at time zone 'Africa/Lagos')::date;
      lv     uuid;
      tid    uuid;
      ok     boolean;
      n      integer;
      pic    text;
      feed   record;
    begin
      perform act_as(boss);
      insert into auth.users (id, email) values (femi, 'femi.activity@xpel.ng');
      insert into public.profiles (id, full_name, email, role, outlet_id)
      values (femi, 'Femi Adebayo', 'femi.activity@xpel.ng', 'merchandiser', mall_id);

      ok := public.record_activity(femi, 'sign_in', '102.89.33.7', 'android', 131,
              'Mozilla/5.0 (Linux; Android 14; SM-A546E) Chrome/128 Mobile Safari/537.36 XtendApp',
              '{"type": "phone", "os": "Android 14", "browser": "Xtend app", "app": true}'::jsonb);
      perform assert(ok, 'activity: a sign-in is recorded');
      perform assert((select platform from public.user_activity where user_id = femi and kind = 'sign_in') = 'android'
                     and (select app_build from public.user_activity where user_id = femi and kind = 'sign_in') = 131
                     and (select ip from public.user_activity where user_id = femi and kind = 'sign_in') = '102.89.33.7',
        'activity: with the platform, app build and IP');

      ok := public.record_activity(femi, 'app_open', '102.89.33.7', 'android', 131, null, null, '{}'::jsonb, now() - interval '50 minutes');
      perform assert(ok, 'activity: the first app open is recorded');
      ok := public.record_activity(femi, 'app_open', '102.89.33.7', 'android', 131, null, null, '{}'::jsonb, now() - interval '30 minutes' + interval '10 seconds');
      perform assert(not ok, 'activity: another open within 30 minutes on the same platform is skipped');
      ok := public.record_activity(femi, 'app_open', '102.89.33.8', 'web', null, null, null, '{}'::jsonb, now() - interval '25 minutes');
      perform assert(ok, 'activity: an open on another platform is its own row');
      ok := public.record_activity(femi, 'app_open', '102.89.33.7', 'android', 131, null, null, '{}'::jsonb, now() - interval '15 minutes');
      perform assert(ok, 'activity: 35 minutes later the app open counts again');
      perform assert((select count(*) from public.user_activity where user_id = femi and kind = 'app_open') = 3,
        'activity: three app opens kept, one skipped');
      ok := public.record_activity(femi, 'app_open', null, 'symbian', null,
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari XtendApp');
      perform assert(ok and (select platform from public.user_activity where user_id = femi order by id desc limit 1) = 'ios',
        'activity: an unknown platform is read from the browser string instead');

      begin
        perform public.record_activity(femi, 'clock_in');
        perform assert(false, 'activity: only the known kinds are recorded');
      exception when others then
        perform assert(sqlerrm like 'Unknown activity%', 'activity: only the known kinds are recorded');
      end;
      begin
        insert into public.user_activity (user_id, kind) values (femi, 'hacked');
        perform assert(false, 'activity: the table refuses an unknown kind');
      exception when check_violation then
        perform assert(true, 'activity: the table refuses an unknown kind');
      end;

      -- Things already kept elsewhere show up in the feed too.
      perform notifications_on(femi);
      insert into public.work_patterns (user_id, days) values (femi, '{0,1,2,3,4,5,6}');
      perform act_as(femi);
      insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at, device_info)
      values ('opening', 6.6019, 3.3516, 12, fresh_photo('selfies', 'femi-1.jpg'), now(),
              '{"ua": "Mozilla/5.0 (Linux; Android 14) XtendApp", "native": {"platform": "android"}}'::jsonb);
      lv := public.apply_leave('annual', d0 + 20, d0 + 22, 'My sister''s wedding');
      perform public.cancel_leave(lv);
      tid := public.open_support_thread('Phone is slow', 'The app is slow on my phone.');
      perform act_as(boss);
      perform public.post_support_message(tid, 'Try restarting the phone.');

      -- A new profile photo is recorded where it is set, with the browser.
      perform act_as(femi);
      perform set_config('request.headers',
        '{"user-agent": "Mozilla/5.0 (Linux; Android 14) XtendApp", "x-forwarded-for": "41.58.1.2, 10.0.0.1"}', true);
      insert into storage.buckets (id, name) values ('avatars', 'avatars') on conflict do nothing;
      pic := femi::text || '/face.jpg';
      insert into storage.objects (bucket_id, name) values ('avatars', pic);
      perform public.set_my_avatar(pic);
      perform set_config('request.headers', '', true);
      perform assert(exists (select 1 from public.user_activity where user_id = femi and kind = 'photo_changed'
                             and ip = '41.58.1.2' and platform = 'android'),
        'activity: a new profile photo is recorded with its IP and platform');

      -- Only admins read the feed.
      begin
        perform * from public.activity_feed(d0, d0);
        perform assert(false, 'activity: staff cannot read the activity log');
      exception when others then
        perform assert(sqlerrm = 'Only admins can see the activity log', 'activity: staff cannot read the activity log');
      end;
      perform act_as(tunde);
      begin
        perform * from public.activity_feed(d0, d0);
        perform assert(false, 'activity: supervisors cannot read the activity log');
      exception when others then
        perform assert(sqlerrm = 'Only admins can see the activity log', 'activity: supervisors cannot read the activity log');
      end;

      perform act_as(boss);
      perform assert((select array_agg(label) from public.activity_feed(d0, d0, femi))
                       @> array['Signed in', 'Opened the app', 'Clocked in at Ikeja City Mall', 'Asked for leave',
                                'Cancelled a leave request', 'Sent a support message', 'Changed their profile photo'],
        'activity: the feed has sign-in, app opens, clock-in, leave, support and photo, in plain English');
      perform assert((select count(*) from public.activity_feed(d0, d0, femi) where kind = 'support_message') = 1,
        'activity: the office''s reply is not counted as the person''s message');
      select * into feed from public.activity_feed(d0, d0, femi) f where f.kind = 'clock_in';
      perform assert(feed.platform = 'android' and feed.full_name = 'Femi Adebayo' and feed.role = 'merchandiser'
                     and feed.detail->>'store' = 'Ikeja City Mall',
        'activity: a clock-in carries the person, the platform and the store');
      select * into feed from public.activity_feed(d0, d0, femi) f where f.kind = 'sign_in';
      perform assert(feed.device = 'Xtend app on Android 14' and feed.ip = '102.89.33.7'
                     and (feed.detail->>'app_build')::int = 131,
        'activity: a sign-in carries the device, IP and app build');
      perform assert((select bool_and(a.at >= b.at)
                      from (select f.at, row_number() over () as i from public.activity_feed(d0, d0, femi) f) a
                      join (select f.at, row_number() over () as i from public.activity_feed(d0, d0, femi) f) b on b.i = a.i + 1),
        'activity: newest first');
      perform assert(exists (select 1 from public.activity_feed(d0, d0) f where f.label = 'Checked in at Allen Avenue Beauty')
                     and exists (select 1 from public.activity_feed(d0, d0) f where f.label = 'Checked out of Allen Avenue Beauty')
                     and exists (select 1 from public.activity_feed(d0, d0) f where f.label = 'Filed the daily report')
                     and exists (select 1 from public.activity_feed(d0, d0) f where f.label like 'Submitted a stock count at %'),
        'activity: store visits, reports and stock counts are in the feed');
      perform assert((select count(*) from public.activity_feed(d0, d0, femi, array['sign_in', 'app_open']))
                       = (select count(*) from public.user_activity a
                          where a.user_id = femi and a.kind in ('sign_in', 'app_open')
                            and a.at >= d0::timestamp at time zone 'Africa/Lagos')
                     and not exists (select 1 from public.activity_feed(d0, d0, femi, array['sign_in', 'app_open']) f
                                     where f.kind not in ('sign_in', 'app_open')),
        'activity: the kinds filter keeps only what was asked for');
      perform assert((select count(*) from public.activity_feed(d0, d0, null, null, 3)) = 3,
        'activity: the limit is kept');

      -- Dates are Lagos days.
      ok := public.record_activity(femi, 'sign_out', null, 'web', null, null, null, '{}'::jsonb,
              ((d0 - 40)::timestamp + interval '23 hours 30 minutes') at time zone 'Africa/Lagos');
      perform assert(not exists (select 1 from public.activity_feed(d0 - 30, d0, femi) f where f.kind = 'sign_out'),
        'activity: an older sign-out is outside the range');
      perform assert((select count(*) from public.activity_feed(d0 - 40, d0 - 40, femi) f where f.label = 'Signed out') = 1,
        'activity: and inside its own Lagos day, even late in the evening');
      perform assert(not exists (select 1 from public.activity_feed(d0 - 39, d0 - 39, femi)),
        'activity: not on the next day');
      begin
        perform * from public.activity_feed(d0, d0 - 1);
        perform assert(false, 'activity: the end cannot be before the start');
      exception when others then
        perform assert(sqlerrm like 'The end date cannot be before%', 'activity: the end cannot be before the start');
      end;

      -- Kept 180 days.
      ok := public.record_activity(femi, 'sign_in', null, 'web', null, null, null, '{}'::jsonb, now() - interval '200 days');
      n := public.purge_user_activity();
      perform assert(n = 1 and not exists (select 1 from public.user_activity where user_id = femi and at < now() - interval '180 days')
                     and exists (select 1 from public.user_activity where user_id = femi and kind = 'sign_out'),
        'activity: rows older than 180 days are purged, newer ones kept');
    end;

    -- ---------------------------------------------------------------
    -- X Metrics feature switches (063): parts switched off stop their
    -- work and refuse new records; nothing is deleted; back on resumes.
    -- ---------------------------------------------------------------
    declare
      dayo   uuid := gen_random_uuid();
      shop   uuid;
      lotion uuid;
      c1     uuid;
      c2     uuid;
      f      jsonb;
      g      jsonb;
      hist   integer;
      recs   integer;
      d2     date := ((now() - interval '36 hours') at time zone 'Africa/Lagos')::date;
    begin
      perform act_as(boss);
      perform assert((select enabled and expiry_enabled and supplies_enabled and grading_enabled and sales_enabled
                             and reconcile_from is null from public.xm_settings),
        'xm features: every part is on once 0063 has run, so nothing changes');
      perform assert(public.xm_feature_on('xmetrics') and public.xm_feature_on('expiry')
                     and public.xm_feature_on('supplies') and public.xm_feature_on('grading')
                     and public.xm_feature_on('sales') and public.xm_feature_on('reconcile')
                     and not public.xm_feature_on('nonsense'),
        'xm features: each part reads as on, and an unknown part as off');

      insert into auth.users (id, email) values (dayo, 'xmf-test@xpel.ng');
      insert into public.outlets (name, lat, lng, geofence_radius_m)
      values ('XMF Test Store', 6.6000, 3.4000, 100) returning id into shop;
      insert into public.profiles (id, full_name, email, role, outlet_id)
      values (dayo, 'Dayo Ogun', 'xmf-test@xpel.ng', 'merchandiser', shop);
      insert into public.products (name, sku, category, unit) values ('XMF Lotion', 'XMF-LOT', 'Body', 'bottle')
      returning id into lotion;
      perform public.xm_set_store(shop, true);

      -- Only admins switch parts, and every change is kept.
      perform act_as(dayo);
      begin
        perform public.xm_set_features(false, true, true, true, true);
        perform assert(false, 'xm features: staff cannot switch X Metrics off');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%', 'xm features: staff cannot switch X Metrics off');
      end;
      perform act_as(tunde);
      begin
        perform public.xm_set_features(true, false, true, true, true);
        perform assert(false, 'xm features: supervisors cannot switch parts off');
      exception when others then
        perform assert(sqlerrm like '%Only an admin%', 'xm features: supervisors cannot switch parts off');
      end;
      perform act_as(boss);
      begin
        perform public.xm_set_features(true, null, true, true, true);
        perform assert(false, 'xm features: each switch must be on or off');
      exception when others then
        perform assert(sqlerrm like '%on or off%', 'xm features: each switch must be on or off');
      end;

      -- An opening count while everything is on.
      perform act_as(dayo);
      c1 := public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
        'product_id', lotion, 'batch', 'L1', 'expiry_date', public.business_date() + 20,
        'on_shelf', 100, 'in_backroom', 0)), 6.6, 3.4, 10,
        fresh_photo('reports', 'xmf-1.jpg'), now() - interval '60 hours');

      -- Supplies and sales off.
      perform act_as(boss);
      hist := (select count(*) from public.xm_settings_history);
      f := public.xm_set_features(true, true, false, true, false);
      perform assert(f->>'supplies' = 'false' and f->>'sales' = 'false' and f->>'enabled' = 'true',
        'xm features: an admin switches supplies and sales off');
      perform assert((select count(*) from public.xm_settings_history) = hist + 1
                     and (select (settings->>'sales_enabled')::boolean and changed_by = boss
                          from public.xm_settings_history order by id desc limit 1),
        'xm features: the earlier switches are kept in the history, with who changed them');
      perform assert(not public.xm_feature_on('reconcile') and public.xm_feature_on('xmetrics'),
        'xm features: reconciliation is off without supplies and sales; X Metrics stays on');
      begin
        perform public.xm_log_supply(shop, lotion, 50, 'L1', null, d2, null);
        perform assert(false, 'xm features: no supplies are logged while supplies are off');
      exception when others then
        perform assert(sqlerrm like 'Supplies are switched off%', 'xm features: no supplies are logged while supplies are off');
      end;
      begin
        perform public.xm_create_supply_import('invoice.csv', 'csv', 'table', null, null, null, 1);
        perform assert(false, 'xm features: no supply imports while supplies are off');
      exception when others then
        perform assert(sqlerrm like 'Supplies are switched off%', 'xm features: no supply imports while supplies are off');
      end;
      begin
        perform public.xm_set_target(d2, dayo, null, 100);
        perform assert(false, 'xm features: no targets while sales are off');
      exception when others then
        perform assert(sqlerrm like '%switched off%', 'xm features: no targets while sales are off');
      end;
      perform act_as(dayo);
      begin
        perform public.xm_submit_sales(shop, d2, jsonb_build_array(jsonb_build_object('product_id', lotion, 'units', 5)),
          fresh_photo('reports', 'xmf-s.jpg'), now() - interval '36 hours');
        perform assert(false, 'xm features: staff sales are refused while sales are off');
      exception when others then
        perform assert(sqlerrm = 'Sales are not being collected at the moment',
          'xm features: staff sales are refused, in plain words, while sales are off');
      end;
      -- Counts still come in, but are not reconciled.
      c2 := public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
        'product_id', lotion, 'batch', 'L1', 'expiry_date', public.business_date() + 20,
        'on_shelf', 40, 'in_backroom', 0)), 6.6, 3.4, 10,
        fresh_photo('reports', 'xmf-2.jpg'), now() - interval '36 hours');
      perform act_as(boss);
      perform assert(public.xm_reconcile_pending() = 0
                     and (select reconciled_at is null from public.xm_counts where id = c2),
        'xm features: reconciliation skips while supplies or sales are off, and the counts wait');

      -- Expiry off: no alerts raised or sent; the dates are kept.
      f := public.xm_set_features(true, false, false, true, false);
      perform assert(public.xm_expiry_scan() = 0
                     and not exists (select 1 from public.xm_expiry_alerts where outlet_id = shop),
        'xm features: no expiry alerts while expiry is off');
      perform assert((select expiry_date is not null from public.xm_count_lines where count_id = c2),
        'xm features: expiry dates already recorded are kept');
      -- Grades leave the switched-off parts out.
      g := public.xm_grade(dayo, d2);
      perform assert(g->'parts' = '{"sales": false, "accuracy": false, "expiry": false}'::jsonb
                     and g->'sales'->>'score' is null and g->'accuracy'->>'score' is null
                     and g->'expiry'->>'score' is null and g->'consistency'->>'sales_on_time' is null,
        'xm features: grades leave out sales, accuracy and expiry while they are off');

      -- Grading off.
      f := public.xm_set_features(true, false, false, false, false);
      begin
        perform public.xm_grade(dayo, d2);
        perform assert(false, 'xm features: no grades while grading is off');
      exception when others then
        perform assert(sqlerrm like 'Grading is switched off%', 'xm features: no grades while grading is off');
      end;
      perform assert(not exists (select 1 from public.xm_month_grades(d2)),
        'xm features: nobody is listed for grading while it is off');
      begin
        perform public.xm_finalise_month((date_trunc('month', public.business_date()) - interval '1 month')::date);
        perform assert(false, 'xm features: a month is not finalised while grading is off');
      exception when others then
        perform assert(sqlerrm like 'Grading is switched off%', 'xm features: a month is not finalised while grading is off');
      end;
      begin
        insert into public.xm_monthly_grades (month, user_id, grade)
        values (date_trunc('month', public.business_date())::date, dayo, '{}'::jsonb);
        perform assert(false, 'xm features: no grade is kept while grading is off');
      exception when others then
        perform assert(sqlerrm like 'Grading is switched off%', 'xm features: no grade is kept while grading is off');
      end;

      -- The whole module off.
      f := public.xm_set_features(false, true, true, true, true);
      perform assert(not public.xm_feature_on('sales') and not public.xm_feature_on('supplies')
                     and not public.xm_feature_on('expiry') and not public.xm_feature_on('grading'),
        'xm features: with X Metrics off, every part is off whatever its own switch says');
      perform act_as(dayo);
      begin
        perform public.xm_submit_count(shop, jsonb_build_array(jsonb_build_object(
          'product_id', lotion, 'batch', 'L1', 'on_shelf', 30, 'in_backroom', 0)), 6.6, 3.4, 10,
          fresh_photo('reports', 'xmf-off.jpg'), now() - interval '1 hour');
        perform assert(false, 'xm features: no counts while X Metrics is off');
      exception when others then
        perform assert(sqlerrm = 'Stock counts are not being collected here at the moment',
          'xm features: counts are refused, in plain words, while X Metrics is off');
      end;
      perform act_as(boss);
      perform assert(public.xm_reconcile_pending() = 0 and public.xm_expiry_scan() = 0
                     and (select count(*) from public.xm_claim_expiry_alerts()) = 0,
        'xm features: the hourly sweep does nothing while X Metrics is off');
      perform assert((select count(*) from public.xm_counts where outlet_id = shop) = 2,
        'xm features: switching off deletes nothing');

      -- Back on: work resumes, and the counts taken while it was off are
      -- not compared across the gap.
      perform assert((select reconcile_from is null from public.xm_settings),
        'xm features: reconciliation has no restart date before it comes back on');
      f := public.xm_set_features(true, true, true, true, true);
      perform assert((f->>'reconcile_from')::date = public.business_date(),
        'xm features: reconciliation restarts from the day it comes back on');
      recs := (select count(*) from public.xm_reconciliations r join public.xm_counts c on c.id = r.count_id
               where c.outlet_id = shop);
      perform assert(public.xm_reconcile_pending() >= 2, 'xm features: back on, the waiting counts are settled');
      perform assert((select reconciled_at is not null from public.xm_counts where id = c2)
                     and (select count(*) from public.xm_reconciliations r join public.xm_counts c on c.id = r.count_id
                          where c.outlet_id = shop) = recs
                     and not exists (select 1 from public.integrity_flags where kind = 'stock_discrepancy' and user_id = dayo),
        'xm features: back on, the waiting counts are settled as baselines and nobody is flagged for the gap');
      perform act_as(dayo);
      perform public.xm_submit_sales(shop, public.business_date(),
        jsonb_build_array(jsonb_build_object('product_id', lotion, 'units', 5)),
        fresh_photo('reports', 'xmf-s2.jpg'), now());
      perform assert(exists (select 1 from public.xm_sales where user_id = dayo),
        'xm features: back on, staff sales are taken again');
      perform act_as(boss);
      perform assert(public.xm_expiry_scan() >= 1, 'xm features: back on, the expiry check runs again');
      perform assert(exists (select 1 from public.xm_expiry_alerts where outlet_id = shop),
        'xm features: back on, expiry alerts resume from the dates kept');
      g := public.xm_grade(dayo, d2);
      perform assert(g->'parts' = '{"sales": true, "accuracy": true, "expiry": true}'::jsonb,
        'xm features: back on, grades weigh every part again');
      perform public.xm_log_supply(shop, lotion, 10, 'L2', null, public.business_date(), null);
      perform assert(exists (select 1 from public.xm_supplies where outlet_id = shop),
        'xm features: back on, supplies are logged again');
      -- Changing other settings keeps the restart date.
      update public.xm_settings set tolerance_pct = tolerance_pct;
      perform assert((select reconcile_from = public.business_date() from public.xm_settings),
        'xm features: other setting changes leave the restart date alone');
    end;

  end;

  -- ---------------------------------------------------------------
  -- Documents on the daily report (0064).
  -- ---------------------------------------------------------------
  declare
    tobi   uuid := gen_random_uuid();
    lead   uuid := gen_random_uuid();
    merch  uuid := gen_random_uuid();
    shop   uuid;
    rep    uuid;
    f1     uuid;
    f2     uuid;
    gone   text;
    k      integer;
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values
      (tobi, 'tobi.rf@xpel.ng'), (lead, 'lead.rf@xpel.ng'), (merch, 'merch.rf@xpel.ng');
    insert into public.outlets (name, lat, lng) values ('RF Store', 6.45, 3.4) returning id into shop;
    insert into public.profiles (id, full_name, email, role) values
      (lead, 'Lara Lead', 'lead.rf@xpel.ng', 'supervisor');
    insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id) values
      (tobi, 'Tobi Adeyemi', 'tobi.rf@xpel.ng', 'marketer', shop, lead),
      (merch, 'Mide Merch', 'merch.rf@xpel.ng', 'merchandiser', shop, null);
    perform assert(exists (select 1 from storage.buckets where id = 'report-files' and not public),
      'report files: the report-files bucket exists and is private');

    perform act_as(tobi);
    insert into storage.objects (bucket_id, name, metadata) values
      ('report-files', tobi || '/a.pdf', '{"mimetype":"application/pdf","size":200000}'),
      ('report-files', tobi || '/b.docx', '{"mimetype":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","size":40000}'),
      ('report-files', tobi || '/c.exe', '{"mimetype":"application/x-msdownload","size":100}'),
      ('report-files', tobi || '/d.pdf', '{"mimetype":"application/pdf","size":10485761}'),
      ('report-files', tobi || '/e.pdf', '{"mimetype":"application/pdf","size":0}'),
      ('report-files', lead || '/not-mine.pdf', '{"mimetype":"application/pdf","size":100}'),
      ('reports', tobi || '/wrong-bucket.pdf', '{"mimetype":"application/pdf","size":100}');

    begin
      perform public.add_report_file(tobi || '/a.pdf', 'a.pdf');
      perform assert(false, 'report files: nothing is attached before the report is saved');
    exception when others then
      perform assert(sqlerrm like 'Save today''s report first%', 'report files: nothing is attached before the report is saved');
    end;

    insert into public.reports (body, sales_summary, stock_status)
    values ('Good day at the store', 'Sold twenty units', 'Shelves are full') returning id into rep;

    f1 := public.add_report_file(tobi || '/a.pdf', E'Price\nsurvey.pdf');
    perform assert((select rf.report_id = rep and rf.user_id = tobi and rf.mime = 'application/pdf'
                           and rf.size_bytes = 200000 and rf.name = 'Price survey.pdf'
                    from public.report_files rf where rf.id = f1),
      'report files: a PDF is attached to today''s report, with its type and size from storage');
    f2 := public.add_report_file(tobi || '/b.docx', 'Display plan.docx');
    perform assert(f2 is not null, 'report files: a Word document is accepted');
    -- Since 0065 the same file sent again is the same attachment, not a second.
    perform assert(public.add_report_file(tobi || '/a.pdf', 'again.pdf') = f1
                   and (select count(*) from public.report_files where path = tobi || '/a.pdf') = 1,
      'report files: the same file cannot be attached twice');
    begin
      perform public.add_report_file(tobi || '/c.exe', 'tool.exe');
      perform assert(false, 'report files: a program is refused');
    exception when others then
      perform assert(sqlerrm like 'Attach a PDF, Word, Excel%', 'report files: only documents and pictures are accepted');
    end;
    begin
      perform public.add_report_file(tobi || '/d.pdf', 'big.pdf');
      perform assert(false, 'report files: over 10 MB is refused');
    exception when others then
      perform assert(sqlerrm like '%10 MB or smaller%', 'report files: a document over 10 MB is refused');
    end;
    begin
      perform public.add_report_file(tobi || '/e.pdf', 'empty.pdf');
      perform assert(false, 'report files: an empty file is refused');
    exception when others then
      perform assert(sqlerrm like '%empty%', 'report files: an empty file is refused');
    end;
    begin
      perform public.add_report_file(lead || '/not-mine.pdf', 'x.pdf');
      perform assert(false, 'report files: a file from somebody else''s folder is refused');
    exception when others then
      perform assert(sqlerrm like 'Upload the document again%', 'report files: a file from somebody else''s folder is refused');
    end;
    begin
      perform public.add_report_file(tobi || '/wrong-bucket.pdf', 'x.pdf');
      perform assert(false, 'report files: only files in the report-files bucket');
    exception when others then
      perform assert(sqlerrm like 'Upload the document again%', 'report files: a file in another bucket is refused');
    end;
    begin
      insert into public.report_files (report_id, user_id, path, name, mime, size_bytes)
      values (rep, tobi, tobi || '/zz.txt', 'zz.txt', 'text/plain', 10);
      perform assert(false, 'report files: the table refuses a type not on the list');
    exception when others then
      perform assert(sqlerrm like '%report_files_mime_check%', 'report files: the table itself refuses a type not on the list');
    end;

    -- Five at most.
    for k in 1..3 loop
      insert into storage.objects (bucket_id, name, metadata)
      values ('report-files', tobi || '/more-' || k || '.xlsx',
              '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":5000}');
      perform public.add_report_file(tobi || '/more-' || k || '.xlsx', 'Sheet ' || k || '.xlsx');
    end loop;
    insert into storage.objects (bucket_id, name, metadata)
    values ('report-files', tobi || '/sixth.csv', '{"mimetype":"text/csv","size":50}');
    begin
      perform public.add_report_file(tobi || '/sixth.csv', 'sixth.csv');
      perform assert(false, 'report files: a sixth document is refused');
    exception when others then
      perform assert(sqlerrm like '%up to 5 documents%', 'report files: a report has at most five documents');
    end;

    -- Removing: only your own, only on the day.
    perform act_as(merch);
    begin
      perform public.remove_report_file(f2);
      perform assert(false, 'report files: nobody else removes a document');
    exception when others then
      perform assert(sqlerrm like '%not on your report%', 'report files: nobody else removes a document');
    end;
    begin
      perform public.add_report_file(merch || '/x.pdf', 'x.pdf');
      perform assert(false, 'report files: a merchandiser cannot attach to a report');
    exception when others then
      perform assert(sqlerrm like 'Only marketers%', 'report files: someone who does not file reports cannot attach documents');
    end;
    perform act_as(tobi);
    gone := public.remove_report_file(f2);
    perform assert(gone = tobi || '/b.docx' and not exists (select 1 from public.report_files where id = f2),
      'report files: the owner removes a document the same day, and is told which file to delete');
    perform assert((select editable from public.report_file_detail where id = f1),
      'report files: today''s documents read as editable');
    perform public.add_report_file(tobi || '/sixth.csv', 'sixth.csv');
    perform assert((select count(*) from public.report_files rf where rf.report_id = rep) = 5,
      'report files: once one is removed, another can be attached');

    -- The next day the report and its documents are locked.
    alter table public.reports disable trigger trg_report_enforce;
    update public.reports set report_date = report_date - 1 where id = rep;
    alter table public.reports enable trigger trg_report_enforce;
    begin
      perform public.remove_report_file(f1);
      perform assert(false, 'report files: no removing after the day');
    exception when others then
      perform assert(sqlerrm like '%only be removed on the day%', 'report files: documents cannot be removed after the day');
    end;
    insert into storage.objects (bucket_id, name, metadata)
    values ('report-files', tobi || '/late.pdf', '{"mimetype":"application/pdf","size":50}');
    begin
      perform public.add_report_file(tobi || '/late.pdf', 'late.pdf');
      perform assert(false, 'report files: no adding to yesterday''s report');
    exception when others then
      perform assert(sqlerrm like 'Save today''s report first%', 'report files: nothing is added to a past report');
    end;
    perform assert(not (select editable from public.report_file_detail where id = f1),
      'report files: a past day''s documents read as locked');

    -- Who may read the stored files.
    perform assert(public.report_file_readable(tobi || '/a.pdf'), 'report files: the owner reads their file');
    perform act_as(lead);
    perform assert(public.report_file_readable(tobi || '/a.pdf'), 'report files: their supervisor reads an attached file');
    perform assert(not public.report_file_readable(tobi || '/late.pdf'),
      'report files: but not a file that is not on a report');
    perform act_as(merch);
    perform assert(not public.report_file_readable(tobi || '/a.pdf'), 'report files: other staff cannot read it');
    perform act_as(boss);
    perform assert(public.report_file_readable(tobi || '/late.pdf'), 'report files: an admin reads any of them');
    perform assert(public.report_file_attached(tobi || '/a.pdf') and not public.report_file_attached(tobi || '/late.pdf'),
      'report files: the delete rule can tell attached files from loose ones');
  end;

  -- ---------------------------------------------------------------
  -- Count sheets from the profile, any time (0064).
  -- ---------------------------------------------------------------
  declare
    yemi  uuid := gen_random_uuid();
    shop  uuid;
    s1    uuid;
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values (yemi, 'yemi.sheet@xpel.ng');
    insert into public.outlets (name, lat, lng) values ('Yemi Store', 6.44, 3.41) returning id into shop;
    insert into public.profiles (id, full_name, email, role, outlet_id)
    values (yemi, 'Yemi Bello', 'yemi.sheet@xpel.ng', 'merchandiser', shop);
    perform act_as(yemi);
    insert into storage.objects (bucket_id, name, metadata) values
      ('reports', yemi || '/any-time.xlsx',
       '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","size":30000}');
    s1 := public.submit_count_sheet(shop, yemi || '/any-time.xlsx', 'XPEL sheet.xlsx');
    perform assert((select count_was_due = public.is_month_end_window() and request_id is null
                    from public.store_count_sheets where id = s1),
      'count sheets: a sheet sent from the profile with no count due is kept, against no request');
    perform assert(exists (select 1 from public.store_count_sheet_detail where id = s1 and outlet_name = 'Yemi Store'),
      'count sheets: and the office sees it with the store''s name');
  end;

  -- ---------------------------------------------------------------
  -- Report documents: retries, offline removal, clean-up (0065).
  -- ---------------------------------------------------------------
  declare
    ada    uuid := gen_random_uuid();
    ghost  uuid := gen_random_uuid();
    shop   uuid;
    rep    uuid;
    f1     uuid;
    f2     uuid;
    f3     uuid;
    k      integer;
    h      text;
    found_paths text[];
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values (ada, 'ada.rf2@xpel.ng'), (ghost, 'ghost.rf2@xpel.ng');
    insert into public.outlets (name, lat, lng) values ('RF2 Store', 6.46, 3.41) returning id into shop;
    insert into public.profiles (id, full_name, email, role, outlet_id) values
      (ada, 'Ada Obi', 'ada.rf2@xpel.ng', 'marketer', shop),
      (ghost, 'Gbenga Ola', 'ghost.rf2@xpel.ng', 'marketer', shop);

    perform act_as(ada);
    insert into storage.objects (bucket_id, name, metadata, created_at) values
      ('report-files', ada || '/report-c1.pdf', '{"mimetype":"application/pdf","size":1000}', now()),
      ('report-files', ada || '/report-c2.pdf', '{"mimetype":"application/pdf","size":1000}', now() - interval '3 hours'),
      ('report-files', ada || '/report-stale.pdf', '{"mimetype":"application/pdf","size":1000}', now() - interval '25 hours'),
      ('report-files', ada || '/report-loose.pdf', '{"mimetype":"application/pdf","size":1000}', now() - interval '3 hours');
    insert into public.reports (body, sales_summary, stock_status)
    values ('A busy day at the store', 'Sold thirty units', 'Low on the big tubs') returning id into rep;

    f1 := public.add_report_file(ada || '/report-c1.pdf', 'One.pdf');
    f2 := public.add_report_file(ada || '/report-c1.pdf', 'One again.pdf');
    perform assert(f1 = f2 and (select count(*) from public.report_files rf where rf.report_id = rep) = 1
                   and (select rf.name from public.report_files rf where rf.id = f1) = 'One.pdf',
      'report files 0065: sending the same document again returns the one already attached, once');
    f3 := public.add_report_file(ada || '/report-c2.pdf', 'Two.pdf');
    perform assert(f3 is not null,
      'report files 0065: a document uploaded hours ago (a report kept on the phone) can still be attached');
    begin
      perform public.add_report_file(ada || '/report-stale.pdf', 'Stale.pdf');
      perform assert(false, 'report files 0065: a document uploaded more than 24 hours ago is refused');
    exception when others then
      perform assert(sqlerrm like 'Upload the document again%',
        'report files 0065: a document uploaded more than 24 hours ago is refused');
    end;

    -- Five still means five, and a retry of one already on is not a sixth.
    for k in 1..3 loop
      insert into storage.objects (bucket_id, name, metadata)
      values ('report-files', ada || '/report-more-' || k || '.csv', '{"mimetype":"text/csv","size":50}');
      perform public.add_report_file(ada || '/report-more-' || k || '.csv', 'More ' || k || '.csv');
    end loop;
    perform assert(public.add_report_file(ada || '/report-c1.pdf', 'One.pdf') = f1,
      'report files 0065: a retry with five attached is answered, not refused by the limit');
    insert into storage.objects (bucket_id, name, metadata)
    values ('report-files', ada || '/report-sixth.csv', '{"mimetype":"text/csv","size":50}');
    begin
      perform public.add_report_file(ada || '/report-sixth.csv', 'Sixth.csv');
      perform assert(false, 'report files 0065: still five at most');
    exception when others then
      perform assert(sqlerrm like '%up to 5 documents%', 'report files 0065: still five at most');
    end;

    -- Another marketer's copy is still refused, retry or not.
    perform act_as(ghost);
    insert into public.reports (body, sales_summary, stock_status)
    values ('Quiet day at the store', 'Sold three units', 'Shelves are full');
    begin
      perform public.add_report_file(ada || '/report-c1.pdf', 'Not mine.pdf');
      perform assert(false, 'report files 0065: nobody attaches another person''s file');
    exception when others then
      perform assert(sqlerrm like '%already attached%' or sqlerrm like 'Upload the document again%',
        'report files 0065: nobody attaches another person''s file');
    end;

    -- Removing: the refusals say which kind they are.
    begin
      perform public.remove_report_file(f1);
      perform assert(false, 'report files 0065: nobody else removes it');
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      perform assert(h = 'report_file_gone', 'report files 0065: someone else''s document reads as not theirs');
    end;
    perform act_as(ada);
    perform assert(public.remove_report_file(f1) = ada || '/report-c1.pdf',
      'report files 0065: the owner removes a document on the day');
    begin
      perform public.remove_report_file(f1);
      perform assert(false, 'report files 0065: removing twice');
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      perform assert(h = 'report_file_gone' and sqlerrm like '%not on your report%',
        'report files 0065: a removal sent again after it got through reads as already gone');
    end;
    alter table public.reports disable trigger trg_report_enforce;
    update public.reports set report_date = report_date - 1 where id = rep;
    alter table public.reports enable trigger trg_report_enforce;
    begin
      perform public.remove_report_file(f3);
      perform assert(false, 'report files 0065: no removing after midnight');
    exception when others then
      get stacked diagnostics h = pg_exception_hint;
      perform assert(h = 'report_locked' and sqlerrm like '%only be removed on the day%',
        'report files 0065: a removal that arrives after midnight is refused as locked');
    end;
    perform assert(exists (select 1 from public.report_files rf where rf.id = f3),
      'report files 0065: and the document stays on the report');

    -- Clean-up: only files on no report, only older than 14 days (0067;
    -- 24 hours before it), and only once announced the day before.
    perform act_as(boss);
    insert into storage.objects (bucket_id, name, metadata, created_at) values
      -- uploaded for a report that never arrived
      ('report-files', ghost || '/report-never.pdf', '{"mimetype":"application/pdf","size":10}', now() - interval '30 hours'),
      -- another bucket is not this job's business
      ('reports', ada || '/report-old-photo.jpg', '{"mimetype":"image/jpeg","size":10}', now() - interval '30 days');
    perform announced_yesterday();
    perform assert(not exists (select 1 from public.report_file_orphans(24) o
                               where o.path in (ghost || '/report-never.pdf', ada || '/report-stale.pdf')),
      'retention 0067: a document on no report for a day or two is kept, whatever is asked');
    update storage.objects set created_at = now() - interval '15 days'
      where bucket_id = 'report-files' and name in (ghost || '/report-never.pdf', ada || '/report-stale.pdf');
    update storage.objects set created_at = now() - interval '20 days'
      where bucket_id = 'report-files' and name = ada || '/report-c2.pdf';
    select array_agg(o.path order by o.path) into found_paths
    from public.report_file_orphans() o
    where o.path like ada || '/%' or o.path like ghost || '/%';
    perform assert(found_paths = array[ada || '/report-stale.pdf', ghost || '/report-never.pdf']
                   or found_paths = array[ghost || '/report-never.pdf', ada || '/report-stale.pdf'],
      'report files 0065: the clean-up lists old files on no report (never saved, never attached) and nothing else');
    perform assert(not exists (select 1 from public.report_file_orphans(1) o where o.path = ada || '/report-loose.pdf'),
      'report files 0065: a file on no report but younger than 24 hours is never listed, however few hours are asked');
    perform assert(not exists (select 1 from public.report_file_orphans() o where o.path = ada || '/report-c2.pdf'),
      'report files 0065: an old file still on a report is never listed');
    perform assert((select count(*) from public.report_file_orphans(24, 1)) = 1,
      'report files 0065: the clean-up takes a batch size');
    perform assert(has_function_privilege('service_role', 'public.report_file_orphans(integer, integer)', 'execute')
                   and not has_function_privilege('authenticated', 'public.report_file_orphans(integer, integer)', 'execute')
                   and not has_function_privilege('anon', 'public.report_file_orphans(integer, integer)', 'execute'),
      'report files 0065: only the service role may list them');
    end;

  -- ---------------------------------------------------------------
  -- Report photos: retries, clean-up; 14 days, announced (0067).
  -- ---------------------------------------------------------------
  declare
    pho    uuid := gen_random_uuid();
    other  uuid := gen_random_uuid();
    sup1   uuid := gen_random_uuid();
    sup2   uuid := gen_random_uuid();
    shop   uuid;
    rep    uuid;
    p1     uuid;
    k      integer;
    legacy text;
    through timestamptz;
    found_paths text[];
    r      record;
    audits bigint;
  begin
    perform act_as(boss);
    insert into auth.users (id, email) values
      (pho, 'pho.rp@xpel.ng'), (other, 'other.rp@xpel.ng'), (sup1, 'sup1.rp@xpel.ng'), (sup2, 'sup2.rp@xpel.ng');
    insert into public.outlets (name, lat, lng) values ('RP Store', 6.47, 3.42) returning id into shop;
    insert into public.profiles (id, full_name, email, role) values
      (sup1, 'Sade Bello', 'sup1.rp@xpel.ng', 'supervisor'),
      (sup2, 'Musa Garba', 'sup2.rp@xpel.ng', 'supervisor');
    insert into public.profiles (id, full_name, email, role, outlet_id, supervisor_id) values
      (pho, 'Funke Ade', 'pho.rp@xpel.ng', 'marketer', shop, sup1),
      (other, 'Kunle Eze', 'other.rp@xpel.ng', 'marketer', shop, sup2);
    legacy := pho || '/' || gen_random_uuid() || '.jpg';

    perform act_as(pho);
    insert into storage.objects (bucket_id, name, metadata, created_at) values
      ('reports', pho || '/report-photo-c1.jpg', '{"mimetype":"image/jpeg","size":1000}', now()),
      ('reports', pho || '/report-photo-stale.jpg', '{"mimetype":"image/jpeg","size":1000}', now() - interval '25 hours'),
      ('reports', pho || '/report-photo-text.jpg', '{"mimetype":"text/plain","size":1000}', now()),
      ('reports', other || '/report-photo-theirs.jpg', '{"mimetype":"image/jpeg","size":1000}', now());
    begin
      perform public.add_report_photo(pho || '/report-photo-c1.jpg');
      perform assert(false, 'report photos 0067: a photo needs today''s report first');
    exception when others then
      perform assert(sqlerrm like 'Save today''s report first%', 'report photos 0067: a photo needs today''s report first');
    end;
    insert into public.reports (body, sales_summary, stock_status)
    values ('A long day at the store', 'Sold twenty units', 'Low on the small tubs') returning id into rep;

    p1 := public.add_report_photo(pho || '/report-photo-c1.jpg');
    perform assert(public.add_report_photo(pho || '/report-photo-c1.jpg') = p1
                   and (select count(*) from public.report_photos rp where rp.report_id = rep) = 1,
      'report photos 0067: sending the same photo again returns the row already there, once');
    begin
      perform public.add_report_photo(other || '/report-photo-theirs.jpg');
      perform assert(false, 'report photos 0067: nobody adds another person''s photo');
    exception when others then
      perform assert(sqlerrm like 'That photo is not yours%', 'report photos 0067: nobody adds another person''s photo');
    end;
    begin
      perform public.add_report_photo(pho || '/report-photo-stale.jpg');
      perform assert(false, 'report photos 0067: a photo uploaded more than 24 hours ago is refused');
    exception when others then
      perform assert(sqlerrm like 'Take the photo again%', 'report photos 0067: a photo uploaded more than 24 hours ago is refused');
    end;
    begin
      perform public.add_report_photo(pho || '/report-photo-missing.jpg');
      perform assert(false, 'report photos 0067: a photo that was never uploaded is refused');
    exception when others then
      perform assert(sqlerrm like 'Take the photo again%', 'report photos 0067: a photo that was never uploaded is refused');
    end;
    begin
      perform public.add_report_photo(pho || '/report-photo-text.jpg');
      perform assert(false, 'report photos 0067: only pictures');
    exception when others then
      perform assert(sqlerrm like 'That is not a photo%', 'report photos 0067: only pictures');
    end;

    -- Five still means five, and a retry of one already on is not a sixth.
    for k in 2..5 loop
      insert into storage.objects (bucket_id, name, metadata)
      values ('reports', pho || '/report-photo-c' || k || '.jpg', '{"mimetype":"image/jpeg","size":10}');
      perform public.add_report_photo(pho || '/report-photo-c' || k || '.jpg');
    end loop;
    perform assert(public.add_report_photo(pho || '/report-photo-c1.jpg') = p1
                   and (select count(*) from public.report_photos rp where rp.report_id = rep) = 5,
      'report photos 0067: a retry with five on is answered, not refused by the limit');
    insert into storage.objects (bucket_id, name, metadata)
    values ('reports', pho || '/report-photo-c6.jpg', '{"mimetype":"image/jpeg","size":10}');
    begin
      perform public.add_report_photo(pho || '/report-photo-c6.jpg');
      perform assert(false, 'report photos 0067: still five at most');
    exception when others then
      perform assert(sqlerrm like '%at most 5 photos%', 'report photos 0067: still five at most');
    end;

    -- A photo on someone's report is not put on another.
    perform act_as(other);
    insert into public.reports (body, sales_summary, stock_status)
    values ('Quiet day at the store', 'Sold two units', 'Shelves are full');
    perform public.add_report_photo(other || '/report-photo-theirs.jpg');
    begin
      perform public.add_report_photo(pho || '/report-photo-c1.jpg');
      perform assert(false, 'report photos 0067: a photo on a report is on one report only');
    exception when others then
      perform assert(sqlerrm like 'That photo is not yours%', 'report photos 0067: a photo on a report is on one report only');
    end;
    perform assert(not has_function_privilege('anon', 'public.add_report_photo(text)', 'execute')
                   and has_function_privilege('authenticated', 'public.add_report_photo(text)', 'execute'),
      'report photos 0067: signed-in people only');

    -- Clean-up: report photos on no report, older than 14 days, announced.
    perform act_as(boss);
    insert into storage.objects (bucket_id, name, metadata, created_at) values
      ('reports', pho || '/report-photo-orphan.jpg', '{"mimetype":"image/jpeg"}', now() - interval '20 days'),
      ('reports', legacy, '{"mimetype":"image/jpeg"}', now() - interval '20 days'),
      ('reports', pho || '/report-photo-young.jpg', '{"mimetype":"image/jpeg"}', now() - interval '2 days'),
      ('reports', pho || '/report-photo-13d.jpg', '{"mimetype":"image/jpeg"}', now() - interval '13 days'),
      ('reports', pho || '/count-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg"}', now() - interval '20 days'),
      ('reports', pho || '/place-sign-' || gen_random_uuid() || '.jpg', '{"mimetype":"image/jpeg"}', now() - interval '20 days'),
      ('selfies', pho || '/report-photo-elsewhere.jpg', '{"mimetype":"image/jpeg"}', now() - interval '20 days'),
      ('report-files', pho || '/report-photo-doc.jpg', '{"mimetype":"image/jpeg"}', now() - interval '20 days');
    update storage.objects set created_at = now() - interval '20 days'
      where bucket_id = 'reports' and name = pho || '/report-photo-c1.jpg';

    -- With no announcement a day old, nothing at all.
    delete from public.job_runs where job = 'retention_notice';
    perform assert(not exists (select 1 from public.report_photo_orphans() o where o.path like pho || '/%')
                   and not exists (select 1 from public.report_file_orphans())
                   and not exists (select 1 from public.expired_selfie_paths()),
      'retention 0067: nothing is deleted before it was announced');
    through := public.retention_announce();
    perform assert(abs(extract(epoch from (through - (now() - interval '13 days')))) < 1,
      'retention 0067: tonight''s notice covers what is older than 13 days');
    perform assert(public.retention_announce() = through,
      'retention 0067: a second run the same night announces nothing new');
    perform assert(not exists (select 1 from public.report_photo_orphans() o where o.path like pho || '/%'),
      'retention 0067: what was announced tonight does not go tonight');
    perform announced_yesterday();

    select array_agg(o.path order by o.path) into found_paths
    from public.report_photo_orphans() o where o.path like pho || '/%';
    perform assert(found_paths = (select array_agg(x order by x) from unnest(array[pho || '/report-photo-orphan.jpg', legacy]) x),
      'report photos 0067: the clean-up lists old report photos on no report, the old names too, and nothing else');
    perform assert(not exists (select 1 from public.report_photo_orphans(1) o
                               where o.path in (pho || '/report-photo-young.jpg', pho || '/report-photo-13d.jpg')),
      'retention 0067: never younger than 14 days, however few hours are asked');
    perform assert(not exists (select 1 from public.report_photo_orphans() o where o.path = pho || '/report-photo-c1.jpg'),
      'report photos 0067: a photo on a report is never listed');
    perform assert((select count(*) from public.report_photo_orphans(336, 1)) = 1,
      'report photos 0067: the clean-up takes a batch size');
    perform assert(has_function_privilege('service_role', 'public.report_photo_orphans(integer, integer)', 'execute')
                   and not has_function_privilege('authenticated', 'public.report_photo_orphans(integer, integer)', 'execute')
                   and not has_function_privilege('anon', 'public.report_photo_orphans(integer, integer)', 'execute'),
      'report photos 0067: only the service role may list them');

    -- The day before: who is told, and how much.
    alter table public.attendance disable trigger user;
    insert into public.attendance (user_id, type, lat, lng, accuracy_m, selfie_path, thumb_path, client_captured_at, created_at)
    values (pho, 'opening', 6.47, 3.42, 10, pho || '/rp-old.jpg', pho || '/rp-old_thumb.jpg', now() - interval '13 days 12 hours', now() - interval '13 days 12 hours'),
           (pho, 'opening', 6.47, 3.42, 10, pho || '/rp-new.jpg', pho || '/rp-new_thumb.jpg', now() - interval '3 days', now() - interval '3 days');
    alter table public.attendance enable trigger user;
    through := now() - interval '13 days';
    select * into r from public.retention_notice_due(through) d where d.user_id = sup1;
    -- One clock-in (13.5 days old; the 3-day one is not due), the two
    -- report photos on no report, the document on no report; not the five
    -- photos on her report.
    perform assert(r.selfies = 1 and r.report_photos = 2 and r.report_files = 1 and r.role = 'supervisor',
      'retention 0067: a supervisor is told what of their own team goes tomorrow, and nothing on a report');
    perform assert(not exists (select 1 from public.retention_notice_due(through) d where d.user_id = sup2),
      'retention 0067: a supervisor with nothing of theirs due is not told');
    perform assert(exists (select 1 from public.retention_notice_due(through) d
                           where d.user_id = boss and d.role = 'admin' and d.selfies >= 1 and d.report_photos >= 2),
      'retention 0067: every admin is told all of it');
    perform assert(not exists (select 1 from public.retention_notice_due(through) d where d.user_id in (pho, other)),
      'retention 0067: staff are never told');
    insert into public.notifications (title, body, url, audience, audience_detail, recipients)
    values ('Files go tomorrow', 'Test', '/admin', 'users',
            jsonb_build_object('kind', 'retention_notice', 'system', true, 'user_ids', jsonb_build_array(sup1)), 1);
    perform assert(not exists (select 1 from public.retention_notice_due(through) d where d.user_id = sup1),
      'retention 0067: one notice a person a day');
    perform assert(has_function_privilege('service_role', 'public.retention_notice_due(timestamptz)', 'execute')
                   and not has_function_privilege('authenticated', 'public.retention_notice_due(timestamptz)', 'execute')
                   and not has_function_privilege('authenticated', 'public.retention_announce()', 'execute')
                   and not has_function_privilege('authenticated', 'public.forget_selfie_paths(text[])', 'execute')
                   and not has_function_privilege('authenticated', 'public.record_retention_purge(jsonb)', 'execute'),
      'retention 0067: only the service role announces, lists and records');

    -- Forgetting exactly what was removed; reports themselves never go.
    perform assert(public.forget_selfie_paths(array[pho || '/rp-old.jpg', pho || '/rp-old_thumb.jpg']) = 1
                   and exists (select 1 from public.attendance where selfie_path = pho || '/rp-new.jpg'),
      'retention 0067: only the rows of the photos removed forget them');
    perform assert(exists (select 1 from public.reports where id = rep)
                   and (select count(*) from public.report_photos rp where rp.report_id = rep) = 5,
      'retention 0067: the report and its photos stay');

    -- What was deleted is kept, with one audit row when anything was.
    select count(*) into audits from public.audit_log where action = 'retention.purge';
    perform public.record_retention_purge('{"photos_deleted":0,"report_photos_deleted":0}');
    perform assert((select count(*) from public.audit_log where action = 'retention.purge') = audits,
      'retention 0067: a night with nothing deleted leaves no audit row');
    perform public.record_retention_purge('{"photos_deleted":4,"report_photos_deleted":2}');
    perform assert((select count(*) from public.audit_log where action = 'retention.purge') = audits + 1
                   and (select (last_result->>'photos_deleted')::int from public.job_runs where job = 'retention_purge') = 4,
      'retention 0067: a night with deletions is audited as retention.purge and kept for the footnote');
    perform assert(public.retention_days() = 14, 'retention 0067: the rule is 14 days');
  end;

  -- Test mode and resetting the test run (066). Every case runs in its
  -- own block that is rolled back, so the data stays for the RLS tests.
  -- ---------------------------------------------------------------
  declare
    keep_tables text[] := array['products', 'staff_roles', 'role_store_counts', 'count_sheet_templates',
                                'notification_templates', 'support_quick_replies', 'xm_settings',
                                'xm_settings_history', 'xm_policy_versions', 'app_releases', 'job_runs',
                                'system_settings', 'place_addresses', 'place_lookup_stats'];
    all_keys text[] := public.reset_category_keys();
    k text;
    cats text[];
    before jsonb;
    after jsonb;
    res jsonb;
    audits_before bigint;
    template_path text;
    boss_avatar text := boss || '/me.jpg';
    ada_avatar text := ada || '/me.jpg';
  begin
    perform set_config('request.jwt.claim.sub', '', false);
    -- Rows for the two tables the earlier tests leave empty.
    insert into public.assistant_conversations (user_id, title) values (boss, 'Test run questions');
    alter table public.xm_monthly_grades disable trigger trg_xm_monthly_grades_feature_guard;
    insert into public.xm_monthly_grades (month, user_id, grade, score, band)
    values (date_trunc('month', now())::date, ada, '{}', 70, 'Strong');
    alter table public.xm_monthly_grades enable trigger trg_xm_monthly_grades_feature_guard;
    insert into storage.objects (bucket_id, name) values ('avatars', boss_avatar), ('avatars', ada_avatar);
    select path into template_path from public.count_sheet_templates limit 1;

    perform assert((select test_mode from public.system_settings), 'reset: test mode starts on');
    perform assert((select count(*) from public.system_settings) = 1, 'reset: there is one system settings row');

    -- Every table with test data belongs to exactly one category.
    perform assert((select count(*) = count(distinct table_name) from public.reset_category_tables()),
      'reset: no table is in two categories');
    -- (Staff accounts clear the people themselves, from the tables admins keep rows in.)
    perform assert((select count(distinct category) from public.reset_category_tables()) + 1 = cardinality(all_keys)
                     and not exists (select 1 from public.reset_category_tables() where category = 'staff')
                     and not exists (select 1 from public.reset_category_tables() where not (category = any(all_keys))),
      'reset: every category clears something, and only known categories exist');
    perform assert(not exists (
        select 1 from information_schema.tables it
        where it.table_schema = 'public' and it.table_type = 'BASE TABLE'
          and it.table_name not in (select table_name from public.reset_category_tables())
          and not (it.table_name = any(public.reset_staff_tables()))
          and not (it.table_name = any(keep_tables))
          and it.table_name <> 'system_reset_files'),
      'reset: every table is either cleared, kept for admins, or kept');

    -- Choosing.
    perform assert(public.reset_resolve_categories(array['support']) = array['support'],
      'reset: a category on its own clears just that');
    perform assert(public.reset_resolve_categories(array['staff'])
                     = array['clock_ins', 'visits_places', 'reports', 'stock_counts', 'xm', 'staff'],
      'reset: staff accounts bring everything they recorded');
    perform assert(public.reset_resolve_categories(array['stores'])
                     = array['visits_places', 'stock_counts', 'xm', 'teams', 'stores'],
      'reset: stores bring their visits, counts, X Metrics records and allocations');
    perform assert(public.reset_resolve_categories(array['everything']) = all_keys,
      'reset: everything is every category');
    begin
      perform public.reset_resolve_categories(array['support', 'products']);
      perform assert(false, 'reset: unknown categories are refused');
    exception when others then
      perform assert(sqlerrm like 'Unknown thing to reset%', 'reset: an unknown category (products) is refused');
    end;
    begin
      perform public.reset_resolve_categories('{}');
      perform assert(false, 'reset: nothing chosen is refused');
    exception when others then
      perform assert(sqlerrm like 'Choose at least one%', 'reset: choosing nothing is refused');
    end;

    -- Who may.
    begin
      perform public.reset_test_data(ada, array['support']);
      perform assert(false, 'reset: staff cannot reset');
    exception when others then
      perform assert(sqlerrm like 'Only an admin%', 'reset: a merchandiser cannot reset');
    end;
    perform act_as(ada);
    begin
      perform public.reset_test_data(boss, array['support']);
      perform assert(false, 'reset: nobody resets in an admin''s name');
    exception when others then
      perform assert(sqlerrm like 'Only an admin%', 'reset: a signed-in person cannot reset in an admin''s name');
    end;
    perform set_config('request.jwt.claim.sub', '', false);

    -- Each category on its own clears its tables (and what it brings) and nothing else.
    foreach k in array all_keys loop
      begin
        before := reset_counts();
        audits_before := (select count(*) from public.audit_log);
        cats := public.reset_resolve_categories(array[k]);
        res := public.reset_test_data(boss, array[k]);
        after := reset_counts();
        perform assert(not exists (select 1 from public.reset_category_tables() c
                                   where c.category = any(cats) and c.table_name <> 'audit_log'
                                     and (after->>c.table_name)::bigint <> 0),
          format('reset %s: its tables are empty', k));
        perform assert(not exists (select 1 from public.reset_category_tables() c
                                   where c.category = any(cats) and c.table_name <> 'audit_log'
                                     and (before->>c.table_name)::bigint = 0),
          format('reset %s: (each of them had rows before)', k));
        if not ('staff' = any(cats)) then
          perform assert(not exists (select 1 from public.reset_category_tables() c
                                     where not (c.category = any(cats)) and c.table_name <> 'audit_log'
                                       and after->c.table_name <> before->c.table_name),
            format('reset %s: every other category is untouched', k));
          perform assert((select count(*) from public.profiles) = (before->>'profiles')::bigint,
            format('reset %s: nobody''s account goes', k));
        else
          perform assert(not exists (select 1 from public.profiles where role <> 'admin')
                           and (select count(*) from public.profiles where role = 'admin') > 0,
            format('reset %s: every account but the admins'' goes', k));
        end if;
        perform assert(not exists (select 1 from unnest(keep_tables) kt
                                   where kt <> 'system_settings' and after->kt <> before->kt),
          format('reset %s: products and set-up are kept', k));
        if k = 'audit' then
          perform assert((select count(*) from public.audit_log) = 1, 'reset audit: the log holds just the reset');
        else
          perform assert((select count(*) from public.audit_log) = audits_before + 1,
            format('reset %s: one audit row is added', k));
        end if;
        perform assert((select meta->'categories' from public.audit_log where action = 'system.reset') = to_jsonb(cats)
                         and (select actor_id from public.audit_log where action = 'system.reset') = boss,
          format('reset %s: the audit row says who and what', k));
        perform assert(res->'categories' = to_jsonb(cats) and (res->'by_category') ? cats[1],
          format('reset %s: the result counts each category', k));
        raise exception 'reset-case-done';
      exception when others then
        if sqlerrm <> 'reset-case-done' then raise; end if;
      end;
    end loop;

    -- Files go only for what was chosen.
    begin
      perform public.reset_test_data(boss, array['support']);
      perform assert((select count(*) from public.system_reset_files) = 0,
        'reset files: support chats queue no files');
      raise exception 'reset-case-done';
    exception when others then
      if sqlerrm <> 'reset-case-done' then raise; end if;
    end;
    begin
      perform public.reset_test_data(boss, array['clock_ins']);
      perform assert((select count(*) from public.system_reset_files) > 0
                       and not exists (select 1 from public.system_reset_files where bucket <> 'selfies'),
        'reset files: clock-ins queue only clock-in selfies');
      raise exception 'reset-case-done';
    exception when others then
      if sqlerrm <> 'reset-case-done' then raise; end if;
    end;
    begin
      perform public.reset_test_data(boss, array['reports']);
      perform assert(exists (select 1 from public.system_reset_files where bucket = 'report-files')
                       and not exists (select 1 from public.system_reset_files where bucket in ('selfies', 'avatars')),
        'reset files: daily reports queue their photos and documents, not selfies or profile photos');
      raise exception 'reset-case-done';
    exception when others then
      if sqlerrm <> 'reset-case-done' then raise; end if;
    end;

    -- Starting completely fresh.
    begin
      before := reset_counts();
      res := public.reset_test_data(boss, array['everything']);
      after := reset_counts();
      perform assert(not exists (select 1 from public.reset_category_tables() c
                                 where c.table_name <> 'audit_log' and (after->>c.table_name)::bigint <> 0),
        'reset everything: every test data table is empty');
      perform assert(not exists (select 1 from public.profiles where role <> 'admin')
                       and exists (select 1 from public.profiles where id = boss),
        'reset everything: only admins'' accounts are left');
      perform assert(not exists (select 1 from auth.users u
                                 where not exists (select 1 from public.profiles p where p.id = u.id)),
        'reset everything: and only their sign-ins');
      perform assert(not exists (select 1 from public.push_subscriptions s join public.profiles p on p.id = s.user_id
                                 where p.role <> 'admin')
                       and not exists (select 1 from public.app_installs s left join public.profiles p on p.id = s.user_id
                                       where p.id is null),
        'reset everything: only admins'' phones stay registered');
      perform assert(not exists (select 1 from unnest(keep_tables) kt
                                 where kt <> 'system_settings' and after->kt <> before->kt),
        'reset everything: products and set-up are kept');
      perform assert((select count(*) from public.audit_log) = 1
                       and (select action from public.audit_log) = 'system.reset'
                       and (select (meta->>'everything')::boolean from public.audit_log)
                       and (select (meta->>'accounts')::int from public.audit_log) > 0,
        'reset everything: the audit log holds one reset row with what went');
      perform assert(exists (select 1 from public.system_reset_files where bucket = 'selfies')
                       and exists (select 1 from public.system_reset_files where bucket = 'avatars' and name = ada_avatar)
                       and not exists (select 1 from public.system_reset_files where name = boss_avatar)
                       and not exists (select 1 from public.system_reset_files where name = template_path),
        'reset everything: stored files are queued, except admins'' photos and the count sheet template');
      perform assert((select last_reset_by = boss and last_reset_at is not null and test_mode
                      from public.system_settings),
        'reset everything: the last reset is noted and test mode stays on');
      raise exception 'reset-case-done';
    exception when others then
      if sqlerrm <> 'reset-case-done' then raise; end if;
    end;

    -- Going live is for good.
    begin
      begin
        perform public.system_go_live(ada);
        perform assert(false, 'go live: staff cannot');
      exception when others then
        perform assert(sqlerrm like 'Only an admin%', 'go live: only an admin turns test mode off');
      end;
      res := public.system_go_live(boss);
      perform assert(not (select test_mode from public.system_settings)
                       and (select went_live_by from public.system_settings) = boss,
        'go live: test mode is off, with who and when');
      perform assert(exists (select 1 from public.audit_log where action = 'system.go_live' and actor_id = boss),
        'go live: it is audited');
      begin
        perform public.reset_test_data(boss, array['support']);
        perform assert(false, 'go live: no reset after');
      exception when others then
        perform assert(sqlerrm like 'Xtend is live%', 'go live: nothing can be reset once live');
      end;
      begin
        update public.system_settings set test_mode = true;
        perform assert(false, 'go live: no turning back');
      exception when others then
        perform assert(sqlerrm like 'Test mode cannot be turned back on%',
          'go live: test mode cannot be turned back on, even by a direct update');
      end;
      begin
        delete from public.system_settings;
        perform assert(false, 'go live: the row stays');
      exception when others then
        perform assert(sqlerrm like '%cannot be deleted%', 'go live: the settings row cannot be deleted to start over');
      end;
      begin
        truncate public.system_settings;
        perform assert(false, 'go live: no truncate');
      exception when others then
        perform assert(sqlerrm like '%cannot be deleted%', 'go live: nor truncated');
      end;
      begin
        insert into public.system_settings (id, test_mode) values (true, true);
        perform assert(false, 'go live: no second row');
      exception when unique_violation then
        perform assert(true, 'go live: no second settings row');
      end;
      begin
        perform public.system_go_live(boss);
        perform assert(false, 'go live: only once');
      exception when others then
        perform assert(sqlerrm like 'Xtend is already live%', 'go live: going live twice is refused');
      end;
      raise exception 'reset-case-done';
    exception when others then
      if sqlerrm <> 'reset-case-done' then raise; end if;
    end;
    perform assert((select test_mode from public.system_settings), 'reset: (the tests above rolled back)');
  end;

  -- ---------------------------------------------------------------
  -- Google only for places Xtend has never seen (0068).
  -- ---------------------------------------------------------------
  declare
    pid uuid;
    own uuid;
    aid uuid;
    places_before bigint;
  begin
    perform set_config('request.jwt.claim.sub', '', false);
    -- The server learns a map's name for the background tracker, with nobody signed in.
    pid := public.learn_place_for(grace, 7.2000, 3.9000, '  Bukka   Hut Ring Road ', '12 Ring Rd, Ibadan', 'google');
    perform assert(pid is not null
                   and (select name from public.known_places where id = pid) = 'Bukka Hut Ring Road'
                   and (select visitors from public.known_places where id = pid) = array[grace]
                   and (select named_by from public.known_places where id = pid) is null
                   and (select source from public.known_places where id = pid) = 'google',
      'places 0068: the server learns a map''s name for someone with nobody signed in');
    select count(*) into places_before from public.known_places;
    perform assert(public.learn_place_for(bala, 7.20005, 3.90005, 'Another Name', null, 'osm') = pid,
      'places 0068: the same spot is the same place');
    perform assert((select times_seen from public.known_places where id = pid) = 2
                   and (select visitors from public.known_places where id = pid) = array[grace, bala]
                   and (select count(*) from public.known_places) = places_before,
      'places 0068: the same spot is counted as seen again, with who was there');
    perform assert(public.learn_place_for(grace, 6.6018, 3.3515, 'Not a new place', null, 'google') is null,
      'places 0068: nothing is learned inside a store');
    begin
      perform public.learn_place_for(grace, 7.25, 3.95, 'My Shop', null, 'staff');
      perform assert(false, 'places 0068: no staff names through the server');
    exception when others then
      perform assert(sqlerrm like 'Only places named by a map%',
        'places 0068: a person''s own name still needs their photos (name_place), not the server');
    end;
    begin
      perform public.learn_place_for(gen_random_uuid(), 7.25, 3.95, 'Some Shop', null, 'google');
      perform assert(false, 'places 0068: unknown person');
    exception when others then
      perform assert(sqlerrm like 'Unknown person%', 'places 0068: only for a real person');
    end;
    begin
      perform public.learn_place_for(grace, 7.25, 3.95, 'x', null, 'google');
      perform assert(false, 'places 0068: short name');
    exception when others then
      perform assert(sqlerrm like 'A place name needs%', 'places 0068: the same name rules as learn_place');
    end;

    -- Counting a visit for the server keeps the "only its namer goes there" check.
    insert into public.known_places (name, lat, lng, source, named_by, visitors)
    values ('Grace Corner Shop', 7.4000, 3.9000, 'staff', grace, array[grace]) returning id into own;
    perform public.note_place_visit_for(grace, own);
    perform public.note_place_visit_for(grace, own);
    perform assert((select times_seen from public.known_places where id = own) = 3
                   and exists (select 1 from public.integrity_flags f
                               where f.kind = 'own_named_place' and f.user_id = grace
                                 and f.detail->>'place_id' = own::text),
      'places 0068: a visit counted by the server still flags a place only its namer visits');
    perform act_as(bala);
    perform public.note_place_visit(own);
    perform assert((select times_seen from public.known_places where id = own) = 4
                   and (select visitors from public.known_places where id = own) = array[grace, bala],
      'places 0068: note_place_visit still counts the signed-in caller');
    perform set_config('request.jwt.claim.sub', '', false);
    perform public.note_place_visit(own);
    perform assert((select times_seen from public.known_places where id = own) = 4,
      'places 0068: and nobody signed in counts nothing');

    -- Addresses without a shop name.
    aid := public.remember_address(7.3000, 3.9500, '  5 Adeola   Street, Ibadan ');
    perform assert(aid is not null and (select address from public.place_addresses where id = aid) = '5 Adeola Street, Ibadan',
      'places 0068: an address Google gave without a shop is kept');
    perform assert(public.address_at(7.30020, 3.95020) = '5 Adeola Street, Ibadan',
      'places 0068: 30 m away the saved address answers');
    perform assert((select times_seen from public.place_addresses where id = aid) = 2,
      'places 0068: and is counted as used');
    perform assert(public.address_at(7.3010, 3.9500) is null, 'places 0068: 110 m away it does not');
    perform assert(public.remember_address(7.30010, 3.95010, '5 Adeola St') = aid,
      'places 0068: the same spot is not saved twice');
    perform assert(public.remember_address(6.6018, 3.3515, 'Inside the mall') is null
                   and public.remember_address(7.2000, 3.9000, '12 Ring Rd, Ibadan') is null,
      'places 0068: nothing is saved inside a store or a learned place');
    perform assert((select count(*) from public.place_addresses) = 1,
      'places 0068: one saved address after all that');
    begin
      perform public.remember_address(7.5, 3.9, ' ');
      perform assert(false, 'places 0068: empty address');
    exception when others then
      perform assert(sqlerrm like 'An address needs%', 'places 0068: an empty address is refused');
    end;

    -- The counter.
    perform public.count_place_lookups(array['store', 'google', 'call_nearby', 'call_geocode', 'call_nearby', 'bogus']);
    perform public.count_place_lookups(array['call_text_search', 'osm']);
    perform public.count_place_lookups(null);
    perform assert((select lookups from public.place_lookup_stats
                    where month = date_trunc('month', public.business_date())::date and source = 'call_nearby') = 2
                   and (select lookups from public.place_lookup_stats where source = 'store') = 1
                   and not exists (select 1 from public.place_lookup_stats where source = 'bogus'),
      'places 0068: each lookup is counted by what answered it, per Lagos month; unknown names are ignored');
    perform assert(public.google_calls_this_month() = 4,
      'places 0068: Google requests this month are the call_ rows only');
    insert into public.place_lookup_stats (month, source, lookups)
    values ((date_trunc('month', public.business_date()) - interval '1 month')::date, 'call_nearby', 50);
    perform assert(public.google_calls_this_month() = 4, 'places 0068: last month is not this month');

    -- Service role only.
    perform assert(
      not has_function_privilege('authenticated', 'public.learn_place_for(uuid, double precision, double precision, text, text, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.note_place_visit_for(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.address_at(double precision, double precision)', 'execute')
      and not has_function_privilege('authenticated', 'public.remember_address(double precision, double precision, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.count_place_lookups(text[])', 'execute')
      and not has_function_privilege('authenticated', 'public.google_calls_this_month()', 'execute')
      and not has_function_privilege('anon', 'public.learn_place_for(uuid, double precision, double precision, text, text, text)', 'execute')
      and has_function_privilege('service_role', 'public.learn_place_for(uuid, double precision, double precision, text, text, text)', 'execute')
      and has_function_privilege('service_role', 'public.count_place_lookups(text[])', 'execute')
      and has_function_privilege('authenticated', 'public.note_place_visit(uuid)', 'execute'),
      'places 0068: learning for someone, saved addresses and the counter are for the server alone');
    raise exception 'places-0068-done';
  exception when others then
    if sqlerrm <> 'places-0068-done' then raise; end if;
  end;
  perform assert(not exists (select 1 from public.place_addresses), 'places 0068: (the tests above rolled back)');

  raise notice 'ALL RULES PASSED';
end $$;
