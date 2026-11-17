-- =====================================================================
-- XTEND migration 0088 — a report for one store, or for the whole day
--
-- A marketer's daily report was one per day. Now each report is either:
--
--   * 'day'   — the whole day, at most one per person per day (as before);
--   * 'store' — one store they checked in at today, at most one per store
--               visit, tied to that visit (store_visit_id) with the store's
--               name kept on the report (store_label).
--
-- They may file store reports, a whole-day report, or both. Any report
-- filed today counts as "report filed" for the day, as before. Existing
-- reports are whole-day reports.
--
-- Photos and documents go on a named report: add_report_photo(path,
-- report) and add_report_file(path, name, report). The old one-argument
-- forms still work and pick today's whole-day report first.
--
-- Rerunnable.
-- =====================================================================

alter table public.reports add column if not exists scope text not null default 'day';
alter table public.reports add column if not exists store_visit_id uuid;
alter table public.reports add column if not exists store_label text;

alter table public.reports drop constraint if exists reports_scope_ok;
alter table public.reports add constraint reports_scope_ok check (
  (scope = 'day' and store_visit_id is null)
  or (scope = 'store' and store_visit_id is not null)
);

comment on column public.reports.scope is
  'day: the whole day (one per person per day); store: one store visit (0088).';
comment on column public.reports.store_visit_id is
  'For a store report, the store visit it is about (0088). No foreign key: a reset of visits keeps the report.';
comment on column public.reports.store_label is
  'For a store report, the store''s name when it was filed (0088).';

drop index if exists public.reports_one_per_day;
create unique index if not exists reports_one_day_report
  on public.reports (user_id, report_date) where scope = 'day';
create unique index if not exists reports_one_per_visit
  on public.reports (store_visit_id) where scope = 'store';
create index if not exists reports_by_user_date on public.reports (user_id, report_date);

-- ---------------------------------------------------------------------
-- Who, when and which store: the server's, never the phone's.
-- ---------------------------------------------------------------------
create or replace function public.report_enforce()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vis record;
begin
  if tg_op = 'INSERT' then
    if not public.can_file_report() then
      raise exception 'Only marketers file the daily report';
    end if;
    new.user_id     := auth.uid();
    new.report_date := public.business_date();
    new.scope       := coalesce(new.scope, 'day');

    if new.scope = 'store' then
      select d.outlet_id, d.store_label into vis
      from public.store_visit_detail d
      where d.id = new.store_visit_id
        and d.user_id = new.user_id
        and d.visit_date = new.report_date;
      if not found then
        raise exception 'Pick a store you checked in at today';
      end if;
      new.outlet_id   := vis.outlet_id;
      new.store_label := vis.store_label;
    else
      new.scope          := 'day';
      new.store_visit_id := null;
      new.store_label    := null;
      select p.outlet_id into new.outlet_id
      from public.profiles p where p.id = new.user_id;
    end if;
  else
    new.user_id        := old.user_id;
    new.report_date    := old.report_date;
    new.outlet_id      := old.outlet_id;
    new.scope          := old.scope;
    new.store_visit_id := old.store_visit_id;
    new.store_label    := old.store_label;
    if old.report_date <> public.business_date() then
      raise exception 'Reports can only be edited on the day they were filed';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.report_enforce() from public, anon, authenticated;

-- A store report keeps that one visit; a whole-day report the whole day.
create or replace function public.report_visit_snapshot(p_visit uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'store',          d.store_label,
           'outlet_name',    d.outlet_name,
           'address',        coalesce(d.outlet_address, d.arrived_address),
           'arrived_at',     d.arrived_at,
           'departed_at',    d.departed_at,
           'minutes',        d.minutes,
           'status',         d.status,
           'arrived_status', d.arrived_status
         ) order by d.arrived_at), '[]'::jsonb)
  from public.store_visit_detail d
  where d.id = p_visit;
$$;

revoke all on function public.report_visit_snapshot(uuid) from public, anon, authenticated;

create or replace function public.report_capture_visits()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Runs after report_enforce (trigger names sort), so user, date and
  -- scope are the server's own.
  if new.scope = 'store' then
    new.store_visits := public.report_visit_snapshot(new.store_visit_id);
  else
    new.store_visits := public.report_visits_snapshot(new.user_id, new.report_date);
  end if;
  return new;
end;
$$;

revoke all on function public.report_capture_visits() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Photos and documents on a named report of today (0067, 0065 rules).
-- ---------------------------------------------------------------------
create or replace function public.add_report_photo(p_path text, p_report uuid)
returns uuid
language plpgsql security definer set search_path = public, storage as $$
declare
  rep record;
  kind text;
  new_id uuid;
begin
  if not public.can_file_report() then
    raise exception 'Only marketers file the daily report';
  end if;

  -- The report, locked so two tries at once cannot both add the photo.
  -- No report named: today's whole-day report first, else the latest.
  select r.id into rep
  from public.reports r
  where r.user_id = auth.uid() and r.report_date = public.business_date()
    and (p_report is null or r.id = p_report)
  order by (r.scope = 'day') desc, r.updated_at desc
  limit 1
  for update;
  if not found then
    raise exception 'Save today''s report first, then add photos';
  end if;

  -- Sent again after the first try got through: the same answer.
  select p.id into new_id
  from public.report_photos p
  where p.report_id = rep.id and p.storage_path = p_path;
  if found then
    return new_id;
  end if;

  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'That photo is not yours';
  end if;

  select o.metadata->>'mimetype' into kind
  from storage.objects o
  where o.bucket_id = 'reports'
    and o.name = p_path
    and o.created_at >= now() - interval '24 hours';
  if not found then
    raise exception 'Take the photo again, then save the report';
  end if;
  if kind is not null and lower(kind) not like 'image/%' then
    raise exception 'That is not a photo';
  end if;

  if exists (select 1 from public.report_photos p where p.storage_path = p_path) then
    raise exception 'That photo is already on a report';
  end if;

  -- The five-photo limit is the trigger's (report_photo_limit).
  insert into public.report_photos (report_id, storage_path)
  values (rep.id, p_path)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.add_report_photo(text, uuid) from public, anon;
grant execute on function public.add_report_photo(text, uuid) to authenticated, service_role;

create or replace function public.add_report_photo(p_path text)
returns uuid
language sql security definer set search_path = public as $$
  select public.add_report_photo(p_path, null::uuid);
$$;

revoke all on function public.add_report_photo(text) from public, anon;
grant execute on function public.add_report_photo(text) to authenticated, service_role;

create or replace function public.add_report_file(p_path text, p_name text, p_report uuid)
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
    and (p_report is null or r.id = p_report)
  order by (r.scope = 'day') desc, r.updated_at desc
  limit 1
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

revoke all on function public.add_report_file(text, text, uuid) from public, anon;
grant execute on function public.add_report_file(text, text, uuid) to authenticated, service_role;

create or replace function public.add_report_file(p_path text, p_name text)
returns uuid
language sql security definer set search_path = public as $$
  select public.add_report_file(p_path, p_name, null::uuid);
$$;

revoke all on function public.add_report_file(text, text) from public, anon;
grant execute on function public.add_report_file(text, text) to authenticated, service_role;

select 'Reports for one store or the whole day (0088) installed' as result;
