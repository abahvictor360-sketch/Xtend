-- =====================================================================
-- XTEND migration 042 — roles an admin adds
--
-- Besides the four built-in roles, an admin can add a role with its own
-- name ("Promoter", "Sales rep") that works like one of the field or
-- supervisor roles. What a person can do still comes from that base role
-- (profiles.role), so every rule in the app keeps working; the name is
-- what people see.
--
--   * staff_roles: the name and the base role (merchandiser, marketer or
--     supervisor). Everyone signed in can read them; only admins add,
--     rename or retire one. A retired role stays on the people who have
--     it until they are moved.
--   * profiles.staff_role_id: the added role, if any. Setting it sets
--     profiles.role to its base; changing role to a different base clears
--     it, so the two never disagree.
--   * Nobody changes their own staff_role_id (profiles_self_guard).
-- =====================================================================

create table if not exists public.staff_roles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (
                length(btrim(name)) between 2 and 40
                and name ~ '^[[:alpha:]][[:alpha:][:space:]&/''-]*$'
              ),
  base_role   user_role not null check (base_role in ('merchandiser', 'marketer', 'supervisor')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One role per name, however it is capitalised or spaced, and never the
-- name of a built-in role.
create unique index if not exists staff_roles_name_unique
  on public.staff_roles (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
alter table public.staff_roles add constraint staff_roles_not_built_in check (
  lower(btrim(name)) not in ('merchandiser', 'merchandisers', 'marketer', 'marketers',
                             'supervisor', 'supervisors', 'admin', 'admins', 'administrator')
);

alter table public.staff_roles enable row level security;

create policy staff_roles_read on public.staff_roles
  for select using (auth.uid() is not null);
create policy staff_roles_admin_insert on public.staff_roles
  for insert with check (public.is_admin());
create policy staff_roles_admin_update on public.staff_roles
  for update using (public.is_admin()) with check (public.is_admin());
-- Not deleted: retired with is_active = false, so history keeps its name.
revoke delete, truncate on public.staff_roles from anon, authenticated;

alter table public.profiles add column if not exists staff_role_id uuid
  references public.staff_roles(id) on delete set null;
create index if not exists profiles_by_staff_role on public.profiles (staff_role_id);

-- The base role follows the added role, and a different base clears it.
create or replace function public.profiles_staff_role_sync()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  base user_role;
begin
  if new.staff_role_id is not null then
    if tg_op = 'UPDATE'
       and new.role is distinct from old.role
       and new.staff_role_id is not distinct from old.staff_role_id then
      -- The role was changed on its own: the added role no longer applies.
      new.staff_role_id := null;
    else
      select r.base_role into base from public.staff_roles r where r.id = new.staff_role_id;
      new.role := base;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_staff_role_sync() from public, anon, authenticated;

create or replace trigger trg_profiles_staff_role_sync
  before insert or update of role, staff_role_id on public.profiles
  for each row execute function public.profiles_staff_role_sync();

-- People still cannot change their own role, store, supervisor, active
-- status, exemption (027) or photo (037), and now their added role either.
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
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_self_guard() from public, anon, authenticated;

select 'Roles an admin adds (042) installed' as result;
