-- =====================================================================
-- Row level security for store counts and count requests (019, 020),
-- exercised as the `authenticated` role rather than as a superuser.
-- Run after rules.sql, whose people and data it reuses.
-- =====================================================================
set client_min_messages = notice;

-- What Supabase grants the API roles by default.
grant usage on schema public, auth to authenticated;
grant select on all tables in schema public to authenticated;
grant execute on function auth.uid() to authenticated;
grant execute on function assert(boolean, text) to authenticated;
-- Supabase also grants writes on public tables and relies on RLS; do the
-- same here for learned places, so the test proves the policy stops staff.
grant update, delete on public.known_places to authenticated;
-- On Supabase those defaults are granted when a table is made, and a
-- migration's own revokes come after. Replay 026's in that order.
revoke select on public.phone_checks from authenticated;
grant select (id, user_id, requested_by, devices, created_at, delivered_at, opened_at)
  on public.phone_checks to authenticated;

select id as ada   from auth.users where email = 'ada@xpel.ng'   \gset
select id as bala  from auth.users where email = 'bala@xpel.ng'  \gset
select id as boss  from auth.users where email = 'boss@xpel.ng'  \gset
select id as grace from auth.users where email = 'grace@xpel.ng' \gset
select id as tunde from auth.users where email = 'tunde@xpel.ng' \gset
select id as funke from auth.users where email = 'funke.support@xpel.ng' \gset

set role authenticated;

select set_config('request.jwt.claim.sub', :'ada', false);
select assert((select count(*) from public.count_requests) >= 1
                and (select count(*) from public.count_requests)
                    = (select count(*) from public.count_request_targets),
  'rls: a merchandiser sees the requests made to them, and no other');
select assert(not exists (select 1 from public.count_request_targets where user_id <> :'ada'),
  'rls: and only their own line of each');
select assert((select count(*) from public.store_counts) > 0,
  'rls: they see their own counts');

select assert((select count(*) from public.integrity_flags) = 0,
  'rls: nobody sees the flags raised about them');
select assert((select count(*) from public.device_beacons) = 0
                and (select count(*) from public.phone_checks) = 0,
  'rls: staff see nothing their phone reports, and no phone checks');

update public.known_places set name = 'Renamed by staff' where name = 'Mama Nkechi Provisions';
delete from public.known_places where name = 'Mama Nkechi Provisions';
select assert((select count(*) from public.known_places) = 0
                and (select count(*) from public.known_place_detail) = 0,
  'rls: staff cannot read the list of learned places, and who was where');
select assert((select name from public.known_place_at(6.5001, 3.3001)) = 'Mama Nkechi Provisions',
  'rls: but are told the name of the place they are standing in');

select set_config('request.jwt.claim.sub', :'bala', false);
select assert((select count(*) from public.count_requests) = 0,
  'rls: somebody not asked sees no requests');
select assert((select count(*) from public.store_counts) = 0,
  'rls: nor anybody else''s counts');

select set_config('request.jwt.claim.sub', :'tunde', false);
select assert((select count(*) from public.count_requests) = 1,
  'rls: a supervisor sees the request they made, not one made to another team');
select assert((select count(*) from public.store_counts where user_id = :'ada') = 0,
  'rls: a supervisor does not see counts from outside their team');
select assert((select count(*) from public.count_request_progress) = 1,
  'rls: the progress view follows the same rules');

select set_config('request.jwt.claim.sub', :'boss', false);
select assert((select count(*) from public.count_requests) >= 2,
  'rls: an admin sees every request');
select assert((select count(*) from public.integrity_flag_detail) > 0,
  'rls: an admin sees the integrity flags');
select assert((select count(*) from public.store_counts) = (select count(*) from public.store_count_detail),
  'rls: and every count');
select assert((select count(*) from public.known_places where name = 'Mama Nkechi Provisions') = 1,
  'rls: staff could not rename or delete a learned place');
select assert((select count(*) from public.known_place_detail) = (select count(*) from public.known_places),
  'rls: an admin sees every learned place');
select assert((select count(*) from public.device_beacons) > 0
                and (select count(*) from public.phone_checks) > 0,
  'rls: an admin sees phone reports and checks');
do $$
begin
  perform token from public.phone_checks limit 1;
  perform assert(false, 'rls: nobody reads the token that proves a phone answered');
exception when insufficient_privilege then
  perform assert(true, 'rls: nobody reads the token that proves a phone answered');
end $$;

do $$
begin
  insert into public.count_requests (requested_by, due_date) values (auth.uid(), current_date);
  perform assert(false, 'rls: requests cannot be written directly');
exception when insufficient_privilege then
  perform assert(true, 'rls: requests cannot be written directly');
end $$;

-- Support inbox, quick replies, templates, schedules and who got a
-- notification (0053).
select set_config('request.jwt.claim.sub', :'ada', false);
select assert(not exists (select 1 from public.support_inbox where user_id <> :'ada'),
  'rls: a merchandiser sees only their own support threads in the inbox');
select assert((select count(*) from public.support_quick_replies) = 0
                and (select count(*) from public.notification_templates) = 0
                and (select count(*) from public.scheduled_notifications) = 0,
  'rls: staff see no quick replies, templates or schedules');
select assert(not exists (select 1 from public.notification_deliveries where user_id <> :'ada'),
  'rls: staff see only their own deliveries');
do $$
begin
  insert into public.support_quick_replies (title, body) values ('Mine', 'Written by staff');
  perform assert(false, 'rls: staff cannot add a quick reply');
exception when insufficient_privilege then
  perform assert(true, 'rls: staff cannot add a quick reply');
end $$;

select set_config('request.jwt.claim.sub', :'tunde', false);
select assert(exists (select 1 from public.support_inbox where user_id = :'funke')
                and not exists (select 1 from public.support_inbox where user_id = :'ada'),
  'rls: a supervisor''s inbox holds their team''s threads, not others''');
select assert((select assigned_name from public.support_inbox where user_id = :'funke' limit 1) = 'Tunde Bello',
  'rls: and names who has the thread');
select assert((select count(*) from public.notification_deliveries d
               join public.notifications n on n.id = d.notification_id
               where n.sender_id = :'tunde') >= 1,
  'rls: a supervisor sees who got the notifications they sent');
select assert(not exists (select 1 from public.notification_deliveries d
                          where d.user_id <> :'tunde' and not public.notification_sent_by_me(d.notification_id)),
  'rls: but not who got anybody else''s');
select assert((select count(*) from public.support_quick_replies) >= 5
                and (select count(*) from public.notification_templates) >= 4,
  'rls: a supervisor uses the quick replies and templates');
select assert(not exists (select 1 from public.scheduled_notifications where created_by <> :'tunde')
                and exists (select 1 from public.scheduled_notifications),
  'rls: a supervisor sees only their own schedules');
delete from public.support_quick_replies where created_by is null;
select assert((select count(*) from public.support_quick_replies where created_by is null) >= 5,
  'rls: a supervisor cannot delete the shared quick replies');
insert into public.notification_templates (title, body) values ('Depot meeting', 'Meet at the depot at 4pm.');
select assert(exists (select 1 from public.notification_templates where title = 'Depot meeting' and created_by = :'tunde'),
  'rls: a supervisor saves their own template');
delete from public.notification_templates where title = 'Depot meeting';
select assert(not exists (select 1 from public.notification_templates where title = 'Depot meeting'),
  'rls: and can delete it');
do $$
begin
  insert into public.scheduled_notifications (created_by, title, body, audience, user_ids, send_at)
  values (auth.uid(), 'Sneaky', 'To everyone at all', 'everyone', array[auth.uid()], now() + interval '1 hour');
  perform assert(false, 'rls: schedules cannot be written directly');
exception when insufficient_privilege then
  perform assert(true, 'rls: schedules cannot be written directly');
end $$;

select set_config('request.jwt.claim.sub', :'boss', false);
select assert((select count(*) from public.support_inbox) = (select count(*) from public.support_threads),
  'rls: an admin sees every support thread');
select assert((select count(*) from public.notification_log) = (select count(*) from public.notifications),
  'rls: and the whole notification history');

-- Updates (057): only admins publish; staff see live notes and their own installs.
select set_config('request.jwt.claim.sub', :'ada', false);
do $$
begin
  insert into public.app_releases (title) values ('Not allowed');
  perform assert(false, 'rls: only admins publish updates');
exception when insufficient_privilege then
  perform assert(true, 'rls: only admins publish updates');
end $$;
select assert(not exists (select 1 from public.app_releases where withdrawn_at is not null),
  'rls: staff do not see withdrawn updates');
select assert(not exists (select 1 from public.app_installs where user_id <> :'ada'),
  'rls: staff see only their own app versions');
select set_config('request.jwt.claim.sub', :'tunde', false);
select assert(not exists (select 1 from public.app_installs i where i.user_id <> :'tunde' and not public.supervises_user(i.user_id)),
  'rls: a supervisor sees their own team''s app versions only');
select set_config('request.jwt.claim.sub', :'boss', false);
insert into public.app_releases (title, notes) values ('Published by an admin', 'Notes');
select assert(exists (select 1 from public.app_releases where title = 'Published by an admin' and created_by = :'boss'),
  'rls: an admin publishes an update');

-- Realtime (058): a member hears only their own topic.
select set_config('request.jwt.claim.sub', :'ada', false);
select set_config('realtime.topic', 'field:' || :'ada', false);
select assert((select count(*) from realtime.messages) > 0,
  'rls: a member receives the announcements on their own topic');
select set_config('realtime.topic', 'field:' || :'bala', false);
select assert((select count(*) from realtime.messages) = 0,
  'rls: and nothing on anyone else''s');
select set_config('realtime.topic', '', false);

-- Clock-out reminders (061): own, team or everyone; never written directly.
select set_config('request.jwt.claim.sub', :'ada', false);
select assert(not exists (select 1 from public.clock_out_reminders where user_id <> :'ada'),
  'rls: staff see only their own clock-out reminders');
do $$
begin
  insert into public.clock_out_reminders (user_id, reminder_date, stage, shift_end)
  values (auth.uid(), current_date + 1, 1, '18:00');
  perform assert(false, 'rls: clock-out reminders cannot be written directly');
exception when insufficient_privilege then
  perform assert(true, 'rls: clock-out reminders cannot be written directly');
end $$;
do $$
begin
  perform * from public.claim_clock_out_reminders();
  perform assert(false, 'rls: only the scheduled job claims clock-out reminders');
exception when insufficient_privilege then
  perform assert(true, 'rls: only the scheduled job claims clock-out reminders');
end $$;
select set_config('request.jwt.claim.sub', :'tunde', false);
select assert(not exists (select 1 from public.clock_out_reminders r
                          where r.user_id <> :'tunde' and not public.supervises_user(r.user_id)),
  'rls: a supervisor sees only their own team''s clock-out reminders');
select set_config('request.jwt.claim.sub', :'boss', false);
select assert((select count(*) from public.clock_out_reminders r
               join public.profiles p on p.id = r.user_id where p.email like 'cy_@xpel.ng') >= 5,
  'rls: an admin sees every clock-out reminder');
-- Schedules and leave (059): staff read their own, a supervisor their team,
-- an admin everyone; nobody writes the tables directly.
reset role;
select id as kemi from auth.users where email = 'kemi.rota@xpel.ng' \gset
select id as obi  from auth.users where email = 'obi.rota@xpel.ng'  \gset
select id as sola from auth.users where email = 'sola.rota@xpel.ng' \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'kemi', false);
select assert((select count(*) from public.leave_requests) > 0
                and not exists (select 1 from public.leave_requests where user_id <> :'kemi'),
  'rls: staff see their own leave requests and nobody else''s');
select assert((select count(*) from public.work_patterns) = 1
                and not exists (select 1 from public.schedule_overrides where user_id <> :'kemi'),
  'rls: staff see only their own schedule');
select assert((select count(*) from public.my_calendar(current_date - 3, current_date)) = 4,
  'rls: staff read their own calendar');
do $$
begin
  insert into public.leave_requests (user_id, kind, from_date, to_date, reason)
  values (auth.uid(), 'annual', current_date + 100, current_date + 101, 'Straight into the table');
  perform assert(false, 'rls: staff must not write leave straight into the table');
exception when insufficient_privilege then
  perform assert(true, 'rls: leave is asked for only through apply_leave');
end $$;
do $$
begin
  update public.leave_requests set status = 'approved' where user_id = auth.uid();
  perform assert(false, 'rls: staff must not approve their own leave in the table');
exception when insufficient_privilege then
  perform assert(true, 'rls: staff cannot change a request''s status in the table');
end $$;
do $$
begin
  insert into public.work_patterns (user_id, days) values (auth.uid(), '{0}');
  perform assert(false, 'rls: staff must not write their own schedule');
exception when insufficient_privilege then
  perform assert(true, 'rls: staff cannot write a schedule into the table');
end $$;
do $$
begin
  perform public.day_kind(auth.uid(), current_date);
  perform assert(false, 'rls: day_kind is internal');
exception when insufficient_privilege then
  perform assert(true, 'rls: the unchecked day_kind() is not callable by signed-in people');
end $$;

select set_config('request.jwt.claim.sub', :'ada', false);
select assert(not exists (select 1 from public.leave_requests where user_id = :'kemi')
                and not exists (select 1 from public.leave_request_detail where user_id = :'kemi'),
  'rls: other staff see none of someone''s leave');

select set_config('request.jwt.claim.sub', :'sola', false);
select assert(exists (select 1 from public.leave_request_detail where user_id = :'kemi' and staff_name = 'Kemi Adeyemi'),
  'rls: a supervisor sees their team''s leave, with names');
select assert(not exists (select 1 from public.leave_requests where user_id = :'obi')
                and not exists (select 1 from public.work_patterns where user_id = :'obi')
                and not exists (select 1 from public.schedule_overrides where user_id = :'obi'),
  'rls: and nothing of anyone outside their team');

select set_config('request.jwt.claim.sub', :'boss', false);
select assert(exists (select 1 from public.work_patterns where user_id = :'obi')
                and exists (select 1 from public.schedule_overrides where user_id = :'obi')
                and (select count(*) from public.leave_request_detail) = (select count(*) from public.leave_requests),
  'rls: an admin sees every schedule and request');

reset role;
select 'ALL RLS CHECKS PASSED';
