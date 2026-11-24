-- =====================================================================
-- XTEND migration 0103 — the public key opens nothing in the database
--
-- Every browser can see two Supabase values in its developer tools: the
-- project address and the public "anon" key. That is how Supabase works,
-- and it is safe only because the database refuses a signed-out visitor.
-- Checked (scripts/check-anon-exposure.sh): every table has row level
-- security, every view uses the caller's rights, and no owner-rights
-- function is open to anon; a signed-out visitor reads nothing.
--
-- Supabase still GRANTS the anon role every new table, view, sequence and
-- function by default, leaving the rules as the only lock. Xtend never
-- reads the database before sign-in (the server uses its own key for
-- that), so this takes those grants away, now and for anything added later:
-- with the public key alone, even a mistake in a future rule exposes
-- nothing. Signed-in people (authenticated) and the server are unchanged.
--
-- Also: rules that let in "anyone signed in" (the store list, products,
-- roles, the X Metrics settings and policy, the count sheet template, and
-- adding one's own movement point) now need an active staff member
-- (is_active_staff). An account that is not Xtend staff (one made through
-- Supabase sign-up, if that was ever left on) or a deactivated one reads
-- none of it.
--
-- Rerunnable.
-- =====================================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

-- For everything created later by the role that runs migrations.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;

-- An active member of staff: the person signed in has a profile and is active.
create or replace function public.is_active_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;

-- Every rule that said only "signed in" now says "active staff".
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (qual ~* '^\(?auth\.uid\(\) IS NOT NULL\)?$' or with_check ~* '^\(?auth\.uid\(\) IS NOT NULL\)?$')
  loop
    if r.qual ~* '^\(?auth\.uid\(\) IS NOT NULL\)?$' then
      execute format('alter policy %I on %I.%I using (public.is_active_staff())', r.policyname, r.schemaname, r.tablename);
    end if;
    if r.with_check ~* '^\(?auth\.uid\(\) IS NOT NULL\)?$' then
      execute format('alter policy %I on %I.%I with check (public.is_active_staff())', r.policyname, r.schemaname, r.tablename);
    end if;
  end loop;
end $$;

-- What's new notes: active staff (admins see withdrawn ones too).
alter policy app_releases_read on public.app_releases
  using ((withdrawn_at is null and public.is_active_staff()) or public.is_admin());

select 'The public key opens nothing (0103) installed' as result;
