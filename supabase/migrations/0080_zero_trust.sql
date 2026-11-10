-- =====================================================================
-- XTEND migration 0080 — zero trust: verify the person, not the network
--
--   * Two-step sign-in (a 6-digit code from an authenticator app) for the
--     roles in system_settings.mfa_roles, admins and HR to begin with.
--     is_admin() and is_hr() only count a session that passed the code
--     step (Supabase's 'aal2'), so a stolen password, or a stolen session
--     from before the code, gets no admin or HR power in the database even
--     if the app were bypassed. They also stop counting a deactivated
--     account at once, before its login runs out.
--   * Risky actions need the password (and code) confirmed in the last 10
--     minutes: recent_auth, written only by the server after it checked
--     them (confirm_recent_auth), read by recent_auth_ok.
--   * New-device sign-ins of office accounts are noticed:
--     sign_in_device_status says whether this device is known to the
--     account and whether the account has any known device yet.
--
-- Turning two-step sign-in off for a role (for example while an admin who
-- lost their phone is helped), in the SQL editor:
--   update public.system_settings set mfa_roles = '{hr}';
-- Back on:
--   update public.system_settings set mfa_roles = '{admin,hr}';
-- =====================================================================

alter table public.system_settings
  add column if not exists mfa_roles public.user_role[] not null default '{admin,hr}';

-- The session's assurance level: 'aal2' after the code step, else 'aal1'.
-- A request with no claims at all (the SQL editor, a job) counts as aal1.
create or replace function public.session_aal()
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1');
$$;

-- Whether a role must use two-step sign-in.
create or replace function public.mfa_required_for(p_role public.user_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p_role = any(mfa_roles) from public.system_settings where id), false);
$$;

-- The signed-in person has done what their role needs: the code step, or
-- their role does not need it.
create or replace function public.mfa_satisfied()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.session_aal() = 'aal2'
      or not coalesce((select public.mfa_required_for(role) from public.profiles where id = auth.uid()), false);
$$;

-- For the app: whether the signed-in person's role needs two-step sign-in.
create or replace function public.my_mfa_required()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public.mfa_required_for(role) from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.session_aal() from public, anon;
revoke all on function public.mfa_required_for(public.user_role) from public, anon;
revoke all on function public.mfa_satisfied() from public, anon;
revoke all on function public.my_mfa_required() from public, anon;
grant execute on function public.session_aal() to authenticated, service_role;
grant execute on function public.mfa_required_for(public.user_role) to authenticated, service_role;
grant execute on function public.mfa_satisfied() to authenticated, service_role;
grant execute on function public.my_mfa_required() to authenticated, service_role;

-- Admin and HR power only for an active account that passed the code step.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'admin'::public.user_role and is_active from public.profiles where id = auth.uid()),
    false) and public.mfa_satisfied();
$$;

create or replace function public.is_hr()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'hr'::public.user_role and is_active from public.profiles where id = auth.uid()),
    false) and public.mfa_satisfied();
$$;

-- ---------------------------------------------------------------------
-- Re-confirming before a risky action.
-- ---------------------------------------------------------------------
create table if not exists public.recent_auth (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  confirmed_at timestamptz not null default now()
);
alter table public.recent_auth enable row level security;
revoke all on public.recent_auth from anon, authenticated;

-- The server calls this only after it checked the password (and code).
create or replace function public.confirm_recent_auth(p_user uuid)
returns void
language sql security definer set search_path = public as $$
  insert into public.recent_auth (user_id, confirmed_at) values (p_user, now())
  on conflict (user_id) do update set confirmed_at = excluded.confirmed_at;
$$;

create or replace function public.recent_auth_ok(p_user uuid, p_minutes integer default 10)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.recent_auth
                 where user_id = p_user
                   and confirmed_at > now() - make_interval(mins => greatest(1, least(p_minutes, 60))));
$$;

revoke all on function public.confirm_recent_auth(uuid) from public, anon, authenticated;
revoke all on function public.recent_auth_ok(uuid, integer) from public, anon, authenticated;
grant execute on function public.confirm_recent_auth(uuid) to service_role;
grant execute on function public.recent_auth_ok(uuid, integer) to service_role;

-- ---------------------------------------------------------------------
-- New devices: asked just before a successful sign-in records the device.
-- ---------------------------------------------------------------------
create or replace function public.sign_in_device_status(p_account text, p_device text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'known', public.sign_in_known_device(p_account, p_device),
    'any_known', exists (select 1 from public.sign_in_trusted_devices where account = lower(btrim(p_account))));
$$;
revoke all on function public.sign_in_device_status(text, text) from public, anon, authenticated;
grant execute on function public.sign_in_device_status(text, text) to service_role;

-- Test-mode reset (0066): recent confirmations go with the staff accounts
-- they belong to (on delete cascade), so nothing to add to the categories.

select 'Zero trust (0080) installed' as result;
