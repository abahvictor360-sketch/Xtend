-- =====================================================================
-- XTEND migration 035 — paper count sheets
--
-- A merchandiser may count on paper: they download the store's count
-- sheet (a PDF Xtend makes), fill it in by hand or on the phone, and
-- upload it. The file is kept with that store's count for admins and
-- supervisors to open. Its figures are not read into Xtend, so they are
-- not in the dashboard totals or the missing-stock checks; an uploaded
-- sheet does count as having counted when a count was asked for.
--
-- The rules are the ones a typed count follows: a count must be due, the
-- store must be one of theirs, and the file must have been uploaded just
-- now into their own folder. What the file is and how big it is are read
-- from storage, not taken from the phone.
-- =====================================================================

do $$
begin
  if to_regclass('public.count_requests') is null then
    raise exception 'Run the store count updates (019 to 022) first, then this file';
  end if;
end $$;

create table if not exists public.store_count_sheets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete restrict,
  outlet_id    uuid not null references public.outlets(id) on delete restrict,
  count_date   date not null,
  request_id   uuid references public.count_requests(id) on delete set null,
  path         text not null unique,
  file_name    text not null check (length(file_name) between 1 and 200),
  content_type text not null,
  size_bytes   bigint not null,
  created_at   timestamptz not null default now()
);

create index if not exists store_count_sheets_by_date on public.store_count_sheets (count_date desc);
create index if not exists store_count_sheets_by_user on public.store_count_sheets (user_id, count_date);
create index if not exists store_count_sheets_by_request on public.store_count_sheets (request_id);

alter table public.store_count_sheets enable row level security;

drop policy if exists store_count_sheets_select on public.store_count_sheets;
create policy store_count_sheets_select on public.store_count_sheets
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

-- Written through submit_count_sheet() only, which is where the rules are.
revoke insert, update, delete, truncate on public.store_count_sheets from anon, authenticated;

create or replace function public.submit_count_sheet(
  p_outlet_id uuid,
  p_path text,
  p_file_name text
) returns uuid
language plpgsql security definer set search_path = public, storage as $$
declare
  status jsonb := public.store_count_status();
  obj record;
  kind text;
  clean_name text := left(btrim(regexp_replace(coalesce(p_file_name, ''), '[\r\n\t/\\]+', ' ', 'g')), 200);
  new_id uuid;
begin
  if not public.can_count_stock() then
    raise exception 'You cannot submit a store count';
  end if;
  if not coalesce((status->>'open')::boolean, false) then
    raise exception 'No store count is due: counts are taken when a supervisor asks, or at the end of the month';
  end if;
  if p_outlet_id is null
     or p_outlet_id not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;

  -- Uploaded into their own folder in the last 30 minutes. (Not
  -- photo_is_fresh(): that also wants a photo check, which a PDF never has.)
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
  if kind not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Send the count sheet as a PDF, or a photo of it (JPG or PNG)';
  end if;
  if coalesce(obj.size, 0) <= 0 or obj.size > 10 * 1024 * 1024 then
    raise exception 'The count sheet must be smaller than 10 MB';
  end if;

  insert into public.store_count_sheets
    (user_id, outlet_id, count_date, request_id, path, file_name, content_type, size_bytes)
  values
    (auth.uid(), p_outlet_id, public.business_date(),
     nullif(status->>'request_id', '')::uuid, p_path,
     coalesce(nullif(clean_name, ''), 'Count sheet'), kind, obj.size)
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.submit_count_sheet(uuid, text, text) from public, anon;
grant execute on function public.submit_count_sheet(uuid, text, text) to authenticated, service_role;

-- READ MODEL: sheets with who sent them and for which store.
create or replace view public.store_count_sheet_detail
with (security_invoker = true) as
  select s.id, s.user_id, p.full_name as staff_name, s.outlet_id, o.name as outlet_name,
         s.count_date, s.request_id, s.path, s.file_name, s.content_type, s.size_bytes,
         s.created_at
  from public.store_count_sheets s
  join public.profiles p on p.id = s.user_id
  join public.outlets o on o.id = s.outlet_id;

grant select on public.store_count_sheet_detail to authenticated;

-- A person asked for a count has counted once they typed one or sent a sheet.
create or replace view public.count_request_progress
with (security_invoker = true) as
  select
    r.id,
    r.requested_by,
    p.full_name as requested_by_name,
    r.due_date,
    r.note,
    r.created_at,
    r.closed_at,
    (r.closed_at is null and r.due_date >= public.business_date()) as is_open,
    (select count(*) from public.count_request_targets t where t.request_id = r.id) as people,
    (select count(distinct x.user_id) from (
       select c.user_id from public.store_counts c where c.request_id = r.id
       union
       select s.user_id from public.store_count_sheets s where s.request_id = r.id
     ) x) as counted,
    coalesce((
      select array_agg(tp.full_name order by tp.full_name)
      from public.count_request_targets t
      join public.profiles tp on tp.id = t.user_id
      where t.request_id = r.id
        and not exists (select 1 from public.store_counts c
                        where c.request_id = r.id and c.user_id = t.user_id)
        and not exists (select 1 from public.store_count_sheets s
                        where s.request_id = r.id and s.user_id = t.user_id)
    ), '{}'::text[]) as waiting_on
  from public.count_requests r
  join public.profiles p on p.id = r.requested_by;

grant select on public.count_request_progress to authenticated;

select 'Paper count sheets (035) installed' as result;
