-- =====================================================================
-- XTEND migration 017 — a supervisor's team, and their own staff page
--
-- Until now "my team" meant "whoever shares my outlet, or is allocated to
-- it". Marketers no longer have either, so a supervisor could end up
-- supervising nobody the moment stores stopped being assigned.
--
-- So reporting becomes what it always was in practice: a person reports
-- to a supervisor. profiles.supervisor_id says so directly, and a
-- supervisor who creates an account is recorded as that person's
-- supervisor, which is the ordinary way the link gets made.
--
-- The two older rules stay, because they still describe merchandisers
-- who genuinely do sit in one shop.
-- =====================================================================

alter table public.profiles
  add column if not exists supervisor_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_by_supervisor on public.profiles (supervisor_id);

-- A supervisor is never their own supervisor, and only a supervisor or an
-- admin can be named as one.
create or replace function public.profiles_supervisor_check()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.supervisor_id is null then
    return new;
  end if;
  if new.supervisor_id = new.id then
    raise exception 'Somebody cannot supervise themselves';
  end if;
  if not exists (
    select 1 from public.profiles s
    where s.id = new.supervisor_id and s.role in ('supervisor'::user_role, 'admin'::user_role)
  ) then
    raise exception 'That person is not a supervisor';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_supervisor_check on public.profiles;
create trigger trg_profiles_supervisor_check
  before insert or update of supervisor_id on public.profiles
  for each row execute function public.profiles_supervisor_check();

-- ---------------------------------------------------------------------
-- Reach: who a supervisor may see and act on.
-- ---------------------------------------------------------------------
create or replace function public.supervises_user(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.profiles me
    join public.profiles them on them.id = target
    where me.id = auth.uid()
      and me.role = 'supervisor'
      and them.id <> me.id
      -- Field staff only, on every branch. Sharing an outlet with an admin
      -- or another supervisor has never meant supervising them, and the
      -- outlet branch used not to say so.
      and public.is_field_role(them.role)
      and (
        -- Reports to them, whatever stores are or are not involved.
        them.supervisor_id = me.id
        -- Or shares their outlet, which is how merchandisers are grouped.
        or (me.outlet_id is not null and them.outlet_id = me.outlet_id)
        or (me.outlet_id is not null
            and exists (select 1 from public.staff_outlets s
                        where s.user_id = them.id and s.outlet_id = me.outlet_id))
      )
  );
$$;

-- ---------------------------------------------------------------------
-- Who may create and edit an account.
--
-- A supervisor creates field staff only, and the people they create
-- report to them. They can never mint another supervisor or an admin,
-- and they can never change somebody's role — that stays with admins,
-- because role is the only field that grants power.
-- ---------------------------------------------------------------------
create or replace function public.can_create_staff(p_role user_role)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.current_user_role() = 'supervisor'::user_role
          and public.is_field_role(p_role));
$$;

revoke all on function public.can_create_staff(user_role) from public, anon;
grant execute on function public.can_create_staff(user_role) to authenticated, service_role;

create or replace function public.can_edit_staff(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.supervises_user(target);
$$;

revoke all on function public.can_edit_staff(uuid) from public, anon;
grant execute on function public.can_edit_staff(uuid) to authenticated, service_role;

-- The staff list a supervisor sees: their own team, and themselves.
create or replace function public.my_staff()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p
  where public.is_admin() or public.supervises_user(p.id) or p.id = auth.uid()
  order by p.full_name;
$$;

revoke all on function public.my_staff() from public, anon;
grant execute on function public.my_staff() to authenticated, service_role;
