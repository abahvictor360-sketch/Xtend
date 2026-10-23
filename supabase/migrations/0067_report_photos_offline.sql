-- =====================================================================
-- XTEND migration 0067 — report photos that survive a bad connection,
-- and files kept 14 days, announced the day before they go
--
-- 1. Report photos, the same fix 0065 made for report documents. Each
--    photo gets its own id on the phone when it is taken or picked, and is
--    stored in the person's own folder of the "reports" bucket as
--    <user id>/report-photo-<id>.jpg, so a retry finds the copy it already
--    sent. The storage rules do not change: the first folder is still the
--    person's own.
--
--    Photos are now put on the report by add_report_photo() instead of a
--    plain insert from the reports route. A photo already on the caller's
--    own report for today is answered with its row instead of a second
--    row (the first try got through, its answer did not), so a retry with
--    five photos on is never refused by the five-photo limit. A new photo
--    must be in the caller's own folder of "reports", uploaded in the last
--    24 hours (how long a phone keeps a report), and on no other report.
--    Five photos at most (report_photo_limit, 0002), today's report only
--    (edit until midnight): both as before.
--
-- 2. Nothing is deleted automatically before it is 14 days old
--    (retention_days()), and nothing before admins and supervisors were
--    told the day before. Reports, and the photos and documents ON a
--    report, are never deleted automatically at all. What the nightly job
--    deletes:
--      - clock-in and store-visit photos (attendance, store_visits), which
--        0012 deleted after 24 hours;
--      - report documents on no report (report_file_orphans, 0065: was 24
--        hours);
--      - report photos on no report (report_photo_orphans, new): uploads
--        whose report never arrived or was never saved, and the copies
--        older app versions uploaded again on every retry. Only report
--        photo names are listed (<user id>/report-photo-<id>.jpg, and the
--        plain <user id>/<uuid>.jpg earlier versions used); the count,
--        store, X Metrics and place photos that share the bucket carry
--        their own prefix, and anything another record points at is never
--        listed.
--
--    The day before: each night the job announces (retention_announce)
--    what will go on the next night: everything older than 13 days. The
--    listings only ever reach back to the previous announcement made at
--    least 20 hours earlier, and never past 14 days, so nothing goes that
--    was not announced a day before, and with no announcement nothing goes
--    at all. retention_notice_due() says who to tell and how much: every
--    admin everything, each supervisor their own team's; at most one
--    notice a person a day. Staff are never told.
--
--    After deleting, record_retention_purge() keeps the counts on
--    job_runs and writes one audit row (retention.purge).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. THE ONE RULE
-- ---------------------------------------------------------------------
create or replace function public.retention_days()
returns integer
language sql immutable as $$ select 14 $$;
grant execute on function public.retention_days() to authenticated, service_role;

-- The furthest back anything may be deleted right now: the older of
-- 14 days ago and what was announced at least 20 hours ago. Null (nothing
-- may go) until a first announcement is a day old.
create or replace function public.retention_delete_before()
returns timestamptz
language sql stable security definer set search_path = public as $$
  -- least() skips a null, so "nothing announced" is said outright.
  select case when a.through is null then null
              else least(now() - make_interval(days => public.retention_days()), a.through) end
  from (
    select case
      when (j.last_result->>'at')::timestamptz <= now() - interval '20 hours'
        then (j.last_result->>'through')::timestamptz
      when (j.last_result->>'prev_at')::timestamptz <= now() - interval '20 hours'
        then (j.last_result->>'prev_through')::timestamptz
    end as through
    from public.job_runs j
    where j.job = 'retention_notice'
  ) a;
$$;
revoke all on function public.retention_delete_before() from public, anon, authenticated;
grant execute on function public.retention_delete_before() to service_role;

-- The cutoff a listing uses: never younger than 14 days, whatever is
-- asked, and never past what was announced.
create or replace function public.retention_cutoff(p_hours integer)
returns timestamptz
language sql stable security definer set search_path = public as $$
  -- least() skips a null, so "nothing announced" is said outright.
  select case when b is null then null
              else least(now() - make_interval(hours => greatest(coalesce(p_hours, 0), public.retention_days() * 24)), b)
         end
  from (select public.retention_delete_before() as b) x;
$$;
revoke all on function public.retention_cutoff(integer) from public, anon, authenticated;
grant execute on function public.retention_cutoff(integer) to service_role;

-- Tonight's announcement: everything older than 13 days goes on the next
-- night. Run again within 20 hours, it changes nothing and answers the
-- same, so a second run cannot shorten the notice.
create or replace function public.retention_announce()
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  cur jsonb;
  through timestamptz := now() - make_interval(days => public.retention_days() - 1);
begin
  insert into public.job_runs (job, last_run_at, last_result)
  values ('retention_notice', '-infinity', '{}'::jsonb)
  on conflict (job) do nothing;

  select last_result into cur from public.job_runs where job = 'retention_notice' for update;
  if (cur->>'at')::timestamptz > now() - interval '20 hours' then
    return (cur->>'through')::timestamptz;
  end if;

  update public.job_runs
  set last_run_at = now(),
      last_result = jsonb_build_object(
        'at', now(), 'through', through,
        'prev_at', cur->'at', 'prev_through', cur->'through')
  where job = 'retention_notice';
  return through;
end;
$$;
revoke all on function public.retention_announce() from public, anon, authenticated;
grant execute on function public.retention_announce() to service_role;

-- ---------------------------------------------------------------------
-- 1. PUTTING A PHOTO ON TODAY'S REPORT, SAFE TO REPEAT
-- ---------------------------------------------------------------------
-- Finding a photo by its path: the retry check and the clean-up.
create index if not exists report_photos_storage_path on public.report_photos (storage_path);

create or replace function public.add_report_photo(p_path text)
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

  -- Today's report, locked so two tries at once cannot both add the photo.
  select r.id into rep
  from public.reports r
  where r.user_id = auth.uid() and r.report_date = public.business_date()
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
revoke all on function public.add_report_photo(text) from public, anon;
grant execute on function public.add_report_photo(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. WHAT MAY GO, BEFORE A GIVEN TIME
-- ---------------------------------------------------------------------
-- Report photos on no report. Internal: the listings below decide when.
create or replace function public.report_photo_orphans_before(p_before timestamptz)
returns table (path text, created_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'reports'
    and o.name ~ '^[0-9a-f-]{36}/(report-photo-[A-Za-z0-9-]{1,64}|[0-9a-f-]{36})\.jpg$'
    and o.created_at < p_before
    and not exists (select 1 from public.report_photos p where p.storage_path = o.name)
    -- Belt and braces: nothing another record points at, whatever its name.
    and not exists (select 1 from public.store_counts c where c.photo_path = o.name)
    and not exists (select 1 from public.known_places k where o.name in (k.photo_path, k.selfie_path))
    and not exists (select 1 from public.xm_counts x where x.photo_path = o.name)
    and not exists (select 1 from public.xm_sales x where x.photo_path = o.name)
    and not exists (select 1 from public.store_count_sheets s where s.path = o.name)
    and not exists (select 1 from public.count_sheet_templates t where t.path = o.name);
$$;
revoke all on function public.report_photo_orphans_before(timestamptz) from public, anon, authenticated;
grant execute on function public.report_photo_orphans_before(timestamptz) to service_role;

-- Report documents on no report (0065's rule, with the time given).
create or replace function public.report_file_orphans_before(p_before timestamptz)
returns table (path text, created_at timestamptz)
language sql stable security definer set search_path = public, storage as $$
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'report-files'
    and o.created_at < p_before
    and not exists (select 1 from public.report_files f where f.path = o.name);
$$;
revoke all on function public.report_file_orphans_before(timestamptz) from public, anon, authenticated;
grant execute on function public.report_file_orphans_before(timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 3. THE LISTINGS THE NIGHTLY JOB DELETES FROM (14 days, announced)
-- ---------------------------------------------------------------------
create or replace function public.report_photo_orphans(
  p_hours integer default 336,
  p_limit integer default 1000
) returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  select o.path
  from public.report_photo_orphans_before(public.retention_cutoff(p_hours)) o
  order by o.created_at
  limit greatest(least(coalesce(p_limit, 1000), 5000), 1);
$$;
revoke all on function public.report_photo_orphans(integer, integer) from public, anon, authenticated;
grant execute on function public.report_photo_orphans(integer, integer) to service_role;

create or replace function public.report_file_orphans(
  p_hours integer default 336,
  p_limit integer default 1000
) returns table (path text)
language sql stable security definer set search_path = public, storage as $$
  select o.path
  from public.report_file_orphans_before(public.retention_cutoff(p_hours)) o
  order by o.created_at
  limit greatest(least(coalesce(p_limit, 1000), 5000), 1);
$$;
revoke all on function public.report_file_orphans(integer, integer) from public, anon, authenticated;
grant execute on function public.report_file_orphans(integer, integer) to service_role;

-- Clock-in and store-visit photos (0012), now 14 days and announced.
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
  where v.created_at < c.at and (v.selfie_path is not null or v.thumb_path is not null);
$$;
revoke all on function public.expired_selfie_paths(integer) from public, anon, authenticated;
grant execute on function public.expired_selfie_paths(integer) to service_role;

-- Forgets exactly the paths whose files were removed, so a row is never
-- cleared for a photo the job did not delete.
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
      thumb_path  = case when thumb_path  = any(p_paths) then null else thumb_path end
  where selfie_path = any(p_paths) or thumb_path = any(p_paths);
  get diagnostics v = row_count;
  return a + v;
end;
$$;
revoke all on function public.forget_selfie_paths(text[]) from public, anon, authenticated;
grant execute on function public.forget_selfie_paths(text[]) to service_role;

-- 0012's bulk forget, kept for callers that still use it, on the same rule.
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
  set selfie_path = null, thumb_path = null
  where created_at < cutoff and (selfie_path is not null or thumb_path is not null);
  get diagnostics v = row_count;
  return a + v;
end;
$$;
revoke all on function public.forget_expired_selfies(integer) from public, anon, authenticated;
grant execute on function public.forget_expired_selfies(integer) to service_role;

-- The admin footnote: held, and overdue (past 14 days and a night).
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
    ),
    'overdue', (
      (select count(*) from public.attendance
        where selfie_path is not null
          and created_at < now() - make_interval(days => public.retention_days() + 1))
      + (select count(*) from public.store_visits
        where selfie_path is not null
          and created_at < now() - make_interval(days => public.retention_days() + 1))
    )
  ) end;
$$;
revoke all on function public.selfie_retention_status() from public, anon;
grant execute on function public.selfie_retention_status() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. WHO TO TELL, THE DAY BEFORE
-- ---------------------------------------------------------------------
-- supervises_user() for a named supervisor rather than the caller.
create or replace function public.supervisor_covers(p_supervisor uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles them on them.id = p_user
    where me.id = p_supervisor
      and me.role = 'supervisor'
      and them.id <> me.id
      and public.is_field_role(them.role)
      and (
        them.supervisor_id = me.id
        or (me.outlet_id is not null and them.outlet_id = me.outlet_id)
        or (me.outlet_id is not null
            and exists (select 1 from public.staff_outlets s
                        where s.user_id = them.id and s.outlet_id = me.outlet_id))
      )
  );
$$;
revoke all on function public.supervisor_covers(uuid, uuid) from public, anon, authenticated;
grant execute on function public.supervisor_covers(uuid, uuid) to service_role;

-- What goes on the next night, by whom to tell: every active admin all of
-- it, each active supervisor their own team's. Only people with something
-- due who have not had a notice today (Lagos). Service role only.
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

-- ---------------------------------------------------------------------
-- 5. WHAT WAS DELETED
-- ---------------------------------------------------------------------
-- Kept on job_runs for the admin footnote, and one audit row when
-- anything was deleted or failed. Service role only.
create or replace function public.record_retention_purge(p_result jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  k text;
  any_work boolean := false;
begin
  insert into public.job_runs (job, last_run_at, last_result)
  values ('retention_purge', now(), coalesce(p_result, '{}'::jsonb))
  on conflict (job) do update set last_run_at = now(), last_result = excluded.last_result;

  for k in select jsonb_object_keys(coalesce(p_result, '{}'::jsonb)) loop
    if jsonb_typeof(p_result->k) = 'number' and (p_result->>k)::numeric > 0 then
      any_work := true;
    end if;
  end loop;
  if any_work then
    insert into public.audit_log (actor_id, action, target_table, target_id, meta)
    values (null, 'retention.purge', null, null, p_result);
  end if;
end;
$$;
revoke all on function public.record_retention_purge(jsonb) from public, anon, authenticated;
grant execute on function public.record_retention_purge(jsonb) to service_role;

select 'Report photos offline, 14-day retention with notice (0067) installed' as result;
