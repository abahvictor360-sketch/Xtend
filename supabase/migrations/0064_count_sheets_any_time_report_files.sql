-- =====================================================================
-- XTEND migration 0064 — count sheets from the profile, report documents
--
-- 1. Stock count sheets any time. Staff who take stock counts can now
--    download this month's Xpel count sheet from their profile (the You
--    page), fill it and send it back whenever they like, not only while a
--    count is due. A sheet is a file for the office to read: its figures
--    are never in the totals, so taking one at any time changes nothing
--    else. While a count is due it still counts towards it, exactly as
--    before. store_count_sheets.count_was_due says which it was.
--
-- 2. Documents on the daily report. Whoever files the daily report
--    (marketers, admins) can attach up to five documents to it: PDF, Word,
--    Excel or CSV, or a picture, each up to 10 MB. They live in the new
--    private bucket report-files under <their id>/..., are listed in
--    report_files, and can be removed while the report can still be
--    edited (the day it was filed, Lagos time). Admins and the person's
--    supervisor read them; nobody else.
-- =====================================================================

do $$
begin
  if to_regclass('public.store_count_sheets') is null then
    raise exception 'Run the paper count sheets update (035) first, then this file';
  end if;
  if to_regprocedure('public.xm_feature_on(text)') is null then
    raise exception 'Run the X Metrics feature switches update (0063) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. COUNT SHEETS ANY TIME
-- ---------------------------------------------------------------------
alter table public.store_count_sheets
  add column if not exists count_was_due boolean not null default true;

create or replace function public.submit_count_sheet(
  p_outlet_id uuid,
  p_path text,
  p_file_name text
) returns uuid
language plpgsql security definer set search_path = public, storage as $$
declare
  status jsonb := public.store_count_status();
  due boolean := coalesce((status->>'open')::boolean, false);
  obj record;
  kind text;
  clean_name text := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[\r\n\t/\\]+', ' ', 'g')), 200);
  new_id uuid;
begin
  -- Only people whose role takes stock counts (046). Whether a count is
  -- due no longer matters: a sheet sent at any other time is kept for the
  -- office, and counts towards nothing.
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;
  if p_outlet_id is null
     or p_outlet_id not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;

  select o.metadata->>'mimetype' as mimetype, (o.metadata->>'size')::bigint as size
    into obj
  from storage.objects o
  where o.bucket_id = 'reports'
    and o.name = p_path
    and p_path like auth.uid()::text || '/%'
    and o.created_at >= now() - interval '30 minutes';
  if not found then
    raise exception 'Upload the filled count sheet again, then send it';
  end if;
  if exists (select 1 from public.store_count_sheets s where s.path = p_path) then
    raise exception 'That file has already been sent';
  end if;

  kind := lower(coalesce(obj.mimetype, ''));
  if kind not in ('application/pdf', 'image/jpeg', 'image/png',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'Send the count sheet as the Excel file, a PDF, or a photo of it (JPG or PNG)';
  end if;
  if coalesce(obj.size, 0) <= 0 or obj.size > 10 * 1024 * 1024 then
    raise exception 'The count sheet must be smaller than 10 MB';
  end if;

  insert into public.store_count_sheets
    (user_id, outlet_id, count_date, request_id, path, file_name, content_type, size_bytes, count_was_due)
  values
    (auth.uid(), p_outlet_id, public.business_date(),
     case when due then nullif(status->>'request_id', '')::uuid end, p_path,
     coalesce(nullif(clean_name, ''), 'Count sheet'), kind, obj.size, due)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.submit_count_sheet(uuid, text, text) from public, anon;
grant execute on function public.submit_count_sheet(uuid, text, text) to authenticated, service_role;

-- The read model gains whether a count was due (new column last).
create or replace view public.store_count_sheet_detail
with (security_invoker = true) as
  select s.id, s.user_id, p.full_name as staff_name, s.outlet_id, o.name as outlet_name,
         s.count_date, s.request_id, s.path, s.file_name, s.content_type, s.size_bytes,
         s.created_at, s.count_was_due
  from public.store_count_sheets s
  join public.profiles p on p.id = s.user_id
  join public.outlets o on o.id = s.outlet_id;

grant select on public.store_count_sheet_detail to authenticated;

-- ---------------------------------------------------------------------
-- 2. DOCUMENTS ON THE DAILY REPORT
-- ---------------------------------------------------------------------

-- What may be attached, by the type storage recorded for the file.
create or replace function public.report_file_mime_ok(p_mime text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_mime, '')) in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  );
$$;
grant execute on function public.report_file_mime_ok(text) to authenticated, service_role;

create table if not exists public.report_files (
  id          uuid primary key default gen_random_uuid(),
  report_id   uuid not null references public.reports(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete restrict,
  path        text not null unique,
  name        text not null check (length(name) between 1 and 200),
  mime        text not null check (public.report_file_mime_ok(mime)),
  size_bytes  bigint not null check (size_bytes between 1 and 10485760),
  created_at  timestamptz not null default now()
);

create index if not exists report_files_by_report on public.report_files (report_id, created_at);
create index if not exists report_files_by_user on public.report_files (user_id, created_at desc);

alter table public.report_files enable row level security;

drop policy if exists report_files_select on public.report_files;
create policy report_files_select on public.report_files
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

-- Written through add_report_file() and remove_report_file() only.
revoke insert, update, delete, truncate on public.report_files from anon, authenticated;

-- Five to a report, however the row arrives.
create or replace function public.report_file_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.reports where id = new.report_id for update;
  if (select count(*) from public.report_files where report_id = new.report_id) >= 5 then
    raise exception 'A report can have up to 5 documents. Remove one to add another';
  end if;
  return new;
end;
$$;
revoke all on function public.report_file_limit() from public, anon, authenticated;

drop trigger if exists trg_report_file_limit on public.report_files;
create trigger trg_report_file_limit before insert on public.report_files
  for each row execute function public.report_file_limit();

-- Attach a file just uploaded to the caller's own folder to today's report.
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

  select o.metadata->>'mimetype' as mimetype, (o.metadata->>'size')::bigint as size
    into obj
  from storage.objects o
  where o.bucket_id = 'report-files'
    and o.name = p_path
    and p_path like auth.uid()::text || '/%'
    and o.created_at >= now() - interval '30 minutes';
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

-- Take a document off the caller's own report while it can still be
-- edited. Returns the storage path, which the app then deletes.
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
    raise exception 'That document is not on your report';
  end if;
  if f.report_date <> public.business_date() then
    raise exception 'Documents can only be removed on the day the report was filed';
  end if;
  delete from public.report_files where id = p_id;
  return f.path;
end;
$$;
revoke all on function public.remove_report_file(uuid) from public, anon;
grant execute on function public.remove_report_file(uuid) to authenticated, service_role;

-- READ MODEL: each document with whose report it is and for which day.
create or replace view public.report_file_detail
with (security_invoker = true) as
  select f.id, f.report_id, f.user_id, p.full_name as staff_name, r.report_date,
         f.path, f.name, f.mime, f.size_bytes, f.created_at,
         (r.report_date = public.business_date()) as editable
  from public.report_files f
  join public.reports r on r.id = f.report_id
  join public.profiles p on p.id = f.user_id;

grant select on public.report_file_detail to authenticated;

-- ---------------------------------------------------------------------
-- The bucket. Private: files reach the browser only as short-lived links.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('report-files', 'report-files', false)
  on conflict (id) do nothing;

-- Supabase checks size and type on upload as well, where the bucket has
-- those settings (the local test stand-in does not).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $q$update storage.buckets set file_size_limit = 10485760 where id = 'report-files'$q$;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $q$update storage.buckets set allowed_mime_types = array[
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
      where id = 'report-files'$q$;
  end if;
end $$;

-- Who may read a document in the bucket: its owner, an admin, or the
-- owner's supervisor for a file attached to a report.
create or replace function public.report_file_readable(p_name text)
returns boolean
language sql stable security definer set search_path = public, storage as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (select 1 from public.report_files f
                 where f.path = p_name and public.supervises_user(f.user_id));
$$;
revoke all on function public.report_file_readable(text) from public, anon;
grant execute on function public.report_file_readable(text) to authenticated, service_role;

-- Whether a stored file is on a report (read past RLS: a policy asks).
create or replace function public.report_file_attached(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.report_files f where f.path = p_name);
$$;
revoke all on function public.report_file_attached(text) from public, anon;
grant execute on function public.report_file_attached(text) to authenticated, service_role;

drop policy if exists report_files_insert_own on storage.objects;
create policy report_files_insert_own on storage.objects
  for insert with check (
    bucket_id = 'report-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.can_file_report()
  );

drop policy if exists report_files_read on storage.objects;
create policy report_files_read on storage.objects
  for select using (bucket_id = 'report-files' and public.report_file_readable(name));

-- The owner deletes only files that are not (or no longer) on a report:
-- remove_report_file() takes the row off first, and only on the day.
drop policy if exists report_files_delete_own on storage.objects;
create policy report_files_delete_own on storage.objects
  for delete using (
    bucket_id = 'report-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not public.report_file_attached(name)
  );
-- No update policy: a document is never overwritten in place.

select 'Count sheets any time and report documents (0064) installed' as result;
