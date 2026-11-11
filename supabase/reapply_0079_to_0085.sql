-- ===== 0079_security_fixes.sql =====
-- =====================================================================
-- XTEND migration 0079 — security fixes from the November 2026 review
--
-- 1. Only field staff report to a supervisor. Promoting somebody to
--    supervisor, HR or admin used to leave their old supervisor_id in
--    place, and the server's "is this person on my team?" check read that
--    link, so a supervisor could reset the password of (or deactivate) the
--    person who had just been promoted above them. Now any account that is
--    not a merchandiser or marketer never has a supervisor: the link is
--    cleared on the way in, and stale links are cleared once below.
-- 2. Message attachments (0075) were readable by any signed-in person who
--    knew the path. A file is now readable by its uploader, or by whoever
--    may read the message it is on (the same can_message rule as the
--    words: the staff member, their supervisor, HR and admins).
-- 3. outlets_for_user(target) answered for anybody. It now answers only
--    for yourself, somebody you supervise, anyone for an admin, anyone but
--    an admin for HR, and for the server (no signed-in user), which is how
--    the database's own functions and jobs use it.
-- 4. A shelf, count or place photo in the "reports" bucket can no longer be
--    overwritten after it was checked: the owner's update policy is gone.
--    Every upload there uses a fresh name, so nothing needed it.
--
-- Rerunnable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Field staff only have a supervisor.
--
-- Named to sort after every other BEFORE trigger on profiles (Postgres
-- fires them in name order), so it sees the role that
-- trg_profiles_staff_role_sync (0042) has just worked out from an added
-- role.
-- ---------------------------------------------------------------------
create or replace function public.profiles_field_only_reporting()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.supervisor_id is not null and not public.is_field_role(new.role) then
    new.supervisor_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_field_only_reporting() from public, anon, authenticated;

drop trigger if exists trg_profiles_zz_field_only_reporting on public.profiles;
create trigger trg_profiles_zz_field_only_reporting
  before insert or update on public.profiles
  for each row execute function public.profiles_field_only_reporting();

-- Links left behind by promotions made before this migration.
update public.profiles
set supervisor_id = null
where supervisor_id is not null and not public.is_field_role(role);

-- ---------------------------------------------------------------------
-- 2. Message attachments follow the message.
-- ---------------------------------------------------------------------
create index if not exists messages_by_attachment_path
  on public.messages (attachment_path) where attachment_path is not null;

create or replace function public.message_file_readable(p_name text)
returns boolean
language sql stable security definer set search_path = public, storage as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or exists (select 1
                 from public.messages m
                 join public.message_threads t on t.id = m.thread_id
                 where m.attachment_path = p_name
                   and public.can_message(t.staff_id));
$$;
revoke all on function public.message_file_readable(text) from public, anon;
grant execute on function public.message_file_readable(text) to authenticated, service_role;

drop policy if exists message_files_read on storage.objects;
create policy message_files_read on storage.objects for select to authenticated
  using (bucket_id = 'message-files' and public.message_file_readable(name));

-- ---------------------------------------------------------------------
-- 3. Whose stores you may ask about.
-- ---------------------------------------------------------------------
create or replace function public.outlets_for_user(target uuid)
returns table (outlet_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id
  from public.outlets o
  where (auth.uid() is null
         or target = auth.uid()
         or public.is_admin()
         or public.supervises_user(target)
         or public.hr_sees(target))
    and o.is_active
    and (o.id in (select s.outlet_id from public.staff_outlets s where s.user_id = target)
         or o.id = (select p.outlet_id from public.profiles p where p.id = target));
$$;

revoke all on function public.outlets_for_user(uuid) from public, anon;
grant execute on function public.outlets_for_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Photos in the reports bucket are never overwritten in place.
-- ---------------------------------------------------------------------
drop policy if exists reports_update_own on storage.objects;

select 'Security fixes (0079) installed' as result;

-- ===== 0080_zero_trust.sql =====
-- =====================================================================
-- XTEND migration 0080 — zero trust: verify the person, not the network
--
--   * Two-step sign-in (a 6-digit code from an authenticator app) for the
--     roles in system_settings.mfa_roles, admins and HR to begin with.
--     is_admin() and is_hr() only count a session that passed the code
--     step (Supabase's 'aal2'), so a stolen password, or a stolen session
--     from before the code, gets no admin or HR power in the database even
--     if the app were bypassed. They also stop counting a deactivated
--     account at once, before its login runs out.
--   * Risky actions need the password (and code) confirmed in the last 10
--     minutes: recent_auth, written only by the server after it checked
--     them (confirm_recent_auth), read by recent_auth_ok.
--   * New-device sign-ins of office accounts are noticed:
--     sign_in_device_status says whether this device is known to the
--     account and whether the account has any known device yet.
--
-- Turning two-step sign-in off for a role (for example while an admin who
-- lost their phone is helped), in the SQL editor:
--   update public.system_settings set mfa_roles = '{hr}';
-- Back on:
--   update public.system_settings set mfa_roles = '{admin,hr}';
-- =====================================================================

alter table public.system_settings
  add column if not exists mfa_roles public.user_role[] not null default '{admin,hr}';

-- The session's assurance level: 'aal2' after the code step, else 'aal1'.
-- A request with no claims at all (the SQL editor, a job) counts as aal1.
create or replace function public.session_aal()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1');
$$;

-- Whether a role must use two-step sign-in.
create or replace function public.mfa_required_for(p_role public.user_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p_role = any(mfa_roles) from public.system_settings where id), false);
$$;

-- The signed-in person has done what their role needs: the code step, or
-- their role does not need it.
create or replace function public.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_aal() = 'aal2'
      or not coalesce((select public.mfa_required_for(role) from public.profiles where id = auth.uid()), false);
$$;

-- For the app: whether the signed-in person's role needs two-step sign-in.
create or replace function public.my_mfa_required()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.mfa_required_for(role) from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.session_aal() from public, anon;
revoke all on function public.mfa_required_for(public.user_role) from public, anon;
revoke all on function public.mfa_satisfied() from public, anon;
revoke all on function public.my_mfa_required() from public, anon;
grant execute on function public.session_aal() to authenticated, service_role;
grant execute on function public.mfa_required_for(public.user_role) to authenticated, service_role;
grant execute on function public.mfa_satisfied() to authenticated, service_role;
grant execute on function public.my_mfa_required() to authenticated, service_role;

-- Admin and HR power only for an active account that passed the code step.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin'::public.user_role and is_active from public.profiles where id = auth.uid()),
    false) and public.mfa_satisfied();
$$;

create or replace function public.is_hr()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'hr'::public.user_role and is_active from public.profiles where id = auth.uid()),
    false) and public.mfa_satisfied();
$$;

-- ---------------------------------------------------------------------
-- Re-confirming before a risky action.
-- ---------------------------------------------------------------------
create table if not exists public.recent_auth (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);
alter table public.recent_auth enable row level security;
revoke all on public.recent_auth from anon, authenticated;

-- The server calls this only after it checked the password (and code).
create or replace function public.confirm_recent_auth(p_user uuid)
returns void
language sql security definer set search_path = public as $$
  insert into public.recent_auth (user_id, confirmed_at) values (p_user, now())
  on conflict (user_id) do update set confirmed_at = excluded.confirmed_at;
$$;

create or replace function public.recent_auth_ok(p_user uuid, p_minutes integer default 10)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recent_auth
                 where user_id = p_user
                   and confirmed_at > now() - make_interval(mins => greatest(1, least(p_minutes, 60))));
$$;

revoke all on function public.confirm_recent_auth(uuid) from public, anon, authenticated;
revoke all on function public.recent_auth_ok(uuid, integer) from public, anon, authenticated;
grant execute on function public.confirm_recent_auth(uuid) to service_role;
grant execute on function public.recent_auth_ok(uuid, integer) to service_role;

-- ---------------------------------------------------------------------
-- New devices: asked just before a successful sign-in records the device.
-- ---------------------------------------------------------------------
create or replace function public.sign_in_device_status(p_account text, p_device text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'known', public.sign_in_known_device(p_account, p_device),
    'any_known', exists (select 1 from public.sign_in_trusted_devices where account = lower(btrim(p_account))));
$$;
revoke all on function public.sign_in_device_status(text, text) from public, anon, authenticated;
grant execute on function public.sign_in_device_status(text, text) to service_role;

-- Test-mode reset (0066): recent confirmations go with the staff accounts
-- they belong to (on delete cascade), so nothing to add to the categories.

select 'Zero trust (0080) installed' as result;

-- ===== 0081_reset_keeps_places.sql =====
-- 0081: a test-run reset keeps every place Xtend learned.
--
-- The owner tests Xtend in several locations before going live, then
-- resets. The places learned along the way (known_places: shop name,
-- address and where it is, with the staff photo when staff named it) and
-- the saved addresses (place_addresses, 0068) are what spare Google next
-- time, so a reset no longer clears them, whatever is ticked:
--
--   * 'Store visits and places' becomes store visits only (and the
--     places still waiting to be named, which belong to those events);
--   * no stored photo of a learned place is removed, also when the person
--     who named it is removed or everything else is reset.
--
-- An admin can still correct or delete a single place on the Places page.

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
    'notifications:notification_deliveries', 'notifications:scheduled_notifications',
    'notifications:notifications', 'activity:user_activity', 'ask:assistant_conversations',
    'stores:xm_stores', 'stores:outlets', 'audit:audit_log'
  ]) with ordinality as v(x, n);
$$;

create or replace function public.reset_test_data(p_actor uuid, p_categories text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cats text[];
  everything boolean;
  r record;
  n bigint;
  before jsonb := '{}'::jsonb;
  removed jsonb := '{}'::jsonb;
  by_cat jsonb := '{}'::jsonb;
  with_staff bigint := 0;
  paths text[] := '{}';
  staff_ids uuid[];
  files_queued integer := 0;
  accounts integer := 0;
  auth_fallback boolean := false;
  result jsonb;
  t text;
begin
  perform set_config('lock_timeout', '15s', true);

  if not exists (select 1 from public.profiles
                 where id = p_actor and role = 'admin' and is_active) then
    raise exception 'Only an admin can reset Xtend';
  end if;
  if auth.uid() is not null and auth.uid() <> p_actor then
    raise exception 'Only an admin can reset Xtend';
  end if;
  if not coalesce((select test_mode from public.system_settings where id for update), false) then
    raise exception 'Xtend is live: test mode is off, so nothing can be reset';
  end if;

  cats := public.reset_resolve_categories(p_categories);
  everything := cats @> public.reset_category_keys();

  -- How many rows each table holds now.
  for t in select c.table_name from public.reset_category_tables() c
           union all select unnest(public.reset_staff_tables()) loop
    execute format('select count(*) from public.%I', t) into n;
    before := before || jsonb_build_object(t, n);
  end loop;

  select coalesce(array_agg(id), '{}') into staff_ids
  from public.profiles where role <> 'admin' and 'staff' = any(cats);

  -- Files that belong to what is being cleared.
  if 'clock_ins' = any(cats) then
    paths := paths || array(select unnest(array[selfie_path, thumb_path]) from public.attendance);
  end if;
  if 'visits_places' = any(cats) then
    paths := paths || array(select unnest(array[selfie_path, thumb_path]) from public.store_visits);
  end if;
  if 'reports' = any(cats) then
    paths := paths || array(select storage_path from public.report_photos)
                   || array(select path from public.report_files);
  end if;
  if 'stock_counts' = any(cats) then
    paths := paths || array(select photo_path from public.store_counts)
                   || array(select path from public.store_count_sheets);
  end if;
  if 'xm' = any(cats) then
    paths := paths || array(select photo_path from public.xm_counts)
                   || array(select photo_path from public.xm_sales);
  end if;

  insert into public.system_reset_files (bucket, name)
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('selfies', 'reports', 'report-files', 'avatars')
    and not exists (select 1 from public.count_sheet_templates ct where ct.path = o.name)
    -- The places Xtend learned stay, so their photos stay too, even when
    -- the person who named one is removed or everything else goes (0081).
    and not exists (select 1 from public.known_places kp
                    where o.name = kp.photo_path or o.name = kp.selfie_path)
    and (
      (o.bucket_id <> 'avatars' and o.name = any(paths))
      -- Everything in the folders of the people removed.
      or split_part(o.name, '/', 1) = any(array(select x::text from unnest(staff_ids) x))
      -- Starting completely fresh: every stored test file, except the
      -- admins' own profile photos.
      or (everything and (o.bucket_id <> 'avatars'
                          or split_part(o.name, '/', 1) not in
                             (select p.id::text from public.profiles p where p.role = 'admin')))
    )
  on conflict (bucket, name) do nothing;
  get diagnostics files_queued = row_count;

  -- Clear, in order.
  if 'teams' = any(cats) then
    update public.profiles set supervisor_id = null, outlet_id = null
    where supervisor_id is not null or outlet_id is not null;
  end if;
  for r in select c.category, c.table_name from public.reset_category_tables() c
           where c.category = any(cats) and c.category not in ('audit') order by c.step loop
    if r.table_name = 'outlets' and not ('reports' = any(cats)) then
      -- Reports kept from a store being removed lose the store (ON DELETE
      -- SET NULL). Their guards would refuse that edit to a past report,
      -- and re-reading the day's visits would empty what the report kept,
      -- so they stand aside for this one statement. ALTER TABLE is part of
      -- this transaction: if anything fails, they are back on.
      alter table public.reports disable trigger trg_report_enforce;
      alter table public.reports disable trigger trg_report_visits;
      alter table public.reports disable trigger trg_reports_touch;
      delete from public.outlets;
      alter table public.reports enable trigger trg_report_enforce;
      alter table public.reports enable trigger trg_report_visits;
      alter table public.reports enable trigger trg_reports_touch;
    else
      execute format('delete from public.%I', r.table_name);
    end if;
  end loop;

  if 'staff' = any(cats) and cardinality(staff_ids) > 0 then
    -- Their support chats go first, messages before threads: left to the
    -- cascade, a reply in their thread from someone else being removed
    -- too would be updated after its thread had gone.
    delete from public.support_messages
    where thread_id in (select id from public.support_threads where user_id = any(staff_ids));
    delete from public.support_threads where user_id = any(staff_ids);
    begin
      delete from auth.users where id = any(staff_ids);
    exception when insufficient_privilege or foreign_key_violation then
      -- The server removes the sign-ins with the Auth admin API instead.
      auth_fallback := true;
      delete from public.profiles where id = any(staff_ids);
    end;
    accounts := cardinality(staff_ids);
  end if;

  if 'audit' = any(cats) then
    delete from public.audit_log;
  end if;

  -- What went.
  for t in select c.table_name from public.reset_category_tables() c
           union all select unnest(public.reset_staff_tables()) loop
    execute format('select count(*) from public.%I', t) into n;
    if (before->>t)::bigint - n > 0 then
      removed := removed || jsonb_build_object(t, (before->>t)::bigint - n);
    end if;
  end loop;
  for r in select c.category, c.table_name from public.reset_category_tables() c
           union all select 'staff', unnest(public.reset_staff_tables()) loop
    n := coalesce((removed->>r.table_name)::bigint, 0);
    if r.category = any(cats) then
      by_cat := by_cat || jsonb_build_object(r.category, coalesce((by_cat->>r.category)::bigint, 0) + n);
    else
      with_staff := with_staff + n;
    end if;
  end loop;

  result := jsonb_build_object(
    'requested', to_jsonb(p_categories),
    'categories', to_jsonb(cats),
    'everything', everything,
    'by_category', by_cat,
    'also_removed', with_staff,
    'tables', removed,
    'accounts', accounts,
    'auth_fallback', auth_fallback,
    'files_queued', files_queued,
    'at', now());

  update public.system_settings
  set last_reset_at = now(), last_reset_by = p_actor, last_reset = result
  where id;

  -- The one record of it (all the audit log holds when it was cleared).
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (p_actor, 'system.reset', 'system_settings', null, result);

  return result;
end;
$$;
revoke all on function public.reset_test_data(uuid, text[]) from public, anon, authenticated;
grant execute on function public.reset_test_data(uuid, text[]) to service_role;

-- ===== 0082_app_update_notices.sql =====
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

-- ===== 0083_team_photo_access.sql =====
-- =====================================================================
-- XTEND migration 0083 — supervisors and HR can open their people's photos
--
-- Clock-in selfies (the "selfies" bucket), shelf, count and place photos
-- (the "reports" bucket) and profile photos (the "avatars" bucket) could
-- only be read by the person who took them and by admins. A supervisor
-- checking a flagged photo, or HR looking through attendance, got no image.
-- Now a photo can also be opened by:
--
--   * the person's supervisor (supervises_user: their own team only);
--   * HR (hr_sees: every field and office person except admins);
--   * an admin, as before, and the person themselves.
--
-- Nothing else changes: uploads stay in the owner's own folder, deleting
-- and overwriting rules are untouched, and a signed-out visitor still
-- reads nothing (the policies are now for signed-in people only, so the
-- helper functions they call are never asked of a signed-out visitor).
--
-- The first folder of every path is the owner's id. safe_uuid() turns a
-- folder that is not an id into null instead of an error, so a stray file
-- can never break a listing.
--
-- Rerunnable.
-- =====================================================================

drop policy if exists selfies_read on storage.objects;
create policy selfies_read on storage.objects for select to authenticated
  using (
    bucket_id = 'selfies' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(public.safe_uuid((storage.foldername(name))[1]))
      or public.hr_sees(public.safe_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists reports_read on storage.objects;
create policy reports_read on storage.objects for select to authenticated
  using (
    bucket_id = 'reports' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(public.safe_uuid((storage.foldername(name))[1]))
      or public.hr_sees(public.safe_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(public.safe_uuid((storage.foldername(name))[1]))
      or public.hr_sees(public.safe_uuid((storage.foldername(name))[1]))
    )
  );

select 'Team photo access (0083) installed' as result;

-- ===== 0085_late_tracking_points.sql =====
-- =====================================================================
-- XTEND migration 0085 — movement saved with no signal is kept after clock-out
--
-- The Android app saves positions on the phone while it has no signal and
-- sends them when the signal returns. 0055 refused every position once the
-- shift had ended (so a stale queue could not raise movement alerts), but
-- that threw away the whole stretch of an offline shift whenever the
-- clock-out reached the server before the phone's positions did, which is
-- the usual order when both were made with no signal.
--
-- Now, for the token that belongs to a finished shift:
--   * positions taken DURING the shift are kept, for 24 hours after the
--     token ended (or expired), stored as offline positions at the time
--     they were taken, so they raise no movement alerts;
--   * anything taken after the clock-out is still ignored;
--   * the token is retired, and the phone is told to stop, once they are in
--     (the route does not say stop after a full batch of 500, so a longer
--     queue is sent in full).
-- A token issued after the clock-out, one for a shift that never ended, and
-- one that ended more than 24 hours ago are refused as before.
--
-- Rerunnable (create or replace).
-- =====================================================================

create or replace function public.record_background_pings(
  p_token text, p_points jsonb, p_sent_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t record;
  offset_s integer := coalesce(extract(epoch from (p_sent_at - now()))::integer, 0);
  point jsonb;
  taken timestamptz;
  kept integer := 0;
  mocked integer := 0;
  la double precision;
  ln double precision;
  acc double precision;
  alert_before timestamptz;
  alert record;
  open_shift boolean;
  late boolean := false;
  shift_day date;
  opened_at timestamptz;
  closed_at timestamptz;
begin
  select * into t from public.tracking_tokens
  where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'utf8')), 'hex');
  if t.id is null then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;
  if not exists (select 1 from public.profiles where id = t.user_id and is_active) then
    return jsonb_build_object('ok', false, 'reason', 'token');
  end if;

  -- When the shift this token was issued for began and ended (Lagos day).
  shift_day := (t.created_at at time zone 'Africa/Lagos')::date;
  select min(coalesce(a.client_captured_at, a.created_at)) filter (where a.type = 'opening'),
         max(coalesce(a.client_captured_at, a.created_at)) filter (where a.type = 'closing')
    into opened_at, closed_at
  from public.attendance a
  where a.user_id = t.user_id and a.attendance_date = shift_day;

  if t.revoked_at is not null or t.expires_at < now() then
    -- An ended token. It still delivers what was taken during a shift that
    -- has since finished, for 24 hours; a token made after the clock-out,
    -- or for a shift that never ended, is refused as before.
    if opened_at is not null and closed_at is not null and t.created_at < closed_at
       and coalesce(t.revoked_at, t.expires_at) > now() - interval '24 hours' then
      late := true;
    else
      return jsonb_build_object('ok', false, 'reason', 'token');
    end if;
  else
    open_shift := exists (
      select 1 from public.attendance
      where user_id = t.user_id and attendance_date = public.business_date() and type = 'opening'
    ) and not exists (
      select 1 from public.attendance
      where user_id = t.user_id and attendance_date = public.business_date() and type = 'closing'
    );
    if not open_shift then
      if opened_at is not null and closed_at is not null and t.created_at < closed_at then
        late := true;
      else
        update public.tracking_tokens set revoked_at = now() where id = t.id;
        return jsonb_build_object('ok', false, 'stop', true, 'shift_open', false);
      end if;
    end if;
  end if;

  if jsonb_typeof(p_points) <> 'array' or jsonb_array_length(p_points) > 500 then
    raise exception 'Send at most 500 positions at a time';
  end if;

  perform set_config('request.jwt.claim.sub', t.user_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', t.user_id, 'role', 'authenticated')::text, true);

  select max(created_at) into alert_before from public.location_alerts
  where user_id = t.user_id and alert_type = 'left_geofence';

  for point in select * from jsonb_array_elements(p_points) order by (value->>'captured_at') loop
    taken := public.safe_ts(point->>'captured_at') - make_interval(secs => offset_s);
    if taken is null or taken > now() + interval '2 minutes' or taken < now() - interval '24 hours'
       or taken < t.created_at - interval '5 minutes'
       or (late and (taken > closed_at or taken < opened_at - interval '5 minutes'))
       or jsonb_typeof(point->'lat') <> 'number' or jsonb_typeof(point->'lng') <> 'number'
       or jsonb_typeof(point->'accuracy_m') <> 'number' then
      continue;
    end if;
    la := (point->>'lat')::float8;
    ln := (point->>'lng')::float8;
    acc := (point->>'accuracy_m')::float8;
    if abs(la) > 90 or abs(ln) > 180 or acc < 0 then continue; end if;
    if (point->>'is_mock')::boolean is true then mocked := mocked + 1; end if;
    if exists (
      select 1 from public.location_pings l
      where l.user_id = t.user_id and l.created_at between taken - interval '1 second' and taken + interval '1 second'
    ) then continue; end if;

    -- After the shift every position is stored as the offline one it is, at
    -- the time it was taken, so none can raise a movement alert.
    if not late and now() - taken <= interval '2 minutes' then
      perform set_config('xtend.offline_ping', 'off', true);
      insert into public.location_pings (lat, lng, accuracy_m) values (la, ln, acc);
    else
      perform set_config('xtend.offline_ping', 'on', true);
      insert into public.location_pings (lat, lng, accuracy_m, created_at) values (la, ln, acc, taken);
    end if;
    kept := kept + 1;
  end loop;
  perform set_config('xtend.offline_ping', 'off', true);

  if mocked > 0 and not exists (
    select 1 from public.integrity_flags
    where user_id = t.user_id and kind = 'mock_location_confirmed'
      and flag_date = public.business_date() and detail->>'source' = 'background'
  ) then
    insert into public.integrity_flags (user_id, kind, severity, summary, detail)
    values (t.user_id, 'mock_location_confirmed', 'high',
            format('The phone said %s position%s sent while on shift came from a fake-location app',
                   mocked, case when mocked = 1 then '' else 's' end),
            jsonb_build_object('source', 'background', 'positions', mocked));
  end if;

  update public.tracking_tokens set last_used_at = now(), points = points + kept where id = t.id;

  if late then
    -- The shift is over: retire the token (the route tells the phone to stop
    -- unless this was a full batch, so a longer queue is sent in full).
    if t.revoked_at is null then
      update public.tracking_tokens set revoked_at = now() where id = t.id;
    end if;
    return jsonb_build_object('ok', true, 'user_id', t.user_id, 'kept', kept,
                              'shift_open', false, 'late', true, 'alert', null);
  end if;

  select a.id, a.distance_m, l.id as ping_id, l.lat, l.lng into alert
  from public.location_alerts a
  left join lateral (
    select p.id, p.lat, p.lng from public.location_pings p
    where p.user_id = t.user_id and not p.offline order by p.created_at desc limit 1
  ) l on true
  where a.user_id = t.user_id and a.alert_type = 'left_geofence'
    and a.created_at > coalesce(alert_before, '-infinity')
  order by a.created_at desc limit 1;

  -- Re-check after processing to close the race with a simultaneous clock-out.
  open_shift := exists (
    select 1 from public.attendance
    where user_id = t.user_id and attendance_date = public.business_date() and type = 'opening'
  ) and not exists (
    select 1 from public.attendance
    where user_id = t.user_id and attendance_date = public.business_date() and type = 'closing'
  );
  if not open_shift then update public.tracking_tokens set revoked_at = now() where id = t.id; end if;

  return jsonb_build_object(
    'ok', true, 'user_id', t.user_id, 'kept', kept, 'shift_open', open_shift,
    'alert', case when alert.id is null then null else jsonb_build_object(
      'id', alert.id, 'distance_m', alert.distance_m, 'ping_id', alert.ping_id,
      'lat', alert.lat, 'lng', alert.lng) end
  );
end;
$$;

select 'Late tracking points (0085) installed' as result;

