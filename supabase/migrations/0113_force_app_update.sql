-- =====================================================================
-- XTEND migration 0113 — After three reminders, the old app must update
--
-- 0082 sends "A new Xtend app is ready", then "Please update Xtend" every
-- two days, three times in all per build. Some people never update. Now,
-- once someone has had all three for a build and a grace time has passed
-- since the third (24 hours unless the office changes it), their old app
-- stops: Xtend shows "Install the new Xtend app" and nothing else until
-- they install it. Installing it clears it at once, since the app reports
-- its build each time it opens.
--
--   * system_settings.force_old_app (default on) and
--     system_settings.force_app_after_hours (default 24, 0 to 720);
--   * app_forced_builds: who must be on at least which build (admins read
--     everyone's through RLS on app_update_notices);
--   * my_required_app_builds(): the signed-in person's own;
--   * set_force_app_update(on, hours): admins only, audited.
--
-- Rerunnable.
-- =====================================================================

alter table public.system_settings add column if not exists force_old_app boolean not null default true;
alter table public.system_settings add column if not exists force_app_after_hours integer not null default 24;
alter table public.system_settings drop constraint if exists system_settings_force_app_after_hours_check;
alter table public.system_settings add constraint system_settings_force_app_after_hours_check
  check (force_app_after_hours between 0 and 720);
comment on column public.system_settings.force_old_app is
  'On: after the third "Please update Xtend" (0082) and the grace time, the old app must be replaced (0113).';
comment on column public.system_settings.force_app_after_hours is
  'Hours after the third update reminder before the old app stops (0113).';

-- The number of reminders before the app is forced: the same three as 0082.
create or replace function public.app_update_reminders()
returns integer language sql immutable as $$ select 3 $$;

-- Who must be on at least which build: told all three times about a build,
-- and the grace time is over. While the switch is off, nobody.
create or replace view public.app_forced_builds
with (security_invoker = true) as
  select n.user_id, n.platform, max(n.build) as build, min(n.last_at) as last_reminded_at
  from public.app_update_notices n
  cross join public.system_settings s
  where s.id
    and s.force_old_app
    and n.times >= public.app_update_reminders()
    and n.last_at <= now() - make_interval(hours => s.force_app_after_hours)
  group by n.user_id, n.platform;
grant select on public.app_forced_builds to authenticated;

-- The signed-in person's own lowest builds (null: none forced).
create or replace function public.my_required_app_builds()
returns table (android integer, ios integer)
language sql stable security definer set search_path = public as $$
  select max(f.build) filter (where f.platform = 'android'),
         max(f.build) filter (where f.platform = 'ios')
  from public.app_forced_builds f
  where f.user_id = auth.uid();
$$;
revoke all on function public.my_required_app_builds() from public, anon;
grant execute on function public.my_required_app_builds() to authenticated;

-- The office switches it on or off and sets the grace time.
create or replace function public.set_force_app_update(p_on boolean, p_hours integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change this';
  end if;
  if p_on is null or p_hours is null or p_hours < 0 or p_hours > 720 then
    raise exception 'Give the hours as a number from 0 to 720';
  end if;
  update public.system_settings
     set force_old_app = p_on, force_app_after_hours = p_hours, updated_at = now()
   where id;
end;
$$;
revoke all on function public.set_force_app_update(boolean, integer) from public, anon;
grant execute on function public.set_force_app_update(boolean, integer) to authenticated;

select 'Forced app update (0113) installed' as result;
