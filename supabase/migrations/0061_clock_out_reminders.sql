-- =====================================================================
-- 0061: Clock-out reminders
--
-- "App should request for clock out at the end of the time given by the
-- app." When someone is clocked in today and has not clocked out by the
-- end of their shift, their phone is told to clock out:
--
--   * stage 1 at the shift end ("Time to clock out");
--   * stage 2 sixty minutes later if they still have not ("You have not
--     clocked out yet").
--
-- The shift end is the shift_end of the store on their profile (their home
-- outlet), or 18:00 Lagos for somebody with no store. Never more than these
-- two per person per Lagos day, never after a clock-out, and never after
-- midnight Lagos (the day is read from the moment the job runs, and a
-- clock-in only counts on its own day).
--
-- The five-minute job (/api/cron/alerts) calls claim_clock_out_reminders()
-- and pushes what it hands back. Each reminder is claimed once: a row per
-- (person, day, stage) is written in the same statement that returns it, so
-- two runs at once, or a run every five minutes, never send one twice. A
-- late job still sends: the first if past the shift end, only the second if
-- an hour or more past it (one push, not two at once).
-- =====================================================================

create table if not exists public.clock_out_reminders (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  reminder_date  date not null,
  stage          smallint not null check (stage in (1, 2)),
  shift_end      time not null,
  claimed_at     timestamptz not null default now(),
  primary key (user_id, reminder_date, stage)
);

create index if not exists clock_out_reminders_date on public.clock_out_reminders (reminder_date desc);

alter table public.clock_out_reminders enable row level security;

-- Admins see all, a supervisor their own team, staff their own. Nobody
-- writes a row directly: only the claim function does.
drop policy if exists clock_out_reminders_read on public.clock_out_reminders;
create policy clock_out_reminders_read on public.clock_out_reminders
  for select using (
    user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id)
  );

revoke all on public.clock_out_reminders from anon;
revoke insert, update, delete on public.clock_out_reminders from authenticated;
grant select on public.clock_out_reminders to authenticated;

-- The shift end that applies to someone: their home store's, else 18:00.
create or replace function public.shift_end_for(p_user uuid)
returns time
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.shift_end from public.profiles p
     join public.outlets o on o.id = p.outlet_id
     where p.id = p_user),
    time '18:00');
$$;
revoke all on function public.shift_end_for(uuid) from public, anon;
grant execute on function public.shift_end_for(uuid) to authenticated, service_role;

-- The cron's side. Returns each reminder that is due and not yet sent, and
-- records it as sent in the same statement. p_now is only for the tests.
create or replace function public.claim_clock_out_reminders(p_now timestamptz default now())
returns table (user_id uuid, reminder_date date, stage smallint, shift_end text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  today date := (coalesce(p_now, now()) at time zone 'Africa/Lagos')::date;
  at_now timestamptz := coalesce(p_now, now());
begin
  return query
    with due as (
      select p.id as uid,
             public.shift_end_for(p.id) as ends
      from public.profiles p
      where p.is_active
        and exists (select 1 from public.attendance a
                    where a.user_id = p.id and a.attendance_date = today and a.type = 'opening')
        and not exists (select 1 from public.attendance a
                        where a.user_id = p.id and a.attendance_date = today and a.type = 'closing')
    ),
    staged as (
      select d.uid, d.ends,
             case
               when at_now >= ((today + d.ends) at time zone 'Africa/Lagos') + interval '60 minutes' then 2
               when at_now >= ((today + d.ends) at time zone 'Africa/Lagos') then 1
             end::smallint as st
      from due d
    ),
    claimed as (
      insert into public.clock_out_reminders as r (user_id, reminder_date, stage, shift_end, claimed_at)
      select s.uid, today, s.st, s.ends, at_now
      from staged s
      where s.st is not null
        -- Stage 1 is never sent once stage 2 has gone.
        and not exists (select 1 from public.clock_out_reminders x
                        where x.user_id = s.uid and x.reminder_date = today and x.stage >= s.st)
      on conflict do nothing
      returning r.user_id, r.reminder_date, r.stage, r.shift_end
    )
    select c.user_id, c.reminder_date, c.stage, to_char(c.shift_end, 'HH24:MI')
    from claimed c;
end;
$$;
revoke all on function public.claim_clock_out_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_clock_out_reminders(timestamptz) to service_role;

select 'clock-out reminders (0061) installed' as result;
