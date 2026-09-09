-- =====================================================================
-- XTEND migration 003 — locking down the RPC surface
--
-- Supabase exposes every function in `public` at /rest/v1/rpc/<name>, so a
-- SECURITY DEFINER function is reachable by anyone holding the anon key
-- unless EXECUTE is revoked. The database linter flagged all 17 of ours.
-- Most are harmless (they check is_admin() internally, or fail outside a
-- trigger), but two were not:
--
--   purge_old_selfies()  — anyone could trigger the 90-day image deletion
--   write_audit(...)     — any signed-in user could forge audit rows
--
-- This migration closes the surface to exactly who needs each function, and
-- pins search_path on the three that were missing it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pin search_path on the stragglers.
-- ---------------------------------------------------------------------
alter function public.distance_metres(double precision, double precision, double precision, double precision)
  set search_path = public;
alter function public.business_date() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- ---------------------------------------------------------------------
-- The audit trail is an admin artefact. Without this guard any signed-in
-- user can POST to /rpc/write_audit and write a row naming themselves as
-- the actor of anything they like.
--
-- resolve_alert() calls this from inside its own SECURITY DEFINER body,
-- after its own admin check, so it is unaffected.
-- ---------------------------------------------------------------------
create or replace function public.write_audit(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), p_action, p_target_table, p_target_id, coalesce(p_meta, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Trigger functions are not an API. They are reachable as RPCs purely
-- because they live in `public`; calling one directly errors, but an
-- endpoint that exists is an endpoint someone probes.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.attendance_enforce()',
    'public.attendance_alert()',
    'public.ping_enforce()',
    'public.ping_alert()',
    'public.report_enforce()',
    'public.report_photo_limit()',
    'public.touch_updated_at()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Retention runs from the Vercel cron route on the service role. Nobody
-- else deletes images.
-- ---------------------------------------------------------------------
revoke all on function public.purge_old_selfies() from public, anon, authenticated;
grant execute on function public.purge_old_selfies() to service_role;

-- ---------------------------------------------------------------------
-- The rest are for signed-in users only. Each already decides internally
-- what the caller may see; anon has no business reaching any of them.
-- ---------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.is_admin()',
    'public.current_user_role()',
    'public.supervises_user(uuid)',
    'public.business_date()',
    'public.my_day()',
    'public.admin_overview()',
    'public.absentees_today()',
    'public.staff_analytics(date, date)',
    'public.log_location_block(text, double precision)',
    'public.resolve_alert(uuid, text)',
    'public.write_audit(text, text, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end $$;

-- distance_metres is pure arithmetic over its arguments and is used inside
-- other functions; leave it callable but keep it out of anon's reach.
revoke all on function public.distance_metres(double precision, double precision, double precision, double precision) from public, anon;
grant execute on function public.distance_metres(double precision, double precision, double precision, double precision) to authenticated, service_role;
