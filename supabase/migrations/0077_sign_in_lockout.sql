-- =====================================================================
-- XTEND migration 0077 — account lockout after 5 wrong passwords
--
-- Five wrong passwords in a row (within 15 minutes) lock the account for
-- 15 minutes. While it is locked even the right password is refused. A
-- right password before the fifth try clears the count. Admins, the
-- person's supervisor and HR can unlock it early from Staff, and resetting
-- the password unlocks it too.
--
--   * sign_in_lockouts: one row per sign-in address (lower-case email, or
--     the typed phone number when it matches nobody), so an unknown
--     account locks exactly like a real one and the answer gives nothing
--     away. Rows a day old are cleared as new ones come in.
--   * sign_in_lock_status / sign_in_failed / sign_in_succeeded: service
--     role only; the sign-in route calls them before and after Supabase.
--   * unlock_sign_in(user): the office, for people it may manage. Audited.
--   * locked_accounts(): who is locked now, for the Staff page.
-- =====================================================================

create table if not exists public.sign_in_lockouts (
  lock_key        text primary key,
  failed_count    integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at  timestamptz not null default now(),
  locked_until    timestamptz,
  lock_count      integer not null default 0
);
create index if not exists sign_in_lockouts_last on public.sign_in_lockouts (last_failed_at);

alter table public.sign_in_lockouts enable row level security;
revoke all on public.sign_in_lockouts from anon, authenticated;

-- When the account is locked, until when; null when it may sign in.
create or replace function public.sign_in_lock_status(p_key text)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select locked_until from public.sign_in_lockouts
  where lock_key = lower(btrim(p_key)) and locked_until > now();
$$;

-- One more wrong password. Returns the lock's end when this one locks it.
create or replace function public.sign_in_failed(p_key text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  k text := lower(btrim(coalesce(p_key, '')));
  r public.sign_in_lockouts;
begin
  if k = '' then
    return null;
  end if;
  delete from public.sign_in_lockouts
  where last_failed_at < now() - interval '1 day' and coalesce(locked_until, now()) <= now();

  insert into public.sign_in_lockouts (lock_key) values (k)
  on conflict (lock_key) do nothing;
  select * into r from public.sign_in_lockouts where lock_key = k for update;

  if r.locked_until > now() then
    return r.locked_until;
  end if;
  -- A fresh run of tries after 15 quiet minutes, or after a lock ran out.
  if r.first_failed_at < now() - interval '15 minutes' or r.locked_until is not null then
    r.failed_count := 0;
    r.first_failed_at := now();
    r.locked_until := null;
  end if;
  r.failed_count := r.failed_count + 1;
  if r.failed_count >= 5 then
    r.locked_until := now() + interval '15 minutes';
    r.lock_count := r.lock_count + 1;
  end if;

  update public.sign_in_lockouts
     set failed_count = r.failed_count, first_failed_at = r.first_failed_at,
         last_failed_at = now(), locked_until = r.locked_until, lock_count = r.lock_count
   where lock_key = k;
  return r.locked_until;
end;
$$;

-- The right password: the count starts again.
create or replace function public.sign_in_succeeded(p_key text)
returns void
language sql security definer set search_path = public as $$
  delete from public.sign_in_lockouts where lock_key = lower(btrim(p_key));
$$;

revoke all on function public.sign_in_lock_status(text) from public, anon, authenticated;
revoke all on function public.sign_in_failed(text) from public, anon, authenticated;
revoke all on function public.sign_in_succeeded(text) from public, anon, authenticated;
grant execute on function public.sign_in_lock_status(text) to service_role;
grant execute on function public.sign_in_failed(text) to service_role;
grant execute on function public.sign_in_succeeded(text) to service_role;

-- Who the signed-in office person may unlock: admins anyone, a supervisor
-- their team, HR anyone but admins.
create or replace function public.can_unlock_sign_in(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_user <> auth.uid()
     and (public.is_admin() or public.supervises_user(p_user) or public.hr_sees(p_user));
$$;
revoke all on function public.can_unlock_sign_in(uuid) from public, anon;
grant execute on function public.can_unlock_sign_in(uuid) to authenticated, service_role;

create or replace function public.unlock_sign_in(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  addr text;
  removed integer;
begin
  if not public.can_unlock_sign_in(p_user) then
    raise exception 'You can only unlock your own team';
  end if;
  select lower(email) into addr from public.profiles where id = p_user;
  delete from public.sign_in_lockouts where lock_key = addr;
  get diagnostics removed = row_count;
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'user.unlock', 'profiles', p_user, jsonb_build_object('was_locked', removed > 0));
  return removed > 0;
end;
$$;
revoke all on function public.unlock_sign_in(uuid) from public, anon;
grant execute on function public.unlock_sign_in(uuid) to authenticated;

-- Locked accounts the caller may see, for the Staff page.
create or replace function public.locked_accounts()
returns table (user_id uuid, locked_until timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, l.locked_until
  from public.sign_in_lockouts l
  join public.profiles p on lower(p.email) = l.lock_key
  where l.locked_until > now()
    and (public.is_admin() or public.supervises_user(p.id) or public.hr_sees(p.id));
$$;
revoke all on function public.locked_accounts() from public, anon;
grant execute on function public.locked_accounts() to authenticated;

select 'Sign-in lockout (0077) installed' as result;
