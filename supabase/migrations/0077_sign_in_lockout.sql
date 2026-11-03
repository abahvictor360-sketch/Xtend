-- =====================================================================
-- XTEND migration 0077 — sign-in lockout that locks the guesser, not the
-- person
--
-- Wrong passwords lock the phone or computer making them, not the account,
-- so nobody can lock a colleague out just by knowing their phone number.
--
--   * A known device is one that has signed in to that account before. The
--     server gives it a random token in a cookie and keeps only its hash
--     (sign_in_trusted_devices). A cookie the server never handed out, or
--     one from another account's sign-in, does not count, so inventing
--     cookies gets a guesser nothing.
--   * A known device: 5 wrong passwords in a row (within 15 minutes) pause
--     that device for that account for 15 minutes. Nobody else is affected.
--   * Any other device is counted by its internet address: 5 wrong in a
--     row pause that address for that account for 15 minutes.
--   * And across all unknown devices together, 20 wrong passwords within
--     15 minutes pause unknown devices for that account for 15 minutes, so
--     guessing from many addresses goes nowhere. The person's own known
--     phone still signs in.
--   * While paused even the right password is refused there. A right
--     password clears that device's count and makes it known.
--   * Admins, the person's supervisor and HR lift every pause from Staff
--     (audited); resetting the password lifts them too.
--
-- The server calls the sign_in_* functions with the service role; nobody
-- signed in can read or change these tables.
-- =====================================================================

create table if not exists public.sign_in_lockouts (
  lock_key        text primary key,
  account         text not null,
  scope           text not null check (scope in ('device', 'address', 'account')),
  failed_count    integer not null default 0,
  first_failed_at timestamptz not null default now(),
  last_failed_at  timestamptz not null default now(),
  locked_until    timestamptz,
  lock_count      integer not null default 0
);
create index if not exists sign_in_lockouts_account on public.sign_in_lockouts (account);
create index if not exists sign_in_lockouts_last on public.sign_in_lockouts (last_failed_at);

create table if not exists public.sign_in_trusted_devices (
  account      text not null,
  device_hash  text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz not null default now(),
  primary key (account, device_hash)
);

alter table public.sign_in_lockouts enable row level security;
alter table public.sign_in_trusted_devices enable row level security;
revoke all on public.sign_in_lockouts, public.sign_in_trusted_devices from anon, authenticated;

-- Whether this device hash has signed in to this account before.
create or replace function public.sign_in_known_device(p_account text, p_device text)
returns boolean
language sql stable security definer set search_path = public as $$
  select p_device is not null and exists (
    select 1 from public.sign_in_trusted_devices
    where account = lower(btrim(p_account)) and device_hash = p_device);
$$;

-- The row that counts this attempt's wrong passwords.
create or replace function public.sign_in_device_key(p_account text, p_address text, p_device text)
returns text
language sql stable security definer set search_path = public as $$
  select lower(btrim(p_account)) || '#'
         || case when public.sign_in_known_device(p_account, p_device) then 'dev:' || p_device
                 else 'ip:' || coalesce(nullif(btrim(p_address), ''), 'unknown') end;
$$;

-- Until when signing in to this account from here is paused; null if not.
create or replace function public.sign_in_lock_status(p_account text, p_address text, p_device text)
returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(l.locked_until)
  from public.sign_in_lockouts l
  where l.locked_until > now()
    and (l.lock_key = public.sign_in_device_key(p_account, p_address, p_device)
         or (l.lock_key = lower(btrim(p_account)) || '#account'
             and not public.sign_in_known_device(p_account, p_device)));
$$;

-- Count one wrong password on a row; lock it at p_limit.
create or replace function public.sign_in_bump(p_key text, p_account text, p_scope text, p_limit integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.sign_in_lockouts;
begin
  insert into public.sign_in_lockouts (lock_key, account, scope) values (p_key, p_account, p_scope)
  on conflict (lock_key) do nothing;
  select * into r from public.sign_in_lockouts where lock_key = p_key for update;
  if r.locked_until > now() then
    return; -- tries while paused do not extend the pause
  end if;
  -- A fresh run after 15 quiet minutes, or after a pause ran out.
  if r.first_failed_at < now() - interval '15 minutes' or r.locked_until is not null then
    r.failed_count := 0;
    r.first_failed_at := now();
    r.locked_until := null;
  end if;
  r.failed_count := r.failed_count + 1;
  if r.failed_count >= p_limit then
    r.locked_until := now() + interval '15 minutes';
    r.lock_count := r.lock_count + 1;
  end if;
  update public.sign_in_lockouts
     set failed_count = r.failed_count, first_failed_at = r.first_failed_at,
         last_failed_at = now(), locked_until = r.locked_until, lock_count = r.lock_count
   where lock_key = p_key;
end;
$$;

-- One more wrong password. Returns until when signing in from here is now
-- paused, or null.
create or replace function public.sign_in_failed(p_account text, p_address text, p_device text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  acct text := lower(btrim(coalesce(p_account, '')));
  known boolean;
begin
  if acct = '' then
    return null;
  end if;
  delete from public.sign_in_lockouts
  where last_failed_at < now() - interval '1 day' and coalesce(locked_until, now()) <= now();

  known := public.sign_in_known_device(acct, p_device);
  perform public.sign_in_bump(public.sign_in_device_key(acct, p_address, p_device), acct,
                              case when known then 'device' else 'address' end, 5);
  if not known then
    perform public.sign_in_bump(acct || '#account', acct, 'account', 20);
  end if;
  return public.sign_in_lock_status(acct, p_address, p_device);
end;
$$;

-- The right password: this device's count starts again and it becomes
-- known (p_new_device is the hash of the token the server is handing it).
create or replace function public.sign_in_succeeded(p_account text, p_address text, p_device text, p_new_device text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  acct text := lower(btrim(coalesce(p_account, '')));
begin
  delete from public.sign_in_lockouts
  where lock_key in (public.sign_in_device_key(acct, p_address, p_device),
                     acct || '#ip:' || coalesce(nullif(btrim(p_address), ''), 'unknown'));
  if p_new_device is not null then
    insert into public.sign_in_trusted_devices (account, device_hash) values (acct, p_new_device)
    on conflict (account, device_hash) do update set last_ok_at = now();
  end if;
  -- Devices unused for 180 days are forgotten.
  delete from public.sign_in_trusted_devices where last_ok_at < now() - interval '180 days';
end;
$$;

revoke all on function public.sign_in_known_device(text, text) from public, anon, authenticated;
revoke all on function public.sign_in_device_key(text, text, text) from public, anon, authenticated;
revoke all on function public.sign_in_lock_status(text, text, text) from public, anon, authenticated;
revoke all on function public.sign_in_bump(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.sign_in_failed(text, text, text) from public, anon, authenticated;
revoke all on function public.sign_in_succeeded(text, text, text, text) from public, anon, authenticated;
grant execute on function public.sign_in_lock_status(text, text, text) to service_role;
grant execute on function public.sign_in_failed(text, text, text) to service_role;
grant execute on function public.sign_in_succeeded(text, text, text, text) to service_role;

-- Clears every pause on someone's account. The server calls it after a
-- password reset; the office through unlock_sign_in.
create or replace function public.sign_in_clear(p_account text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  removed integer;
begin
  delete from public.sign_in_lockouts where account = lower(btrim(p_account));
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.sign_in_clear(text) from public, anon, authenticated;
grant execute on function public.sign_in_clear(text) to service_role;

-- Who the signed-in office person may unlock: admins anyone, a supervisor
-- their team, HR anyone but admins; never themselves.
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
  was_locked boolean;
  addr text;
begin
  if not public.can_unlock_sign_in(p_user) then
    raise exception 'You can only unlock your own team';
  end if;
  select lower(email) into addr from public.profiles where id = p_user;
  was_locked := exists (select 1 from public.sign_in_lockouts where account = addr and locked_until > now());
  perform public.sign_in_clear(addr);
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'user.unlock', 'profiles', p_user, jsonb_build_object('was_locked', was_locked));
  return was_locked;
end;
$$;
revoke all on function public.unlock_sign_in(uuid) from public, anon;
grant execute on function public.unlock_sign_in(uuid) to authenticated;

-- People with a pause on now, for the Staff page: the latest end, and
-- whether unknown devices are paused for the whole account.
create or replace function public.locked_accounts()
returns table (user_id uuid, locked_until timestamptz, whole_account boolean)
language sql stable security definer set search_path = public as $$
  select p.id, max(l.locked_until), bool_or(l.scope = 'account')
  from public.sign_in_lockouts l
  join public.profiles p on lower(p.email) = l.account
  where l.locked_until > now()
    and (public.is_admin() or public.supervises_user(p.id) or public.hr_sees(p.id))
  group by p.id;
$$;
revoke all on function public.locked_accounts() from public, anon;
grant execute on function public.locked_accounts() to authenticated;

select 'Sign-in lockout (0077) installed' as result;
