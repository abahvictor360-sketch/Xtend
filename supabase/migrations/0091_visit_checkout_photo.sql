-- 0091: a photo at store check-out, and both visit photos for the office.
--
-- Marketers took a selfie when they checked in at a store but not when they
-- checked out, so the office could see where they arrived but not prove they
-- were still there when they left. Now the check-out takes one too, and the
-- Attendance page, a person's day and Store visits show both.
--
--   * store_visits.departed_selfie_path / departed_thumb_path, in the
--     person's own folder of the selfies bucket like the check-in photo;
--     never set on insert (only end_store_visit writes them);
--   * end_store_visit(…, p_selfie_path, p_thumb_path): the photo is
--     optional for the database (older apps, the office's own check-outs
--     from 0090) but the app always takes one;
--   * store_visit_detail gains both columns;
--   * the 14-day photo deletion (0067) and the test-run reset (0081) include
--     the check-out photos.

alter table public.store_visits
  add column if not exists departed_selfie_path text
    check (departed_selfie_path is null or length(departed_selfie_path) <= 300),
  add column if not exists departed_thumb_path text
    check (departed_thumb_path is null or length(departed_thumb_path) <= 300);

-- A visit is created without a way out; only end_store_visit records it.
create or replace function public.store_visit_no_departure_photo()
returns trigger language plpgsql as $$
begin
  new.departed_selfie_path := null;
  new.departed_thumb_path := null;
  return new;
end;
$$;
drop trigger if exists trg_store_visit_no_departure_photo on public.store_visits;
create trigger trg_store_visit_no_departure_photo before insert on public.store_visits
  for each row execute function public.store_visit_no_departure_photo();

-- The check-out, now with its photo.
drop function if exists public.end_store_visit(uuid, double precision, double precision, double precision, text, text);
create or replace function public.end_store_visit(
  p_visit_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_place_name text default null,
  p_address text default null,
  p_selfie_path text default null,
  p_thumb_path text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v record;
  new_distance double precision;
  new_status attendance_status;
begin
  select * into v from public.store_visits
  where id = p_visit_id and user_id = auth.uid();

  if v is null then
    raise exception 'That visit is not yours or does not exist';
  end if;
  if v.status <> 'open' then
    raise exception 'That visit is already closed';
  end if;
  -- The photo must be in their own folder, like every other selfie.
  if (p_selfie_path is not null and (split_part(p_selfie_path, '/', 1) <> v.user_id::text
                                     or p_selfie_path like '%..%' or length(p_selfie_path) > 300))
     or (p_thumb_path is not null and (split_part(p_thumb_path, '/', 1) <> v.user_id::text
                                       or p_thumb_path like '%..%' or length(p_thumb_path) > 300)) then
    raise exception 'That check-out photo is not yours';
  end if;

  if v.outlet_lat is null then
    new_distance := null;
    new_status := case when p_accuracy_m > 100 then 'flagged'::attendance_status else null end;
  else
    new_distance := public.distance_metres(p_lat, p_lng, v.outlet_lat, v.outlet_lng);
    new_status := case
      when p_accuracy_m > 100 then 'flagged'::attendance_status
      when new_distance <= coalesce(v.outlet_radius_m, 150) then 'on_site'::attendance_status
      else 'off_site'::attendance_status
    end;
  end if;

  update public.store_visits
  set status               = 'closed',
      departed_at          = now(),
      departed_lat         = p_lat,
      departed_lng         = p_lng,
      departed_accuracy_m  = p_accuracy_m,
      departed_distance_m  = new_distance,
      departed_status      = new_status,
      departed_place_name  = p_place_name,
      departed_address     = p_address,
      departed_selfie_path = p_selfie_path,
      departed_thumb_path  = p_thumb_path
  where id = p_visit_id;

  return jsonb_build_object(
    'id', p_visit_id,
    'departed_at', now(),
    'distance_m', new_distance,
    'status', new_status,
    'minutes', (extract(epoch from (now() - v.arrived_at)) / 60)::int
  );
end;
$$;
revoke all on function public.end_store_visit(uuid, double precision, double precision, double precision, text, text, text, text)
  from public, anon;
grant execute on function public.end_store_visit(uuid, double precision, double precision, double precision, text, text, text, text)
  to authenticated, service_role;

create or replace view public.store_visit_detail
with (security_invoker = true) as
  select
    v.id,
    v.user_id,
    p.full_name as staff_name,
    p.phone     as staff_phone,
    v.outlet_id,
    o.name      as outlet_name,
    o.address   as outlet_address,
    v.visit_date,
    v.status,
    v.arrived_at,
    v.departed_at,
    case
      when v.departed_at is null
        then (extract(epoch from (now() - v.arrived_at)) / 60)::int
      else (extract(epoch from (v.departed_at - v.arrived_at)) / 60)::int
    end as minutes,
    v.arrived_status,
    v.departed_status,
    round(v.arrived_distance_m)::int  as arrived_distance_m,
    round(v.departed_distance_m)::int as departed_distance_m,
    v.arrived_accuracy_m,
    v.arrived_lat,
    v.arrived_lng,
    v.outlet_radius_m,
    v.selfie_path,
    v.thumb_path,
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', v.arrived_place_name,
        nullif(v.arrived_address, v.arrived_place_name))), ''),
      v.arrived_address,
      round(v.arrived_lat::numeric, 5) || ', ' || round(v.arrived_lng::numeric, 5)
    ) as arrived_label,
    v.arrived_place_name,
    v.arrived_address,
    coalesce(
      case when v.arrived_status = 'on_site' then o.name end,
      nullif(v.arrived_place_name, ''),
      nullif(v.arrived_address, ''),
      o.name,
      'Unnamed place'
    ) as store_label,
    case
      when v.arrived_status = 'on_site' and o.name is not null then 'outlet'
      when coalesce(nullif(v.arrived_place_name, ''), nullif(v.arrived_address, '')) is not null
        then 'map'
      else 'outlet'
    end as store_label_source,
    -- New in 052: the way out.
    v.departed_lat,
    v.departed_lng,
    v.departed_accuracy_m,
    coalesce(
      nullif(trim(both ', ' from concat_ws(', ', v.departed_place_name,
        nullif(v.departed_address, v.departed_place_name))), ''),
      v.departed_address,
      case
        when v.departed_lat is not null
        then round(v.departed_lat::numeric, 5) || ', ' || round(v.departed_lng::numeric, 5)
      end
    ) as departed_label,
    v.outlet_lat,
    v.outlet_lng,
    -- New in 0091: the check-out photo.
    v.departed_selfie_path,
    v.departed_thumb_path
  from public.store_visits v
  join public.profiles p on p.id = v.user_id
  left join public.outlets o on o.id = v.outlet_id;

-- The 14-day deletion (0067) covers the check-out photos too.
create or replace function public.expired_selfie_paths(p_hours integer default 336)
returns table (path text)
language sql stable security definer set search_path = public as $$
  with cutoff as (select public.retention_cutoff(p_hours) as at)
  select unnest(array_remove(array[a.selfie_path, a.thumb_path], null))
  from public.attendance a, cutoff c
  where a.created_at < c.at and (a.selfie_path is not null or a.thumb_path is not null)
  union
  select unnest(array_remove(array[v.selfie_path, v.thumb_path], null))
  from public.store_visits v, cutoff c
  where v.created_at < c.at and (v.selfie_path is not null or v.thumb_path is not null)
  union
  select unnest(array_remove(array[v.departed_selfie_path, v.departed_thumb_path], null))
  from public.store_visits v, cutoff c
  where v.created_at < c.at and (v.departed_selfie_path is not null or v.departed_thumb_path is not null);
$$;
revoke all on function public.expired_selfie_paths(integer) from public, anon, authenticated;
grant execute on function public.expired_selfie_paths(integer) to service_role;

create or replace function public.forget_selfie_paths(p_paths text[])
returns integer
language plpgsql security definer set search_path = public as $$
declare
  a integer;
  v integer;
begin
  update public.attendance
  set selfie_path = case when selfie_path = any(p_paths) then null else selfie_path end,
      thumb_path  = case when thumb_path  = any(p_paths) then null else thumb_path end
  where selfie_path = any(p_paths) or thumb_path = any(p_paths);
  get diagnostics a = row_count;

  update public.store_visits
  set selfie_path = case when selfie_path = any(p_paths) then null else selfie_path end,
      thumb_path  = case when thumb_path  = any(p_paths) then null else thumb_path end,
      departed_selfie_path = case when departed_selfie_path = any(p_paths) then null else departed_selfie_path end,
      departed_thumb_path  = case when departed_thumb_path  = any(p_paths) then null else departed_thumb_path end
  where selfie_path = any(p_paths) or thumb_path = any(p_paths)
     or departed_selfie_path = any(p_paths) or departed_thumb_path = any(p_paths);
  get diagnostics v = row_count;
  return a + v;
end;
$$;
revoke all on function public.forget_selfie_paths(text[]) from public, anon, authenticated;
grant execute on function public.forget_selfie_paths(text[]) to service_role;

create or replace function public.forget_expired_selfies(p_hours integer default 336)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := public.retention_cutoff(p_hours);
  a integer;
  v integer;
begin
  update public.attendance
  set selfie_path = null, thumb_path = null
  where created_at < cutoff and (selfie_path is not null or thumb_path is not null);
  get diagnostics a = row_count;

  update public.store_visits
  set selfie_path = null, thumb_path = null, departed_selfie_path = null, departed_thumb_path = null
  where created_at < cutoff
    and (selfie_path is not null or thumb_path is not null
         or departed_selfie_path is not null or departed_thumb_path is not null);
  get diagnostics v = row_count;
  return a + v;
end;
$$;
revoke all on function public.forget_expired_selfies(integer) from public, anon, authenticated;
grant execute on function public.forget_expired_selfies(integer) to service_role;

create or replace function public.selfie_retention_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'retention_days', public.retention_days(),
    'last_run_at', (select last_run_at from public.job_runs where job = 'retention_purge'),
    'last_result', (select last_result from public.job_runs where job = 'retention_purge'),
    'photos_held', (
      (select count(*) from public.attendance where selfie_path is not null)
      + (select count(*) from public.store_visits where selfie_path is not null)
      + (select count(*) from public.store_visits where departed_selfie_path is not null)
    ),
    'overdue', (
      (select count(*) from public.attendance
        where selfie_path is not null
          and created_at < now() - make_interval(days => public.retention_days() + 1))
      + (select count(*) from public.store_visits
        where selfie_path is not null
          and created_at < now() - make_interval(days => public.retention_days() + 1))
      + (select count(*) from public.store_visits
        where departed_selfie_path is not null
          and created_at < now() - make_interval(days => public.retention_days() + 1))
    )
  ) end;
$$;
revoke all on function public.selfie_retention_status() from public, anon;
grant execute on function public.selfie_retention_status() to authenticated, service_role;

create or replace function public.retention_notice_due(p_through timestamptz)
returns table (user_id uuid, role text, selfies integer, report_photos integer, report_files integer)
language sql stable security definer set search_path = public as $$
  with items as (
    select 'selfie'::text as kind, a.user_id as owner
    from public.attendance a
    where a.created_at < p_through and (a.selfie_path is not null or a.thumb_path is not null)
    union all
    select 'selfie', v.user_id
    from public.store_visits v
    where v.created_at < p_through and (v.selfie_path is not null or v.thumb_path is not null)
    union all
    select 'selfie', v.user_id
    from public.store_visits v
    where v.created_at < p_through and (v.departed_selfie_path is not null or v.departed_thumb_path is not null)
    union all
    select 'photo', public.safe_uuid(split_part(o.path, '/', 1))
    from public.report_photo_orphans_before(p_through) o
    union all
    select 'file', public.safe_uuid(split_part(o.path, '/', 1))
    from public.report_file_orphans_before(p_through) o
  ),
  people as (
    select p.id, p.role::text as role
    from public.profiles p
    where p.is_active and p.role in ('admin', 'supervisor')
      and not exists (
        select 1 from public.notifications n
        where n.audience_detail->>'kind' = 'retention_notice'
          and n.audience_detail->'user_ids' ? p.id::text
          and (n.created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)
  )
  select pe.id, pe.role,
         (count(*) filter (where i.kind = 'selfie'))::integer,
         (count(*) filter (where i.kind = 'photo'))::integer,
         (count(*) filter (where i.kind = 'file'))::integer
  from people pe
  join items i on pe.role = 'admin' or public.supervisor_covers(pe.id, i.owner)
  group by pe.id, pe.role;
$$;
revoke all on function public.retention_notice_due(timestamptz) from public, anon, authenticated;
grant execute on function public.retention_notice_due(timestamptz) to service_role;

-- A test-run reset of store visits removes their check-out photos too.
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
    paths := paths || array(select unnest(array[selfie_path, thumb_path, departed_selfie_path, departed_thumb_path])
                            from public.store_visits);
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
