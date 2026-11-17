-- =====================================================================
-- XTEND migration 0086 — a forgotten store check-in never blocks the next
--
-- One store at a time (0010): a second open visit is refused. A visit left
-- open overnight was only closed by the nightly job (close_abandoned_visits
-- in /api/cron/purge-selfies). When that job did not run, yesterday's open
-- visit stayed open for good: Home shows only today's visits, so the
-- marketer saw "0 done today" and still got "You are already checked in to
-- a store. Check out of it first." with nothing to check out of.
--
-- Now a new check-in first closes the person's own open visits from an
-- earlier day as abandoned (exactly what the nightly job does). Today's
-- open visit still blocks a second check-in, as before.
--
-- And the app always knows about an open visit: my_open_store_visits()
-- returns the caller's open visit whatever its day, so Home shows it with
-- a Check out button, and a refused check-in hands it back to the phone.
--
-- Rerunnable.
-- =====================================================================

create or replace function public.store_visit_close_stale()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.store_visits
     set status = 'abandoned'
   where user_id = new.user_id
     and status = 'open'
     and visit_date < public.business_date();
  return new;
end;
$$;

revoke all on function public.store_visit_close_stale() from public, anon, authenticated;

-- Named to fire after trg_store_visit_enforce, which sets user_id.
drop trigger if exists trg_store_visit_zz_close_stale on public.store_visits;
create trigger trg_store_visit_zz_close_stale before insert on public.store_visits
  for each row execute function public.store_visit_close_stale();

-- The caller's open visit, whatever day it was opened (at most one).
create or replace function public.my_open_store_visits()
returns setof public.store_visit_detail
language sql stable security definer set search_path = public as $$
  select * from public.store_visit_detail
  where user_id = auth.uid() and status = 'open'
  order by arrived_at desc;
$$;

revoke all on function public.my_open_store_visits() from public, anon;
grant execute on function public.my_open_store_visits() to authenticated, service_role;

-- Anything already stuck is freed now.
update public.store_visits
   set status = 'abandoned'
 where status = 'open' and visit_date < public.business_date();

select 'Forgotten check-ins no longer block (0086) installed' as result;
