-- =====================================================================
-- XTEND migration 0094 — a report for today, yesterday or another recent day
--
-- Marketers visit many stores and often write their reports in the evening
-- after clocking out, or the next morning before clocking in. A report was
-- always dated today and could be changed only today. Now:
--
--   * the marketer says which day the report is for: today, yesterday or
--     another day, up to report_days_back() (7) days back, never ahead;
--   * a past day needs something to report: a clock-in or a store visit
--     on it ("You did not clock in or visit a store on that day");
--   * a store report must be about a store visit on that same day;
--   * a report, its photos and its documents can be changed for those
--     same 7 days, then it is closed for good;
--   * the report keeps that day's store visits (report_visits_snapshot of
--     the chosen day), and counts as that day's report everywhere.
--
-- The date column loses its default: a phone from before this update
-- sends no date and gets today, worked out here in Lagos time.
--
-- Rerunnable.
-- =====================================================================

create or replace function public.report_days_back()
returns integer language sql immutable as $$ select 7 $$;

grant execute on function public.report_days_back() to authenticated, service_role;

-- Whether a report for this day may be filed or changed now.
create or replace function public.report_day_open(p_day date)
returns boolean language sql stable as $$
  select p_day is not null
     and p_day <= public.business_date()
     and p_day >= public.business_date() - public.report_days_back();
$$;

grant execute on function public.report_day_open(date) to authenticated, service_role;

alter table public.reports alter column report_date drop default;

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
    new.report_date := coalesce(new.report_date, public.business_date());
    new.scope       := coalesce(new.scope, 'day');

    if new.report_date > public.business_date() then
      raise exception 'You cannot write a report for a day that has not come yet';
    end if;
    if not public.report_day_open(new.report_date) then
      raise exception 'Reports can be written for today and up to % days back', public.report_days_back();
    end if;

    if new.scope = 'store' then
      select d.outlet_id, d.store_label into vis
      from public.store_visit_detail d
      where d.id = new.store_visit_id
        and d.user_id = new.user_id
        and d.visit_date = new.report_date;
      if not found then
        raise exception 'Pick a store you checked in at on that day';
      end if;
      new.outlet_id   := vis.outlet_id;
      new.store_label := vis.store_label;
    else
      new.scope          := 'day';
      new.store_visit_id := null;
      new.store_label    := null;
      -- A past day needs something to report on.
      if new.report_date < public.business_date()
         and not exists (select 1 from public.attendance a
                         where a.user_id = new.user_id and a.attendance_date = new.report_date)
         and not exists (select 1 from public.store_visits v
                         where v.user_id = new.user_id and v.visit_date = new.report_date) then
        raise exception 'You did not clock in or visit a store on that day';
      end if;
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
    if not public.report_day_open(old.report_date) then
      raise exception 'This report is closed: reports can be changed for % days', public.report_days_back();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.report_enforce() from public, anon, authenticated;

-- Their own reports can be changed while the day is open.
drop policy if exists reports_update_own_sameday on public.reports;
drop policy if exists reports_update_own_recent on public.reports;
create policy reports_update_own_recent on public.reports
  for update using (
    user_id = auth.uid()
    and public.can_file_report()
    and public.report_day_open(report_date)
  );

-- ---------------------------------------------------------------------
-- Photos and documents on a report of any open day. Named: that report,
-- if its day is open. Not named (older phones): today's, whole day first.
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

  select r.id into rep
  from public.reports r
  where r.user_id = auth.uid()
    and ((p_report is null and r.report_date = public.business_date())
         or (r.id = p_report and public.report_day_open(r.report_date)))
  order by (r.scope = 'day') desc, r.updated_at desc
  limit 1
  for update;
  if not found then
    raise exception 'Save the report first, then add photos';
  end if;

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

  insert into public.report_photos (report_id, storage_path)
  values (rep.id, p_path)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.add_report_photo(text, uuid) from public, anon;
grant execute on function public.add_report_photo(text, uuid) to authenticated, service_role;

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
  where r.user_id = auth.uid()
    and ((p_report is null and r.report_date = public.business_date())
         or (r.id = p_report and public.report_day_open(r.report_date)))
  order by (r.scope = 'day') desc, r.updated_at desc
  limit 1
  for update;
  if not found then
    raise exception 'Save the report first, then attach documents';
  end if;

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
  if not public.report_day_open(f.report_date) then
    raise exception 'This report is closed: documents can be changed for % days', public.report_days_back()
      using hint = 'report_locked';
  end if;
  delete from public.report_files where id = p_id;
  return f.path;
end;
$$;

revoke all on function public.remove_report_file(uuid) from public, anon;
grant execute on function public.remove_report_file(uuid) to authenticated, service_role;

-- Documents read as editable while their report's day is open.
create or replace view public.report_file_detail
with (security_invoker = true) as
  select f.id, f.report_id, f.user_id, p.full_name as staff_name, r.report_date,
         f.path, f.name, f.mime, f.size_bytes, f.created_at,
         public.report_day_open(r.report_date) as editable
  from public.report_files f
  join public.reports r on r.id = f.report_id
  join public.profiles p on p.id = f.user_id;

-- ---------------------------------------------------------------------
-- A marketer's store visits on a recent day, for the report screen.
-- ---------------------------------------------------------------------
create or replace function public.my_visits_on(p_day date)
returns setof public.store_visit_detail
language sql stable security invoker set search_path = public as $$
  select d.*
  from public.store_visit_detail d
  where d.user_id = auth.uid()
    and d.visit_date = p_day
    and public.report_day_open(p_day)
  order by d.arrived_at;
$$;

revoke all on function public.my_visits_on(date) from public, anon;
grant execute on function public.my_visits_on(date) to authenticated, service_role;

select 'Reports for today or a recent day (0094) installed' as result;
