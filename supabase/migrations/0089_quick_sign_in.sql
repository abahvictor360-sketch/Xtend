-- =====================================================================
-- XTEND migration 0089 — sign in with a fingerprint, face or passkey
--
-- Two ways to sign in without typing the password, both optional, both
-- set up by the person after a normal sign-in:
--
--   * 'passkey' — on the website (any browser): the phone's or computer's
--     own fingerprint, face or screen lock (WebAuthn). The server keeps the
--     passkey's public key; the private key never leaves the device.
--   * 'app'     — in the Android and iPhone apps: a long random secret kept
--     in the phone's secure storage, opened only by the fingerprint or
--     face. The server keeps only its SHA-256, and a new secret replaces
--     it at every use.
--
-- The fingerprint or face itself never reaches Xtend. A password reset by
-- the office, a deactivation, or the person changing their password
-- removes every one of their keys. The password always still works.
-- Two-step sign-in (0080) still asks admins and HR for their code.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.sign_in_keys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  kind          text not null check (kind in ('passkey', 'app')),
  label         text not null default '' check (length(label) <= 120),
  -- A passkey: its credential id and public key (base64url), the
  -- authenticator's signature counter and how it can be reached.
  credential_id text unique,
  public_key    text,
  sign_count    bigint not null default 0,
  transports    text[] not null default '{}',
  -- An app key: SHA-256 (hex) of the secret the phone holds now.
  secret_hash   text unique,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  constraint sign_in_keys_shape check (
    (kind = 'passkey' and credential_id is not null and public_key is not null and secret_hash is null)
    or (kind = 'app' and secret_hash is not null and credential_id is null and public_key is null)
  )
);

create index if not exists sign_in_keys_by_user on public.sign_in_keys (user_id);

-- Server only: the routes read and write it with the service role.
alter table public.sign_in_keys enable row level security;
revoke all on public.sign_in_keys from anon, authenticated;

-- ---------------------------------------------------------------------
-- The person's own keys, for "Sign-in with fingerprint or passkey".
-- ---------------------------------------------------------------------
create or replace function public.my_sign_in_keys()
returns table (id uuid, kind text, label text, created_at timestamptz, last_used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select k.id, k.kind, k.label, k.created_at, k.last_used_at
  from public.sign_in_keys k
  where k.user_id = auth.uid()
  order by k.created_at desc;
$$;

create or replace function public.remove_my_sign_in_key(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.sign_in_keys where id = p_id and user_id = auth.uid();
  return found;
end;
$$;

revoke all on function public.my_sign_in_keys() from public, anon;
revoke all on function public.remove_my_sign_in_key(uuid) from public, anon;
grant execute on function public.my_sign_in_keys() to authenticated, service_role;
grant execute on function public.remove_my_sign_in_key(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- A new password from the office, or a deactivation, ends them all.
-- ---------------------------------------------------------------------
create or replace function public.sign_in_keys_clear_on_reset()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.must_change_password and not coalesce(old.must_change_password, false))
     or (old.is_active and not new.is_active) then
    delete from public.sign_in_keys where user_id = new.id;
  end if;
  return null;
end;
$$;

revoke all on function public.sign_in_keys_clear_on_reset() from public, anon, authenticated;

drop trigger if exists trg_profiles_zz_sign_in_keys on public.profiles;
create trigger trg_profiles_zz_sign_in_keys
  after update of must_change_password, is_active on public.profiles
  for each row execute function public.sign_in_keys_clear_on_reset();

-- Test-mode reset (0066): keys go with the staff accounts they belong to
-- (on delete cascade), so nothing to add to the categories.

select 'Sign in with a fingerprint, face or passkey (0089) installed' as result;
