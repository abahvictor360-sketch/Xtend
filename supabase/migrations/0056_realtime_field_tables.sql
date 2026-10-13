-- ---------------------------------------------------------------------
-- XTEND: realtime for the field dashboard.
--
-- The phone dashboard used to poll the server every 15s to stay current.
-- Instead it now listens on Supabase realtime and refreshes the moment the
-- member's own data changes: a clock event, a store visit, a reply from the
-- office. Realtime only delivers rows the subscriber may SELECT under RLS,
-- so each member receives their own rows and nothing else.
--
-- attendance and location_alerts are already in the publication (0002); this
-- adds the remaining tables the dashboard and support screens watch. Guarded
-- so it is safe to run more than once.
-- ---------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'store_visits',
    'support_threads',
    'support_messages',
    'notifications',
    'notification_deliveries'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
