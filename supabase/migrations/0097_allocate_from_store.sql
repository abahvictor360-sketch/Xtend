-- =====================================================================
-- XTEND migration 0097 — allocate staff from a store (Outlets)
--
-- Store allocation sets one person's whole list of stores at a time
-- (set_staff_outlets). From a store on Outlets the office adds or removes
-- one person at that one store, so this changes only that pair and leaves
-- the person's other stores alone (two people working at once never undo
-- each other). The same rules apply: an admin for anyone, a supervisor for
-- their own team's field staff; the store must be active to be added;
-- every change is audited.
--
-- Rerunnable.
-- =====================================================================

create or replace function public.set_store_staff(p_outlet uuid, p_user uuid, p_on boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  changed integer := 0;
begin
  if not public.can_allocate_outlets(p_user) then
    raise exception 'You cannot change that person''s stores';
  end if;

  if coalesce(p_on, false) then
    if not exists (select 1 from public.outlets o where o.id = p_outlet and o.is_active) then
      raise exception 'That store does not exist or is no longer active';
    end if;
    insert into public.staff_outlets (user_id, outlet_id, assigned_by)
    values (p_user, p_outlet, auth.uid())
    on conflict (user_id, outlet_id) do nothing;
    get diagnostics changed = row_count;
  else
    delete from public.staff_outlets where user_id = p_user and outlet_id = p_outlet;
    get diagnostics changed = row_count;
  end if;

  if changed > 0 then
    insert into public.audit_log (actor_id, action, target_table, target_id, meta)
    values (auth.uid(),
            case when p_on then 'staff.allocate_store' else 'staff.unallocate_store' end,
            'staff_outlets', p_user,
            jsonb_build_object('outlet_id', p_outlet, 'from', 'outlets'));
  end if;
  return changed > 0;
end;
$$;

revoke all on function public.set_store_staff(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_store_staff(uuid, uuid, boolean) to authenticated, service_role;

select 'Allocate staff from a store (0097) installed' as result;
