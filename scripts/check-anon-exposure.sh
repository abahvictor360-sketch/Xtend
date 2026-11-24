#!/usr/bin/env bash
# What can someone do with only the PUBLIC Supabase key (the anon key every
# browser can see in developer tools)? This builds a throwaway copy of the
# database the way Supabase does it, where every new table and function is
# opened to anon by default, applies every migration and the test data,
# then acts as a signed-out visitor:
#   * every table and view must give nothing (refused, or 0 rows);
#   * every table must have row level security on;
#   * every view must use the caller's rights (security_invoker);
#   * every SECURITY DEFINER function anon can call must be on the list of
#     ones meant for signed-out visitors (ALLOWED below).
# Never uses a real key.
#
#   PGURL=postgres://postgres@localhost:5433/postgres bash scripts/check-anon-exposure.sh
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${PGURL:-postgres://postgres@localhost:5432/postgres}"
DB="xtend_anon_check"
psql "$BASE" -q -c "drop database if exists $DB" >/dev/null 2>&1
psql "$BASE" -q -c "create database $DB" >/dev/null || { echo "FAIL: could not create a test database"; exit 1; }
URL="${BASE%/*}/$DB"
run() { psql "$URL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null 2>/tmp/anon-check-err.txt || { echo "FAIL: $1"; cat /tmp/anon-check-err.txt | head -5; exit 1; }; }

run supabase/tests/supabase_stub.sql
# Supabase's defaults: the API roles get everything new in public.
psql "$URL" -v ON_ERROR_STOP=1 -q -c "
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;" >/dev/null
for m in $(grep -oE '^run supabase/migrations/[^ ]+\.sql' scripts/test-sql.sh | awk '{print $2}'); do run "$m"; done
psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/rules.sql >/dev/null 2>&1 || { echo "FAIL: the test data did not load"; exit 1; }

# Functions meant to be called before sign-in (or harmless).
ALLOWED="'is_active_staff','business_date','punctuality_grace_minutes','report_days_back','visit_reminder_minutes','visit_reminder_max','start_store_of'"

fail=0
leaks=$(psql "$URL" -At -q -c "
  create or replace function pg_temp.peek(rel regclass) returns bigint language plpgsql as \$\$
  declare n bigint;
  begin
    execute 'set local role anon';
    perform set_config('request.jwt.claim.sub', '', true);
    execute format('select count(*) from %s', rel) into n;
    return n;
  exception when insufficient_privilege then return 0;
  end \$\$;
  select c.relname || ' (' || pg_temp.peek(c.oid) || ' rows)'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','v','m') and pg_temp.peek(c.oid) > 0
  order by 1;" 2>&1 | grep -v '^CREATE FUNCTION$')
if [ -n "$leaks" ]; then echo "FAIL: a signed-out visitor can read: $leaks"; fail=1; else echo "ok: a signed-out visitor reads nothing from any table or view"; fi

stranger=$(psql "$URL" -At -q -c "
  create or replace function pg_temp.peek_as_stranger(rel regclass) returns bigint language plpgsql as \$\$
  declare n bigint;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', '7e0d1c2b-0000-4000-8000-00000000abcd', true);
    execute format('select count(*) from %s', rel) into n;
    return n;
  exception when others then return 0;
  end \$\$;
  select c.relname || ' (' || pg_temp.peek_as_stranger(c.oid) || ' rows)'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','v','m') and pg_temp.peek_as_stranger(c.oid) > 0
    -- A total over app_releases: always one row, empty for a stranger (checked below).
    and c.relname <> 'app_minimum_builds'
  order by 1;" 2>&1 | grep -v '^CREATE FUNCTION$')
if [ -n "$stranger" ]; then echo "FAIL: a signed-in account with no staff profile can read: $stranger"; fail=1; else echo "ok: a signed-in account that is not Xtend staff reads nothing"; fi

mins=$(psql "$URL" -At -q -c "
  create or replace function pg_temp.mins() returns text language plpgsql as \$\$
  declare t text;
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', '7e0d1c2b-0000-4000-8000-00000000abcd', true);
    select coalesce(android::text, '') || coalesce(ios::text, '') into t from public.app_minimum_builds;
    return t;
  end \$\$;
  select pg_temp.mins();" 2>&1 | grep -v '^CREATE FUNCTION$')
if [ -n "$mins" ]; then echo "FAIL: a stranger reads the lowest app builds: $mins"; fail=1; fi

grants=$(psql "$URL" -At -c "select string_agg(distinct c.relname, ', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','S') and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))")
if [ -n "$grants" ]; then echo "FAIL: the public key still has rights on: $grants"; fail=1; else echo "ok: the public key has no rights on any table, view or sequence (0103)"; fi

norls=$(psql "$URL" -At -c "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")
if [ -n "$norls" ]; then echo "FAIL: tables without row level security: $norls"; fail=1; else echo "ok: every table has row level security on"; fi

noinv=$(psql "$URL" -At -c "select string_agg(c.relname, ', ') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') and not coalesce(c.reloptions::text[] @> array['security_invoker=true'], false) and has_table_privilege('anon', c.oid, 'select')")
if [ -n "$noinv" ]; then echo "FAIL: views anon can open that skip row level security: $noinv"; fail=1; else echo "ok: every view anon can open uses the caller's rights"; fi

fns=$(psql "$URL" -At -c "select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', E'\n' order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and p.proname not in ($ALLOWED)")
if [ -n "$fns" ]; then echo "FAIL: functions a signed-out visitor can run with the owner's rights:"; echo "$fns" | sed 's/^/   /'; fail=1; else echo "ok: no owner-rights function is open to signed-out visitors (beyond the allowed list)"; fi

psql "$BASE" -q -c "drop database if exists $DB" >/dev/null 2>&1
[ $fail -eq 0 ] && echo "ALL ANON EXPOSURE CHECKS PASSED"
exit $fail
