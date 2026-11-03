-- =====================================================================
-- XTEND migration 0078 — nobody signed out runs the database's own helpers
--
-- Supabase's security advisor found SECURITY DEFINER functions that the
-- anonymous role could call through /rest/v1/rpc:
--
--   * trigger and event-trigger functions (they only make sense fired by
--     the database; triggers do not need EXECUTE to fire, so revoking it
--     changes nothing they do);
--   * place_is_recognised(lat, lng), which would let anybody test whether a
--     spot is a known store or place. Only other database functions call
--     it, and they run as its owner.
--
-- Rerunnable: it revokes from whatever trigger functions exist when it runs.
-- =====================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.fn);
  end loop;
end $$;

revoke execute on function public.place_is_recognised(double precision, double precision) from public, anon, authenticated;

select 'Function grants (0078) installed' as result;
