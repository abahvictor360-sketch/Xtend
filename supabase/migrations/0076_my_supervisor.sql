-- =====================================================================
-- 0076  Who a staff member is messaging
--
-- The Messages page (0073) shows the supervisor at the top so staff see who
-- they are writing to. Staff cannot read the office's profiles, so this
-- SECURITY DEFINER function returns just their own supervisor's name and
-- photo (nothing else), the same way my_supervisor_name() already does.
-- =====================================================================

create or replace function public.my_supervisor()
returns table (id uuid, full_name text, avatar_path text)
language sql stable security definer set search_path = public as $$
  select s.id, s.full_name, s.avatar_path
  from public.profiles me
  join public.profiles s on s.id = me.supervisor_id and s.is_active
  where me.id = auth.uid();
$$;
revoke all on function public.my_supervisor() from public, anon;
grant execute on function public.my_supervisor() to authenticated;

select 'my_supervisor (0076) installed' as result;
