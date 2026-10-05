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
  -- Retention: both images go 24 hours after the photo was taken.
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
  perform assert((select count(*) from public.products) = 2,
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
    (select count(*) from public.counted_product_names()) = 2,
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
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (femi, 'https://example.com/made-up', 'k', 'a');
    perform assert(not public.has_live_push(femi), 'a made-up notification address does not count');
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
    -- The Android and iOS apps register their own push token (030).
    insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'app@xpel.ng');
    insert into public.profiles (id, full_name, email, role, outlet_id)
    values ('00000000-0000-4000-8000-0000000000a1', 'App User', 'app@xpel.ng', 'merchandiser', mall_id);
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values ('00000000-0000-4000-8000-0000000000a1', 'native-fcm:short', 'native', 'native');
    perform assert(not public.has_live_push('00000000-0000-4000-8000-0000000000a1'),
      'a made-up app token does not count');
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
    perform act_as(ada);
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
      exists (select 1 from jsonb_array_elements(public.movement_trail(femi, public.business_date())->'points') e
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

  raise notice 'ALL RULES PASSED';
end $$;
