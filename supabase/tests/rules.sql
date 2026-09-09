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
  payload    jsonb;
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
  -- Retention keeps the thumbnail and drops the full image.
  -- ---------------------------------------------------------------
  perform act_as(bala);
  insert into storage.objects (bucket_id, name) values ('selfies', 'old/full.jpg');
  insert into public.attendance (type, lat, lng, accuracy_m, selfie_path, thumb_path, client_captured_at)
  values ('closing', 9.0765, 7.3986, 10, 'old/full.jpg', 'old/thumb.jpg', now());
  update public.attendance set created_at = now() - interval '100 days'
   where selfie_path = 'old/full.jpg';

  perform assert(public.purge_old_selfies() = 1, 'the purge deletes one expired full image');
  perform assert(
    (select count(*) from storage.objects where name = 'old/full.jpg') = 0,
    'the full-size object is gone');
  perform assert(
    (select selfie_path from public.attendance where thumb_path = 'old/thumb.jpg') = 'old/thumb.jpg',
    'the thumbnail becomes the permanent record');

  raise notice 'ALL RULES PASSED';
end $$;
