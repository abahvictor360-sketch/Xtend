-- =====================================================================
-- XTEND migration 018 — keep the reporting line honest
--
-- An admin can promote anybody to supervisor or admin, and demote them
-- again. Nothing was tidying up after a demotion: staff carried on
-- pointing at somebody who is no longer a supervisor. The link was inert,
-- because supervises_user() checks the supervisor's current role, but a
-- stale pointer is a trap for the next person reading the table.
--
-- So when somebody stops being a supervisor or an admin, everyone who
-- reported to them is released. They show up as unassigned on the staff
-- page, which is the truth and is visible, rather than quietly attached
-- to a merchandiser.
-- =====================================================================

create or replace function public.release_reports_on_demotion()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role in ('supervisor'::user_role, 'admin'::user_role)
     and new.role not in ('supervisor'::user_role, 'admin'::user_role) then
    update public.profiles
    set supervisor_id = null
    where supervisor_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_reports_on_demotion on public.profiles;
create trigger trg_release_reports_on_demotion
  after update of role on public.profiles
  for each row execute function public.release_reports_on_demotion();

-- The people an admin may name as somebody's supervisor.
create or replace function public.available_supervisors()
returns table (id uuid, full_name text, role user_role, outlet_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.outlet_id
  from public.profiles p
  where public.is_admin()
    and p.is_active
    and p.role in ('supervisor'::user_role, 'admin'::user_role)
  order by p.full_name;
$$;

revoke all on function public.available_supervisors() from public, anon;
grant execute on function public.available_supervisors() to authenticated, service_role;
