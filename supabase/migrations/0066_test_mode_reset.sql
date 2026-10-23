-- =====================================================================
-- 0066: Test mode and resetting the test run
--
-- "Admin should be able to reset his dashboard (we are going to test run
-- the app in different locations) then we reset and start afresh."
-- "I should be able to pick what I want to reset."
--
--   * system_settings: one row. test_mode starts ON, so the coming test
--     run can be reset. An admin turns it OFF when Xtend goes live, and it
--     can never be turned back on (a trigger refuses it, whoever asks).
--   * reset_test_data(actor, categories): while test mode is on, an admin
--     clears the categories they ticked, plus the ones those depend on, in
--     ONE transaction, and gets back what was removed. The audit log gains
--     one "system.reset" row (or, when the audit log itself is cleared,
--     that row is all it holds).
--   * Never touched: admin accounts, products and the system's set-up
--     (settings, notification templates, quick replies, scoring policy,
--     count sheet template, roles, app releases, job bookkeeping).
--   * Stored files (photos, documents, count sheets, profile photos) are
--     queued in system_reset_files for the server to delete through the
--     Storage API: Supabase refuses SQL deletes on storage.objects.
--   * Non-admin sign-in accounts are deleted from auth.users here, in the
--     same transaction, which cascades to their profiles. Should Supabase
--     ever refuse that, the profiles are deleted instead and the server
--     removes the left-over sign-ins with the Auth admin API.
--
-- Nothing in the database blocks deletes with a trigger (attendance,
-- counts and the audit log are append-only through RLS and grants, which
-- the table owner running this function is not subject to), so no
-- protection has to be switched off and on again.
-- =====================================================================

do $$
begin
  if to_regclass('public.report_files') is null then
    raise exception 'Run the count sheet and report documents update (064) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- The system's own switches: one row.
-- ---------------------------------------------------------------------
create table if not exists public.system_settings (
  id             boolean primary key default true check (id),
  test_mode      boolean not null default true,
  went_live_at   timestamptz,
  went_live_by   uuid references public.profiles(id) on delete set null,
  last_reset_at  timestamptz,
  last_reset_by  uuid references public.profiles(id) on delete set null,
  last_reset     jsonb,
  updated_at     timestamptz not null default now()
);
insert into public.system_settings (id) values (true) on conflict (id) do nothing;

alter table public.system_settings enable row level security;
drop policy if exists system_settings_admin_read on public.system_settings;
create policy system_settings_admin_read on public.system_settings
  for select to authenticated using (public.is_admin());
revoke insert, update, delete, truncate on public.system_settings from anon, authenticated;

-- Test mode is one-way: once off it stays off. The row is never deleted.
create or replace function public.system_settings_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'The system settings cannot be deleted';
  end if;
  if old.test_mode = false and new.test_mode = true then
    raise exception 'Test mode cannot be turned back on once Xtend is live';
  end if;
  if old.test_mode = false then
    -- Once live, when and by whom stay as they were.
    new.went_live_at := old.went_live_at;
    new.went_live_by := old.went_live_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_system_settings_guard on public.system_settings;
create trigger trg_system_settings_guard before update or delete on public.system_settings
  for each row execute function public.system_settings_guard();
drop trigger if exists trg_system_settings_no_truncate on public.system_settings;
create trigger trg_system_settings_no_truncate before truncate on public.system_settings
  for each statement execute function public.system_settings_guard();

-- ---------------------------------------------------------------------
-- Files a reset has queued for the server to delete (Storage API).
-- ---------------------------------------------------------------------
create table if not exists public.system_reset_files (
  bucket    text not null,
  name      text not null,
  queued_at timestamptz not null default now(),
  primary key (bucket, name)
);
alter table public.system_reset_files enable row level security;
revoke all on public.system_reset_files from anon, authenticated;

-- ---------------------------------------------------------------------
-- The categories an admin can tick, and which tables each one clears.
-- Every table that holds test data belongs to exactly one category. The
-- order is the order they are cleared in (references first).
-- ---------------------------------------------------------------------
create or replace function public.reset_category_keys()
returns text[] language sql immutable as $$
  select array['clock_ins', 'visits_places', 'reports', 'stock_counts', 'xm', 'leave_schedules',
               'support', 'notifications', 'activity', 'ask', 'teams', 'stores', 'staff', 'audit'];
$$;

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
    'visits_places:store_visits', 'visits_places:known_places', 'clock_ins:location_alerts',
    'clock_ins:location_pings', 'clock_ins:excuse_checks', 'clock_ins:phone_checks',
    'clock_ins:photo_checks', 'clock_ins:device_beacons', 'clock_ins:clock_out_reminders',
    'clock_ins:tracking_tokens', 'clock_ins:integrity_flags', 'clock_ins:attendance',
    'leave_schedules:leave_requests', 'leave_schedules:schedule_overrides',
    'leave_schedules:work_patterns', 'support:support_messages', 'support:support_threads',
    'notifications:notification_deliveries', 'notifications:scheduled_notifications',
    'notifications:notifications', 'activity:user_activity', 'ask:assistant_conversations',
    'stores:xm_stores', 'stores:outlets', 'audit:audit_log'
  ]) with ordinality as v(x, n);
$$;

-- Tables where only the people removed lose rows: admins keep theirs.
create or replace function public.reset_staff_tables()
returns text[] language sql immutable as $$
  select array['profiles', 'push_subscriptions', 'app_installs', 'staff_temp_passwords'];
$$;

-- What a choice really clears: unknown keys are refused, 'everything'
-- means every category, and a category others rest on brings them along
-- (staff records reference their accounts; store records reference the
-- store). Returned in the canonical order.
create or replace function public.reset_resolve_categories(p_categories text[])
returns text[] language plpgsql immutable as $$
declare
  keys text[] := public.reset_category_keys();
  picked text[] := '{}';
  k text;
begin
  if p_categories is null or cardinality(p_categories) = 0 then
    raise exception 'Choose at least one thing to reset';
  end if;
  foreach k in array p_categories loop
    if k = 'everything' then
      picked := keys;
    elsif k = any(keys) then
      picked := picked || k;
    else
      raise exception 'Unknown thing to reset: %', left(k, 40);
    end if;
  end loop;
  if 'staff' = any(picked) then
    picked := picked || array['clock_ins', 'visits_places', 'reports', 'stock_counts', 'xm'];
  end if;
  if 'stores' = any(picked) then
    picked := picked || array['visits_places', 'stock_counts', 'xm', 'teams'];
  end if;
  return array(select x from unnest(keys) with ordinality u(x, n) where x = any(picked) order by n);
end;
$$;

-- ---------------------------------------------------------------------
-- The reset.
-- ---------------------------------------------------------------------
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
    paths := paths || array(select unnest(array[selfie_path, thumb_path]) from public.store_visits)
                   || array(select unnest(array[photo_path, selfie_path]) from public.known_places);
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

-- ---------------------------------------------------------------------
-- Going live: test mode off, for good.
-- ---------------------------------------------------------------------
create or replace function public.system_go_live(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.system_settings;
begin
  if not exists (select 1 from public.profiles
                 where id = p_actor and role = 'admin' and is_active) then
    raise exception 'Only an admin can turn test mode off';
  end if;
  if auth.uid() is not null and auth.uid() <> p_actor then
    raise exception 'Only an admin can turn test mode off';
  end if;
  select * into s from public.system_settings where id for update;
  if not s.test_mode then
    raise exception 'Xtend is already live';
  end if;
  update public.system_settings
  set test_mode = false, went_live_at = now(), went_live_by = p_actor
  where id returning * into s;
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (p_actor, 'system.go_live', 'system_settings', null, jsonb_build_object('went_live_at', s.went_live_at));
  return jsonb_build_object('test_mode', s.test_mode, 'went_live_at', s.went_live_at);
end;
$$;
revoke all on function public.system_go_live(uuid) from public, anon, authenticated;
grant execute on function public.system_go_live(uuid) to service_role;

-- ---------------------------------------------------------------------
-- The server working through the queued files.
-- ---------------------------------------------------------------------
create or replace function public.reset_files_next(p_limit integer)
returns table (bucket text, name text)
language sql stable security definer set search_path = public as $$
  select f.bucket, f.name from public.system_reset_files f
  order by f.queued_at, f.bucket, f.name
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;
revoke all on function public.reset_files_next(integer) from public, anon, authenticated;
grant execute on function public.reset_files_next(integer) to service_role;

create or replace function public.reset_files_done(p_bucket text, p_names text[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.system_reset_files where bucket = p_bucket and name = any(p_names);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.reset_files_done(text, text[]) from public, anon, authenticated;
grant execute on function public.reset_files_done(text, text[]) to service_role;

-- How many files are still waiting, for the System page (admins only).
create or replace function public.reset_files_pending()
returns integer language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then (select count(*)::integer from public.system_reset_files) else 0 end;
$$;
revoke all on function public.reset_files_pending() from public, anon;
grant execute on function public.reset_files_pending() to authenticated, service_role;

select 'Test mode and reset (066) installed' as result;
