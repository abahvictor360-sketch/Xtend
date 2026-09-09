#!/usr/bin/env bash
# Applies both migrations to a throwaway Postgres and runs the rule tests.
#
#   PGURL=postgres://postgres@localhost:5432/postgres ./scripts/test-sql.sh
#
# The stub recreates the parts of Supabase (auth, storage, realtime) that a
# plain Postgres does not have. RLS itself is not exercised here: a superuser
# session bypasses it, so policies are verified against the project.
set -euo pipefail

PGURL="${PGURL:-postgres://postgres@localhost:5432/postgres}"
run() { psql "$PGURL" -v ON_ERROR_STOP=1 -q -f "$1"; }

psql "$PGURL" -v ON_ERROR_STOP=1 -q -c \
  "drop schema if exists public cascade;
   create schema public;
   drop schema if exists auth cascade;
   drop schema if exists storage cascade;
   drop publication if exists supabase_realtime;"

run supabase/tests/supabase_stub.sql
run supabase/migrations/0001_init.sql
run supabase/migrations/0002_logic.sql
run supabase/migrations/0003_harden.sql
run supabase/migrations/0004_tracking_coverage.sql
run supabase/migrations/0005_marketer_role.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/tests/rules.sql 2>&1 | grep -E 'NOTICE|ERROR' | sed 's/^psql:[^ ]*: //'
