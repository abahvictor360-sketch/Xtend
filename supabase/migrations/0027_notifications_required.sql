-- =====================================================================
-- XTEND migration 027 — no clock-in without notifications
--
-- "Check the phone now" (026) only works on a phone that can receive
-- Xtend's notifications, so turning them off was a way to dodge it. Now a
-- merchandiser or marketer cannot clock in unless this account has
-- notifications switched on, on a real phone push service.
--
-- An admin can excuse one person (a phone that genuinely cannot receive
-- them, such as an old iPhone): profiles.push_exempt. Supervisors cannot.
-- Clocking out is never blocked, so nobody is stuck on shift.
-- =====================================================================

do $$
begin
  if to_regclass('public.phone_checks') is null then
    raise exception 'Run the phone evidence update (026, step 8) first, then this file';
  end if;
end $$;

alter table public.profiles add column if not exists push_exempt boolean not null default false;

-- Notifications on, for real: an active subscription on one of the push
-- services phones actually use. An address typed in by hand is not one.
create or replace function public.has_live_push(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.push_subscriptions s
    where s.user_id = p_user and s.is_active
      and s.endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/'
  );
$$;

revoke all on function public.has_live_push(uuid) from public, anon;
grant execute on function public.has_live_push(uuid) to authenticated, service_role;

create or replace function public.attendance_push_check()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me record;
begin
  if auth.uid() is null or new.type::text <> 'opening' then
    return new;
  end if;
  select p.role, p.push_exempt into me from public.profiles p where p.id = auth.uid();
  if public.is_field_role(me.role) and not coalesce(me.push_exempt, false)
     and not public.has_live_push(auth.uid()) then
    raise exception 'Turn on Xtend notifications before clocking in';
  end if;
  return new;
end;
$$;

revoke all on function public.attendance_push_check() from public, anon, authenticated;

drop trigger if exists trg_attendance_push_check on public.attendance;
create trigger trg_attendance_push_check
  before insert on public.attendance
  for each row execute function public.attendance_push_check();

-- People may edit their own profile row (the app clears "must change
-- password" that way), but not the parts that decide what they are held
-- to: their store, supervisor, being active, or this exemption. Admins and
-- the server change those.
create or replace function public.profiles_self_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or new.id <> auth.uid() then
    return new;
  end if;
  new.role          := old.role;
  new.outlet_id     := old.outlet_id;
  new.supervisor_id := old.supervisor_id;
  new.is_active     := old.is_active;
  new.push_exempt   := old.push_exempt;
  return new;
end;
$$;

revoke all on function public.profiles_self_guard() from public, anon, authenticated;

drop trigger if exists trg_profiles_self_guard on public.profiles;
create trigger trg_profiles_self_guard
  before update on public.profiles
  for each row execute function public.profiles_self_guard();

select 'Notifications required (027) installed' as result;
