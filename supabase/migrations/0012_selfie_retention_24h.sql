-- =====================================================================
-- XTEND migration 012 — clock photos live for 24 hours
--
-- A clock-in selfie exists to answer one question: is this the person who
-- said they were at the door, right now. Once the day has been checked the
-- photograph has done its job, and keeping a face on file for months is a
-- liability rather than a record.
--
-- So both images — the full frame and the thumbnail — go 24 hours after
-- capture, for clock events and store visits alike. The row itself is
-- untouched: time, place, distance and status remain permanently. Only the
-- face goes.
--
-- Storage cannot be emptied from SQL. Supabase guards storage.objects with
-- a trigger that rejects a direct DELETE and tells you to use the Storage
-- API, so the deletion is driven from the server: this migration supplies
-- the list of paths that have expired and the means to forget them, and
-- src/lib/retention-server.ts removes the objects between the two.
--
-- Sweeping runs two ways, because once a night cannot honour a 24-hour
-- promise on its own:
--
--   * the heartbeat sweeps during the working day, throttled by
--     claim_selfie_sweep() to once every few minutes
--   * the nightly cron sweeps outright, for the hours when nobody is
--     using the app
-- =====================================================================

-- After a sweep there is no photo, and the column has to be able to say so.
alter table public.attendance alter column selfie_path drop not null;

-- ---------------------------------------------------------------------
-- When each background job last ran. One row per job.
-- ---------------------------------------------------------------------
create table if not exists public.job_runs (
  job         text primary key,
  last_run_at timestamptz not null default now(),
  last_result jsonb not null default '{}'::jsonb
);

alter table public.job_runs enable row level security;
-- No policy: this is the service role's bookkeeping, not anyone's data.
revoke all on public.job_runs from anon, authenticated;

-- ---------------------------------------------------------------------
-- Everything that has outlived the rule, as a plain list of object names.
-- ---------------------------------------------------------------------
create or replace function public.expired_selfie_paths(p_hours integer default 24)
returns table (path text)
language sql stable security definer set search_path = public as $$
  with cutoff as (select now() - make_interval(hours => greatest(1, p_hours)) as at)
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

-- ---------------------------------------------------------------------
-- Called once the objects are actually gone. Kept separate so a failed
-- delete leaves the paths in place to be retried, rather than orphaning
-- images nothing points at any more.
-- ---------------------------------------------------------------------
create or replace function public.forget_expired_selfies(p_hours integer default 24)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  cutoff timestamptz := now() - make_interval(hours => greatest(1, p_hours));
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

-- ---------------------------------------------------------------------
-- The throttle. The conditional update is the lock: a second caller
-- arriving at the same moment waits, then sees the fresh timestamp and is
-- told no. Ordinary requests can call the sweep freely because of this.
-- ---------------------------------------------------------------------
create or replace function public.claim_selfie_sweep(p_min_minutes integer default 10)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.job_runs (job, last_run_at)
  values ('purge_selfies', '-infinity')
  on conflict (job) do nothing;

  update public.job_runs
  set last_run_at = now()
  where job = 'purge_selfies'
    and last_run_at < now() - make_interval(mins => greatest(1, p_min_minutes));

  return found;
end;
$$;

revoke all on function public.claim_selfie_sweep(integer) from public, anon, authenticated;
grant execute on function public.claim_selfie_sweep(integer) to service_role;

create or replace function public.record_selfie_sweep(p_result jsonb)
returns void
language sql security definer set search_path = public as $$
  update public.job_runs set last_result = p_result where job = 'purge_selfies';
$$;

revoke all on function public.record_selfie_sweep(jsonb) from public, anon, authenticated;
grant execute on function public.record_selfie_sweep(jsonb) to service_role;

-- The 90-day rule it replaces. It deleted from storage.objects directly,
-- which Supabase rejects, so it had never removed an image.
drop function if exists public.purge_old_selfies();

-- ---------------------------------------------------------------------
-- So an admin can see the rule is actually running, rather than take it
-- on trust: when the sweep last ran, what it removed, and how many photos
-- are currently held.
-- ---------------------------------------------------------------------
create or replace function public.selfie_retention_status()
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'last_run_at', (select last_run_at from public.job_runs where job = 'purge_selfies'),
    'last_result', (select last_result from public.job_runs where job = 'purge_selfies'),
    'photos_held', (
      (select count(*) from public.attendance where selfie_path is not null)
      + (select count(*) from public.store_visits where selfie_path is not null)
    ),
    'overdue', (
      (select count(*) from public.attendance
        where selfie_path is not null and created_at < now() - interval '24 hours')
      + (select count(*) from public.store_visits
        where selfie_path is not null and created_at < now() - interval '24 hours')
    )
  ) end;
$$;

revoke all on function public.selfie_retention_status() from public, anon;
grant execute on function public.selfie_retention_status() to authenticated, service_role;
