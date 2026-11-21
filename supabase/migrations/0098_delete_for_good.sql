-- =====================================================================
-- XTEND migration 0098 — delete a store or a person for good
--
-- A store or an account with history (clock-ins, visits, reports, counts,
-- X Metrics) could only be deactivated: the database keeps those records
-- (ON DELETE RESTRICT). Stores and people added by mistake or for a test
-- run stayed forever.
--
-- Now an admin can remove one for good, after seeing what goes with it:
--
--   * delete_for_good_preview(kind, id): what would be removed, counted
--     per table (kind is 'outlet' or 'staff');
--   * delete_for_good(kind, id, confirm): removes the store or person and
--     every record that belongs to them, deepest first, in one transaction
--     (all or nothing). `confirm` must be the store's or person's name,
--     exactly as shown. Their stored photos and files are queued for the
--     server to remove (system_reset_files, as the test-run reset does).
--
-- What stays: the audit log (who did what keeps its rows; a removed
-- person's name goes, as it does for any deleted account), the places
-- Xtend learned, and other people's records, which only lose the link
-- (their store or "decided by" is emptied, as the database already does).
-- Nobody can remove their own account, the last active admin, or anything
-- while not an admin. Each removal writes one audit row with the name and
-- what was removed.
--
-- Rerunnable.
-- =====================================================================

-- Walks every record that points at these rows, deepest first. Dry: only
-- counts. Not dry: deletes them. Only single-column links to a uuid `id`
-- are followed (every link in Xtend); the audit log is never touched.
create or replace function public.purge_walk(p_table regclass, p_ids uuid[], p_dry boolean, p_depth integer, p_counts jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  fk record;
  child uuid[];
  n bigint;
  counts jsonb := coalesce(p_counts, '{}'::jsonb);
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return counts;
  end if;
  if p_depth > 6 then
    raise exception 'Those records are linked too deeply to remove safely';
  end if;

  for fk in
    select c.conrelid::regclass as rel, a.attname::text as col, c.confdeltype,
           exists (select 1 from pg_attribute ia
                   where ia.attrelid = c.conrelid and ia.attname = 'id'
                     and ia.atttypid = 'uuid'::regtype and not ia.attisdropped) as has_id
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where c.contype = 'f'
      and c.confrelid = p_table
      and cardinality(c.conkey) = 1
      and ra.attname = 'id'
      and c.confdeltype in ('r', 'a', 'c')
      and c.conrelid <> 'public.audit_log'::regclass
    order by c.conrelid::regclass::text, a.attname
  loop
    -- A table pointing at itself (a reply to a reply) is cleared with its rows.
    if fk.rel = p_table then
      continue;
    end if;
    if fk.has_id then
      execute format('select coalesce(array_agg(id), ''{}'') from %s where %I = any($1)', fk.rel, fk.col)
        into child using p_ids;
      if cardinality(child) = 0 then
        continue;
      end if;
      counts := public.purge_walk(fk.rel, child, p_dry, p_depth + 1, counts);
      if p_dry then
        n := cardinality(child);
      else
        execute format('delete from %s where %I = any($1)', fk.rel, fk.col) using p_ids;
        get diagnostics n = row_count;
      end if;
    else
      if p_dry then
        execute format('select count(*) from %s where %I = any($1)', fk.rel, fk.col) into n using p_ids;
      else
        execute format('delete from %s where %I = any($1)', fk.rel, fk.col) using p_ids;
        get diagnostics n = row_count;
      end if;
    end if;
    if n > 0 then
      counts := counts || jsonb_build_object(
        replace(fk.rel::text, 'public.', ''),
        coalesce((counts->>replace(fk.rel::text, 'public.', ''))::bigint, 0) + n);
    end if;
  end loop;
  return counts;
end;
$$;

revoke all on function public.purge_walk(regclass, uuid[], boolean, integer, jsonb) from public, anon, authenticated;

-- Who or what is being removed, and the checks every removal passes.
create or replace function public.delete_for_good_target(p_kind text, p_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  label text;
  target_role text;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can delete for good';
  end if;
  if p_kind = 'outlet' then
    select o.name into label from public.outlets o where o.id = p_id;
    if label is null then raise exception 'That store is already gone'; end if;
  elsif p_kind = 'staff' then
    select p.full_name, p.role::text into label, target_role from public.profiles p where p.id = p_id;
    if label is null then raise exception 'That person is already gone'; end if;
    if p_id = auth.uid() then
      raise exception 'You cannot delete your own account';
    end if;
    if target_role = 'admin' and not exists (
      select 1 from public.profiles p where p.role = 'admin' and p.is_active and p.id <> p_id) then
      raise exception 'This is the last admin. Make someone else an admin first';
    end if;
  else
    raise exception 'Choose a store or a person to delete';
  end if;
  return label;
end;
$$;

revoke all on function public.delete_for_good_target(text, uuid) from public, anon, authenticated;

create or replace function public.delete_for_good_preview(p_kind text, p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  label text := public.delete_for_good_target(p_kind, p_id);
  counts jsonb;
begin
  counts := public.purge_walk(
    case when p_kind = 'outlet' then 'public.outlets'::regclass else 'public.profiles'::regclass end,
    array[p_id], true, 1, '{}'::jsonb);
  return jsonb_build_object('kind', p_kind, 'id', p_id, 'name', label, 'records', counts);
end;
$$;

revoke all on function public.delete_for_good_preview(text, uuid) from public, anon;
grant execute on function public.delete_for_good_preview(text, uuid) to authenticated, service_role;

create or replace function public.delete_for_good(p_kind text, p_id uuid, p_confirm text)
returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  label text := public.delete_for_good_target(p_kind, p_id);
  counts jsonb;
  files integer := 0;
  auth_fallback boolean := false;
begin
  perform set_config('lock_timeout', '15s', true);
  if btrim(coalesce(p_confirm, '')) is distinct from btrim(label) then
    raise exception 'Type the name exactly as shown to confirm';
  end if;

  -- Their stored photos and files, removed by the server afterwards.
  if p_kind = 'staff' then
    insert into public.system_reset_files (bucket, name)
    select o.bucket_id, o.name from storage.objects o
    where o.bucket_id in ('selfies', 'reports', 'report-files', 'avatars', 'message-files')
      and split_part(o.name, '/', 1) = p_id::text
      and not exists (select 1 from public.known_places kp where o.name = kp.photo_path or o.name = kp.selfie_path)
      and not exists (select 1 from public.count_sheet_templates ct where ct.path = o.name)
    on conflict (bucket, name) do nothing;
    get diagnostics files = row_count;
  else
    insert into public.system_reset_files (bucket, name)
    select o.bucket_id, o.name from storage.objects o
    where o.bucket_id in ('selfies', 'reports', 'report-files')
      and o.name in (
        select unnest(array[v.selfie_path, v.thumb_path, v.departed_selfie_path, v.departed_thumb_path])
          from public.store_visits v where v.outlet_id = p_id
        union all select c.photo_path from public.store_counts c where c.outlet_id = p_id
        union all select s.path from public.store_count_sheets s where s.outlet_id = p_id
        union all select x.photo_path from public.xm_counts x where x.outlet_id = p_id
        union all select x.photo_path from public.xm_sales x where x.outlet_id = p_id)
      and not exists (select 1 from public.known_places kp where o.name = kp.photo_path or o.name = kp.selfie_path)
    on conflict (bucket, name) do nothing;
    get diagnostics files = row_count;
  end if;

  -- Reports that only lose their store (a day report filed from it) keep
  -- their words; their guards would refuse that edit to a past report, so
  -- they stand aside for this transaction, as in the test-run reset.
  alter table public.reports disable trigger trg_report_enforce;
  alter table public.reports disable trigger trg_report_visits;
  alter table public.reports disable trigger trg_reports_touch;

  if p_kind = 'outlet' then
    counts := public.purge_walk('public.outlets'::regclass, array[p_id], false, 1, '{}'::jsonb);
    delete from public.outlets where id = p_id;
  else
    -- Support chats first, messages before threads (as in the reset).
    delete from public.support_messages
    where thread_id in (select id from public.support_threads where user_id = p_id);
    counts := public.purge_walk('public.profiles'::regclass, array[p_id], false, 1, '{}'::jsonb);
    begin
      delete from auth.users where id = p_id;
    exception when insufficient_privilege or foreign_key_violation then
      -- The server removes the sign-in with the Auth admin API instead.
      auth_fallback := true;
    end;
    delete from public.profiles where id = p_id;
  end if;

  alter table public.reports enable trigger trg_report_enforce;
  alter table public.reports enable trigger trg_report_visits;
  alter table public.reports enable trigger trg_reports_touch;

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(),
          case when p_kind = 'outlet' then 'outlet.delete_for_good' else 'user.delete_for_good' end,
          case when p_kind = 'outlet' then 'outlets' else 'profiles' end,
          p_id,
          jsonb_build_object('name', label, 'removed', counts, 'files', files));

  return jsonb_build_object('ok', true, 'name', label, 'removed', counts, 'files', files,
                            'auth_fallback', auth_fallback);
end;
$$;

revoke all on function public.delete_for_good(text, uuid, text) from public, anon;
grant execute on function public.delete_for_good(text, uuid, text) to authenticated, service_role;

select 'Delete a store or a person for good (0098) installed' as result;
