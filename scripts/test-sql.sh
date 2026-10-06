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
run supabase/migrations/0006_push_notifications.sql
run supabase/migrations/0007_watchers_and_no_show.sql
run supabase/migrations/0008_place_name.sql
run supabase/migrations/0009_live_locations.sql
run supabase/migrations/0010_store_visits.sql
run supabase/migrations/0011_store_allocation.sql
run supabase/migrations/0012_selfie_retention_24h.sql
run supabase/migrations/0013_harden_triggers.sql
run supabase/migrations/0014_check_in_without_picking.sql
run supabase/migrations/0015_store_name_from_map.sql
run supabase/migrations/0016_visits_without_allocation.sql
run supabase/migrations/0017_supervisor_manages_staff.sql
run supabase/migrations/0018_reporting_line_upkeep.sql
run supabase/migrations/0019_store_counts.sql
run supabase/migrations/0020_count_requests.sql
run supabase/migrations/0021_counted_product_names.sql
run supabase/migrations/0022_integrity_checks.sql
run supabase/migrations/0023_photo_checks.sql
run supabase/migrations/0024_known_places.sql
run supabase/migrations/0025_place_safeguards.sql
run supabase/migrations/0026_phone_evidence.sql
run supabase/migrations/0027_notifications_required.sql
run supabase/migrations/0028_movement_trail.sql
run supabase/migrations/0029_offline_positions.sql
run supabase/migrations/0030_vpn_location_integrity.sql
run supabase/migrations/0031_support_messages.sql
run supabase/migrations/0032_native_integrity.sql
run supabase/migrations/0033_native_push.sql
run supabase/migrations/0034_stores_pinned_from_clock_in.sql
run supabase/migrations/0035_store_count_sheets.sql
run supabase/migrations/0036_supervisor_alerts.sql
run supabase/migrations/0037_profile_photos.sql
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/tests/rules.sql 2>&1 | grep -E 'NOTICE|ERROR' | sed 's/^psql:[^ ]*: //'
psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_counts.sql 2>&1 | grep -E 'NOTICE|ERROR|PASSED' | sed 's/^psql:[^ ]*: //'
