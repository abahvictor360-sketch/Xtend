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

  -- ---------------------------------------------------------------
  -- The trigger owns distance and status.
  -- ---------------------------------------------------------------
  perform act_as(ada);

  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at,
                                 -- deliberately lying: the trigger must overwrite all of these
                                 user_id, distance_m, status, attendance_date)
  values ('opening', 6.6019, 3.3516, 12, 'x/1.jpg', now(),
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
    values ('opening', 6.6019, 3.3516, 12, 'x/2.jpg', now());
    perform assert(false, 'a second opening must be rejected');
  exception when unique_violation then
    perform assert(true, 'a second opening the same day is rejected');
  end;

  -- ---------------------------------------------------------------
  -- Off site clocking is recorded honestly and raises an alert.
  -- ---------------------------------------------------------------
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('closing', 6.6100, 3.3600, 15, 'x/3.jpg', now())
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
  values ('opening', 9.0765, 7.3986, 400, 'y/1.jpg', now())
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
    values ('opening', 6.6, 3.35, 10, 'z/1.jpg', now() - interval '30 hours');
    perform assert(false, 'a stale capture must be rejected');
  exception when others then
    perform assert(sqlerrm like '%Invalid capture timestamp%', 'a capture older than 24h is rejected');
  end;

  begin
    insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
    values ('opening', 6.6, 3.35, 10, 'z/2.jpg', now() + interval '10 minutes');
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
  insert into public.reports (body, user_id, report_date)
  values ('Busy morning', bala, date '2001-01-01')
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
    perform assert(sqlerrm like '%Admins only%', 'a merchandiser cannot write an audit row');
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
  values (mall_id, 6.6019, 3.3516, 12, now(), 'grace/v1.jpg', 'Ikeja City Mall')
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
  values (kiosk_id, 9.0900, 7.4100, 15, now(), 'grace/v2.jpg')
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
  -- Retention: both images go 24 hours after the photo was taken.
  --
  -- The objects themselves are removed by the server through the Storage
  -- API, because Supabase refuses a direct DELETE. What is tested here is
  -- the database's half: which paths have expired, forgetting them, and
  -- the throttle that lets ordinary traffic drive the sweep.
  -- ---------------------------------------------------------------
  perform act_as(bala);
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, thumb_path, client_captured_at)
  values ('closing', 9.0765, 7.3986, 10, 'old/full.jpg', 'old/thumb.jpg', now())
  returning id into attendance_id;
  update public.attendance set created_at = now() - interval '25 hours'
   where id = attendance_id;

  perform act_as(grace);
  -- Close whatever round she is still on, so a new visit can open.
  perform public.end_store_visit(v.id, 9.0765, 7.3986, 12, null, null)
  from public.store_visits v where v.user_id = grace and v.status = 'open';

  insert into public.store_visits
    (outlet_id, arrived_lat, arrived_lng, arrived_accuracy_m, client_captured_at,
     selfie_path, thumb_path)
  values (kiosk_id, 9.0765, 7.3986, 12, now(), 'fresh/full.jpg', 'fresh/thumb.jpg')
  returning id into visit_id;

  perform assert(
    (select count(*) from public.expired_selfie_paths(24)) = 2,
    'both images of an expired clock event are listed for deletion');
  perform assert(
    exists (select 1 from public.expired_selfie_paths(24) where path = 'old/thumb.jpg'),
    'the thumbnail expires with the full frame, not after it');
  perform assert(
    not exists (select 1 from public.expired_selfie_paths(24) where path like 'fresh/%'),
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
  update public.store_visits set created_at = now() - interval '30 hours' where id = visit_id;
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
  values ('opening', 9.0766, 7.3987, 10, 'g/1.jpg', now())
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
  values (9.0766, 7.3987, 10, now(), 'auto/1.jpg')
  returning id into visit_id;
  perform assert(
    (select outlet_id from public.store_visits where id = visit_id) = kiosk_id,
    'standing in a known store attributes the visit to it, with no allocation');
  perform assert(
    (select arrived_status from public.store_visits where id = visit_id) = 'on_site',
    'and reads on_site');
  perform public.end_store_visit(visit_id, 9.0766, 7.3987, 10, null, null);

  -- A shop Xtend has never heard of is a perfectly good visit.
  select count(*) into alert_count from public.location_alerts where user_id = grace;
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
  values ('opening', 9.0766, 7.3987, 10, 'g/clock.jpg', now())
  returning id into attendance_id;
  perform assert(
    (select outlet_id from public.attendance where id = attendance_id) = kiosk_id,
    'clocking in inside a known store attributes it, with no store of their own');
  perform assert(
    (select status from public.attendance where id = attendance_id) = 'on_site',
    'and reads on_site');

  delete from public.attendance where id = attendance_id;
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, client_captured_at)
  values ('opening', 6.4500, 3.4000, 10, 'g/clock2.jpg', now())
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

  raise notice 'ALL RULES PASSED';
end $$;
