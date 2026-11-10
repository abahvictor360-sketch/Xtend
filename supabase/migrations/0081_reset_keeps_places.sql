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
