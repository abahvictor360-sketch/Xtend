-- =====================================================================
-- XTEND migration 013 — close two gaps the database linter found
--
-- PostgREST publishes every function in `public` as an RPC, trigger
-- functions included. Migration 0003 revoked the ones that existed then;
-- the store-visit triggers added in 0010 were not covered, so they were
-- reachable at /rest/v1/rpc/... Postgres refuses to run a trigger function
-- outside a trigger, so nothing could be done with them, but a callable
-- SECURITY DEFINER function has no business being on the public API.
--
-- is_field_role() is immutable and touches no table, so a mutable
-- search_path cannot be exploited there either. Pinned all the same: the
-- rule is that every function in this schema pins it, and an exception
-- is one more thing to remember.
-- =====================================================================

revoke all on function public.store_visit_enforce() from public, anon, authenticated;
revoke all on function public.store_visit_alert() from public, anon, authenticated;

create or replace function public.is_field_role(r user_role)
returns boolean language sql immutable set search_path = public as $$
  select r in ('merchandiser'::user_role, 'marketer'::user_role);
$$;
