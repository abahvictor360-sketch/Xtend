# Working on Xtend

Read `docs/BUILD_GUIDE.md` first: it explains how Xtend is built, the rules
it follows, every migration, setup, and the checks to run.

## Always update the build guide

Every change that adds or changes a feature, migration, environment variable,
scheduled job, page, check script or setup step must update
`docs/BUILD_GUIDE.md` in the same commit or PR:

- add a row to section 14 (Change log): date, what changed, migration;
- update the section it touches (5 stages, 6 migrations, 7 variables,
  8 jobs, 9 phone apps, 10 checks, 11 folders, 15 open items);
- change the "Last updated" line at the top.

Keep the rebuild pack (`docs/rebuild/`, which lets any AI rebuild Xtend from
scratch) current in the same commit too:

- update the hand-written spec the change touches (`10-field-app.md`,
  `20-admin-dashboard.md`, `30-rules.md`, `40-platform-and-design.md`, and
  `00-START-HERE.md` if the build order or a decision changes);
- regenerate the exact parts (database, routes, pages, modules, constants):
  `PGURL=postgres://postgres@localhost:5433/postgres npx tsx --tsconfig tsconfig.scripts.json scripts/rebuild-pack.ts`.

A new migration also goes in the README's migration list. Anything people see
goes in the right guide: staff (`src/components/staff-guide.tsx`),
supervisors (`src/app/admin/supervisor-guide/page.tsx`) or admins
(`src/app/admin/guide/page.tsx`).

## Rules that are easy to break

- Business logic in Postgres (triggers, `SECURITY DEFINER` functions); route
  handlers stay thin; React only displays.
- Reads users see go through `createServerSupabase()` so RLS applies.
  Supervisors only ever see their own team.
- Every admin or supervisor change is audited (`audit()` in `src/lib/audit.ts`).
- Staff are never told how they are monitored (location, integrity checks,
  alerts, excuses). That belongs in the admin guide only.
- Plain English for Nigerian staff; brand orange palette; Lagos time; works
  at 390 px wide.
- New migration: next number, registered in `scripts/test-sql.sh`, tested in
  `supabase/tests/rules.sql` (and `rls_counts.sql` for new tables).

## Checks before pushing

```bash
npx tsc --noEmit -p .
npx eslint src scripts --quiet
PGURL=postgres://postgres@localhost:5433/postgres bash scripts/test-sql.sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:9 NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy npx next build
```

Plus the logic checks listed in section 10 of the build guide.
