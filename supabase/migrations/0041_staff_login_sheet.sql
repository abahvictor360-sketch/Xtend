-- =====================================================================
-- XTEND migration 041 — the staff login sheet
--
-- Admins download a Word document with every merchandiser's and
-- marketer's login: email, phone and temporary password, plus how to
-- install the app. It is built from the live staff list each time, so a
-- person added later is in the next download.
--
-- A temporary password is shown once when it is made, so to put it in
-- the sheet it is kept here until the person chooses their own password;
-- then it is cleared. Nobody signed in can read this table: only the
-- server (service role) writes it and builds the sheet from it, for an
-- admin.
-- =====================================================================

create table if not exists public.staff_temp_passwords (
  user_id  uuid primary key references public.profiles(id) on delete cascade,
  password text check (password is null or length(password) between 6 and 72),
  set_at   timestamptz not null default now()
);

alter table public.staff_temp_passwords enable row level security;
-- No policies on purpose: only the service role reads or writes it.
revoke all on public.staff_temp_passwords from anon, authenticated;

-- Choosing their own password clears the temporary one.
create or replace function public.clear_temp_password()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.must_change_password is false and old.must_change_password is distinct from false then
    update public.staff_temp_passwords set password = null, set_at = now() where user_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function public.clear_temp_password() from public, anon, authenticated;

create or replace trigger trg_profiles_clear_temp_password
  after update of must_change_password on public.profiles
  for each row execute function public.clear_temp_password();

select 'Staff login sheet (041) installed' as result;
