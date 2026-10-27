-- =====================================================================
-- 0069: Reminders five minutes before the shift starts and ends
--
-- "The user should be notified to clock out and clock in when it is 5
-- minutes to clock in or out." Two more reminders join 0061's:
--
--   * clock_in_soon (stage 3): five minutes before the shift starts, to
--     field staff with a working day today (not a day off, not approved
--     leave) who have not clocked in yet ("Time to clock in");
--   * clock_out_soon (stage 4): five minutes before the shift ends, to
--     those clocked in and not out ("Your shift ends at HH:MM").
--
-- 0061's two stay as they were: 1 at the shift end, 2 an hour after it.
--
-- Rows live in 0061's clock_out_reminders table (one row per person, day
-- and stage, so each goes at most once a day), so the reset (0066) and
-- every read rule already cover them. For stage 3 the shift_end column
-- holds the shift START the reminder was about; stage_name spells out
-- each stage.
--
-- The shift start is the home store's shift_start, or 08:00 Lagos for
-- somebody with no store (the same 08:00 a store gets by default and
-- lateness is measured from). Only merchandisers and marketers (custom
-- roles carry their base role on the profile) and only active accounts:
-- never admins or supervisors.
--
-- Each is sent only inside its five minutes, [time - 5 min, time): the
-- alerts job runs every five minutes, so exactly one run falls inside. A
-- job that runs late, after the time has passed, sends nothing for it
-- (the at-end clock-out reminder covers a missed heads-up). The reminders
-- depend on that job running on time.
-- =====================================================================

alter table public.clock_out_reminders drop constraint if exists clock_out_reminders_stage_check;
alter table public.clock_out_reminders
  add constraint clock_out_reminders_stage_check check (stage in (1, 2, 3, 4));

alter table public.clock_out_reminders
  add column if not exists stage_name text generated always as (
    case stage
      when 1 then 'clock_out'
      when 2 then 'clock_out_late'
      when 3 then 'clock_in_soon'
      when 4 then 'clock_out_soon'
    end) stored;

-- The shift start that applies to someone: their home store's, else 08:00.
create or replace function public.shift_start_for(p_user uuid)
returns time
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.shift_start from public.profiles p
     join public.outlets o on o.id = p.outlet_id
     where p.id = p_user),
    time '08:00');
$$;
revoke all on function public.shift_start_for(uuid) from public, anon;
grant execute on function public.shift_start_for(uuid) to authenticated, service_role;

-- 0061's claim, unchanged except that the new stages (3, 4) never stop the
-- at-end reminder: only a stage 1 or 2 row already sent does.
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
                        where x.user_id = s.uid and x.reminder_date = today
                          and x.stage >= s.st and x.stage <= 2)
      on conflict do nothing
      returning r.user_id, r.reminder_date, r.stage, r.shift_end
    )
    select c.user_id, c.reminder_date, c.stage, to_char(c.shift_end, 'HH24:MI')
    from claimed c;
end;
$$;
revoke all on function public.claim_clock_out_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_clock_out_reminders(timestamptz) to service_role;

-- The cron's side for the five-minute heads-ups. Returns each one that is
-- due now and not yet sent, recording it in the same statement, so two
-- runs at once never send one twice. stage is 'clock_in_soon' or
-- 'clock_out_soon'; shift_time is the start or the end (HH:MM); store is
-- the home store's name (null with no store). p_now is only for the tests.
create or replace function public.claim_shift_soon_reminders(p_now timestamptz default now())
returns table (user_id uuid, reminder_date date, stage text, shift_time text, store text)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  at_now timestamptz := coalesce(p_now, now());
  today date := (at_now at time zone 'Africa/Lagos')::date;
begin
  return query
    with staff as (
      select p.id as uid,
             exists (select 1 from public.attendance a
                     where a.user_id = p.id and a.attendance_date = today and a.type = 'opening') as is_in,
             exists (select 1 from public.attendance a
                     where a.user_id = p.id and a.attendance_date = today and a.type = 'closing') as is_out
      from public.profiles p
      where p.is_active
        and p.role in ('merchandiser'::user_role, 'marketer'::user_role)
    ),
    due as (
      -- Clock in: a working day, not clocked in, start five minutes away.
      select s.uid, 3::smallint as st, public.shift_start_for(s.uid) as at_time
      from staff s
      where not s.is_in
        and public.day_kind(s.uid, today) = 'working'
        and at_now >= ((today + public.shift_start_for(s.uid)) at time zone 'Africa/Lagos') - interval '5 minutes'
        and at_now <  ((today + public.shift_start_for(s.uid)) at time zone 'Africa/Lagos')
      union all
      -- Clock out: clocked in and not out, end five minutes away.
      select s.uid, 4::smallint, public.shift_end_for(s.uid)
      from staff s
      where s.is_in and not s.is_out
        and at_now >= ((today + public.shift_end_for(s.uid)) at time zone 'Africa/Lagos') - interval '5 minutes'
        and at_now <  ((today + public.shift_end_for(s.uid)) at time zone 'Africa/Lagos')
    ),
    claimed as (
      insert into public.clock_out_reminders as r (user_id, reminder_date, stage, shift_end, claimed_at)
      select d.uid, today, d.st, d.at_time, at_now
      from due d
      on conflict do nothing
      returning r.user_id, r.reminder_date, r.stage, r.shift_end
    )
    select c.user_id, c.reminder_date,
           case c.stage when 3 then 'clock_in_soon' else 'clock_out_soon' end,
           to_char(c.shift_end, 'HH24:MI'),
           (select o.name from public.profiles p join public.outlets o on o.id = p.outlet_id where p.id = c.user_id)
    from claimed c;
end;
$$;
revoke all on function public.claim_shift_soon_reminders(timestamptz) from public, anon, authenticated;
grant execute on function public.claim_shift_soon_reminders(timestamptz) to service_role;

select 'shift heads-up reminders (0069) installed' as result;
