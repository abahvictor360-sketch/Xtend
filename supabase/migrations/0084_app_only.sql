-- =====================================================================
-- XTEND migration 0084 — an admin can require someone to use the app
--
-- profiles.app_only: when on for a merchandiser or marketer, they cannot
-- use Xtend in a browser (or an installed web page); they are sent to a
-- page that tells them to download the Xtend app, and sign-in from a
-- browser is refused. The Android and iPhone apps are never affected.
-- Off for everyone to begin with.
--
-- The rule itself is applied by the server (lib/app-only.ts, in the
-- sign-in route and the session guards): the apps announce themselves in
-- their user agent, which is a convenience, not a security signal, so this
-- steers people to the app rather than locking a determined person out.
--
-- Only an admin changes it: a person cannot clear their own flag, the same
-- as the notification excuse (push_exempt, 027). The Staff page reads it
-- through my_staff(), which returns the whole row.
--
-- Rerunnable.
-- =====================================================================

alter table public.profiles
  add column if not exists app_only boolean not null default false;

-- 0042's guard, with app_only added to what a person cannot change about
-- themselves. Admins and the server change it.
create or replace function public.profiles_self_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or new.id <> auth.uid() then
    return new;
  end if;
  new.role          := old.role;
  new.staff_role_id := old.staff_role_id;
  new.outlet_id     := old.outlet_id;
  new.supervisor_id := old.supervisor_id;
  new.is_active     := old.is_active;
  new.push_exempt   := old.push_exempt;
  new.app_only      := old.app_only;
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;

select 'App only (0084) installed' as result;
