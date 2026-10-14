-- ---------------------------------------------------------------------
-- XTEND: realtime via broadcast-from-trigger (scale fix).
--
-- The field dashboard used Postgres Changes: every row change was re-checked
-- against every subscriber's RLS, which is the most expensive realtime mode
-- and caps how many field staff can be connected at once. This replaces it
-- with Broadcast: a trigger on each watched table sends one lightweight event
-- to that member's own private topic, `field:<user_id>`. The realtime server
-- no longer runs RLS per subscriber per change, so the same compute holds far
-- more connections — the ceiling that matters at ~5,000 staff on shift.
--
-- The event carries only { table, op } — never row data. The client treats it
-- as "something of yours changed, re-fetch", and the re-fetch goes through
-- RLS server-side as before, so no data is exposed through the socket.
--
-- Who may receive a topic is enforced by RLS on realtime.messages: a member
-- may only read `field:<their own uid>`. The triggers themselves run
-- SECURITY DEFINER and send on the owner's behalf.
--
-- scripts/test-sql.sh runs this against a minimal realtime stub (realtime.send
-- records each broadcast in realtime.messages, realtime.topic() reads the
-- subscriber's topic), so the tests check that a change is announced only on
-- its owner's topic. In production these are Supabase's own realtime functions.
-- ---------------------------------------------------------------------

-- The owner topic for a member. Kept as one function so the client and the
-- policy below agree on the shape `field:<uuid>`.
create or replace function public.field_topic(uid uuid)
returns text
language sql
immutable
as $$ select 'field:' || uid::text $$;

-- Tables that carry the owner directly in user_id: attendance, store_visits,
-- support_threads, notification_deliveries. One AFTER-row trigger function
-- serves them all; user_id is resolved per triggering table at run time.
create or replace function public.realtime_notify_field_owner()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  owner uuid := coalesce(new.user_id, old.user_id);
begin
  if owner is not null then
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op),
      'change',
      public.field_topic(owner),
      true  -- private channel; receipt gated by RLS on realtime.messages
    );
  end if;
  return null;
end;
$$;

-- support_messages has no user_id of its own; the owner is the thread's owner.
create or replace function public.realtime_notify_support_message()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  owner uuid;
begin
  select user_id into owner
    from public.support_threads
   where id = coalesce(new.thread_id, old.thread_id);
  if owner is not null then
    perform realtime.send(
      jsonb_build_object('table', 'support_messages', 'op', tg_op),
      'change',
      public.field_topic(owner),
      true
    );
  end if;
  return null;
end;
$$;

do $$
declare
  t text;
  owned text[] := array['attendance', 'store_visits', 'support_threads', 'notification_deliveries'];
begin
  foreach t in array owned loop
    execute format('drop trigger if exists realtime_broadcast on public.%I', t);
    execute format(
      'create trigger realtime_broadcast after insert or update or delete on public.%I
         for each row execute function public.realtime_notify_field_owner()', t);
  end loop;
end $$;

drop trigger if exists realtime_broadcast on public.support_messages;
create trigger realtime_broadcast
  after insert or update or delete on public.support_messages
  for each row execute function public.realtime_notify_support_message();

-- Receipt policy: an authenticated member may read only their own topic. This
-- is what makes the private broadcast channel safe — the socket carries the
-- member's own events and nothing else, the same guarantee RLS gave the old
-- Postgres Changes stream.
drop policy if exists "Field members read their own topic" on realtime.messages;
create policy "Field members read their own topic"
  on realtime.messages
  for select
  to authenticated
  using ( realtime.topic() = public.field_topic((select auth.uid())) );
