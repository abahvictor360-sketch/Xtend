-- =====================================================================
-- XTEND migration 0065 — report documents that survive a bad connection
--
-- 1. Sending a report again does not upload its documents again. Each
--    picked document now has its own name on the phone from the moment it
--    is picked, so a retry finds the copy it already sent. Two things in
--    add_report_file() change for that, and nothing else does:
--      - a document already on the caller's own report for today is
--        answered with its id instead of an error (the first try got
--        through, its answer did not);
--      - a document may be attached up to 24 hours after it was uploaded,
--        not 30 minutes, so a report kept on the phone for hours still
--        finds the copy it uploaded before the connection dropped. 24
--        hours is also how long the phone keeps a report and when the
--        clean-up below starts.
--    Limits, types, own folder, today's report only: all as in 0064.
--
-- 2. Removing a document can be queued on the phone while offline. The
--    rule is the same (only on the day the report was filed); the refusals
--    now carry a hint the app reads, so it can tell "already gone" (a
--    retry after the first try got through) from "the report closed at
--    midnight" (tell the person, stop trying).
--
-- 3. Clean-up. report_file_orphans() lists the files in report-files that
--    are more than 24 hours old and on no report: uploads whose report
--    never arrived or was never saved, and anything else left behind. The
--    nightly purge job deletes them through the Storage API. Service role
--    only.
-- =====================================================================

do $$
begin
  if to_regclass('public.report_files') is null then
    raise exception 'Run the report documents update (0064) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. ATTACHING, SAFE TO REPEAT
-- ---------------------------------------------------------------------
create or replace function public.add_report_file(p_path text, p_name text)
returns uuid
language plpgsql security definer set search_path = public, storage as $$
declare
  rep record;
  obj record;
  kind text;
  clean_name text := left(btrim(regexp_replace(coalesce(p_name, ''), '[\r\n\t/\\]+', ' ', 'g')), 200);
  new_id uuid;
begin
  if not public.can_file_report() then
    raise exception 'Only marketers file the daily report';
  end if;

  select r.id, r.report_date into rep
  from public.reports r
  where r.user_id = auth.uid() and r.report_date = public.business_date()
  for update;
  if not found then
    raise exception 'Save today''s report first, then attach documents';
  end if;

  -- Sent again after the first try got through: the same answer.
  select f.id into new_id
  from public.report_files f
  where f.path = p_path and f.user_id = auth.uid() and f.report_id = rep.id;
  if found then
    return new_id;
  end if;

  select o.metadata->>'mimetype' as mimetype, (o.metadata->>'size')::bigint as size
    into obj
  from storage.objects o
  where o.bucket_id = 'report-files'
    and o.name = p_path
    and p_path like auth.uid()::text || '/%'
    and o.created_at >= now() - interval '24 hours';
  if not found then
    raise exception 'Upload the document again, then save the report';
  end if;
  if exists (select 1 from public.report_files f where f.path = p_path) then
    raise exception 'That document is already attached';
  end if;

  kind := lower(coalesce(obj.mimetype, ''));
  if not public.report_file_mime_ok(kind) then
    raise exception 'Attach a PDF, Word, Excel or CSV file, or a picture (JPG, PNG)';
  end if;
  if coalesce(obj.size, 0) <= 0 then
    raise exception 'That document is empty';
  end if;
  if obj.size > 10 * 1024 * 1024 then
    raise exception 'Each document must be 10 MB or smaller';
  end if;

  insert into public.report_files (report_id, user_id, path, name, mime, size_bytes)
  values (rep.id, auth.uid(), p_path, coalesce(nullif(clean_name, ''), 'Document'), kind, obj.size)
  returning id into new_id;
  return new_id;
end;
$$;
revoke all on function public.add_report_file(text, text) from public, anon;
grant execute on function public.add_report_file(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. REMOVING, WITH REFUSALS THE PHONE CAN TELL APART
-- ---------------------------------------------------------------------
create or replace function public.remove_report_file(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  f record;
begin
  select rf.id, rf.path, rf.user_id, r.report_date into f
  from public.report_files rf
  join public.reports r on r.id = rf.report_id
  where rf.id = p_id;
  if not found or f.user_id is distinct from auth.uid() then
    raise exception 'That document is not on your report' using hint = 'report_file_gone';
  end if;
  if f.report_date <> public.business_date() then
    raise exception 'Documents can only be removed on the day the report was filed'
      using hint = 'report_locked';
  end if;
  delete from public.report_files where id = p_id;
  return f.path;
end;
$$;
revoke all on function public.remove_report_file(uuid) from public, anon;
grant execute on function public.remove_report_file(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. FILES LEFT BEHIND
-- ---------------------------------------------------------------------
-- Never younger than 24 hours, whatever is asked: a phone may still be
-- about to attach a file it uploaded today.
create or replace function public.report_file_orphans(
  p_hours integer default 24,
  p_limit integer default 1000
) returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'report-files'
    and o.created_at < now() - make_interval(hours => greatest(coalesce(p_hours, 24), 24))
    and not exists (select 1 from public.report_files f where f.path = o.name)
  order by o.created_at
  limit greatest(least(coalesce(p_limit, 1000), 5000), 1);
$$;
revoke all on function public.report_file_orphans(integer, integer) from public, anon, authenticated;
grant execute on function public.report_file_orphans(integer, integer) to service_role;

select 'Report documents offline and clean-up (0065) installed' as result;
