-- =====================================================================
-- XTEND migration 0117 — Problems are recorded where the office can see them
--
-- Until now a fault went only to the server's log, which nobody in the
-- office reads. Now:
--
--   * app_errors: each problem the server, a phone or a scheduled job hit,
--     grouped: the same problem again within a day adds to its count
--     instead of a new row (fingerprint of where, what and the message).
--     Kept 30 days. Admins read it (System → Problems); nobody writes it
--     but record_app_error() (service role);
--   * job_runs (0012) gains last_ok_at, last_error, last_error_at, and
--     record_job_run(job, ok, result, error) marks each run, so a job that
--     stopped running, or keeps failing, shows on System;
--   * error_summary(): problems in the last hour and day, and the jobs, for
--     System and the health check.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.app_errors (
  id          bigint generated always as identity primary key,
  source      text not null check (source in ('server', 'client', 'job')),
  event       text not null check (length(event) between 1 and 80),
  message     text not null default '' check (length(message) <= 500),
  code        text check (code is null or length(code) <= 40),
  path        text check (path is null or length(path) <= 200),
  detail      jsonb not null default '{}'::jsonb,
  fingerprint text not null,
  count       integer not null default 1 check (count >= 1),
  first_at    timestamptz not null default now(),
  last_at     timestamptz not null default now()
);
create index if not exists app_errors_recent on public.app_errors (last_at desc);
create index if not exists app_errors_by_fingerprint on public.app_errors (fingerprint, last_at desc);
alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;
grant select on public.app_errors to authenticated;
drop policy if exists app_errors_admin_read on public.app_errors;
create policy app_errors_admin_read on public.app_errors
  for select to authenticated using (public.is_admin());

-- Records one problem, or adds to the same one seen within a day. Never
-- raises: recording a problem must not cause another.
create or replace function public.record_app_error(
  p_source text, p_event text, p_message text, p_code text default null,
  p_path text default null, p_detail jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  src  text := case when p_source in ('server', 'client', 'job') then p_source else 'server' end;
  ev   text := left(coalesce(nullif(btrim(p_event), ''), 'unknown'), 80);
  msg  text := left(coalesce(p_message, ''), 500);
  fp   text;
begin
  fp := md5(src || '|' || ev || '|' || coalesce(left(p_code, 40), '') || '|' || left(msg, 160) || '|' || coalesce(left(p_path, 200), ''));
  update public.app_errors
     set count = count + 1, last_at = now(),
         detail = coalesce(p_detail, '{}'::jsonb)
   where id = (select e.id from public.app_errors e
               where e.fingerprint = fp and e.last_at > now() - interval '1 day'
               order by e.last_at desc limit 1);
  if not found then
    insert into public.app_errors (source, event, message, code, path, detail, fingerprint)
    values (src, ev, msg, left(p_code, 40), left(p_path, 200), coalesce(p_detail, '{}'::jsonb), fp);
  end if;
  -- Now and then, the old ones go.
  if random() < 0.02 then
    delete from public.app_errors where last_at < now() - interval '30 days';
  end if;
exception when others then
  null;
end;
$$;
revoke all on function public.record_app_error(text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_app_error(text, text, text, text, text, jsonb) to service_role;

-- Each scheduled job's last run.
alter table public.job_runs add column if not exists last_ok_at timestamptz;
alter table public.job_runs add column if not exists last_error text;
alter table public.job_runs add column if not exists last_error_at timestamptz;

create or replace function public.record_job_run(p_job text, p_ok boolean, p_result jsonb default '{}'::jsonb, p_error text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.job_runs as j (job, last_run_at, last_result, last_ok_at, last_error, last_error_at)
  values (left(p_job, 60), now(), coalesce(p_result, '{}'::jsonb),
          case when p_ok then now() end,
          case when p_ok then null else left(p_error, 500) end,
          case when p_ok then null else now() end)
  on conflict (job) do update
    set last_run_at = now(),
        last_result = coalesce(p_result, '{}'::jsonb),
        last_ok_at = case when p_ok then now() else j.last_ok_at end,
        last_error = case when p_ok then j.last_error else left(p_error, 500) end,
        last_error_at = case when p_ok then j.last_error_at else now() end;
exception when others then
  null;
end;
$$;
revoke all on function public.record_job_run(text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.record_job_run(text, boolean, jsonb, text) to service_role;

-- For System (admins) and the health check (service role).
create or replace function public.error_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can see this';
  end if;
  return jsonb_build_object(
    'last_hour', (select coalesce(sum(count), 0) from public.app_errors where last_at > now() - interval '1 hour'),
    'last_day', (select coalesce(sum(count), 0) from public.app_errors where last_at > now() - interval '1 day'),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
               'job', j.job, 'last_run_at', j.last_run_at, 'last_ok_at', j.last_ok_at,
               'last_error', j.last_error, 'last_error_at', j.last_error_at) order by j.job)
             from public.job_runs j), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.error_summary() from public, anon;
grant execute on function public.error_summary() to authenticated, service_role;

select 'Problems recorded (0117) installed' as result;
