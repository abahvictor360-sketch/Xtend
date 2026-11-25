-- =====================================================================
-- XTEND migration 0105 — A clock-out window
--
-- A person's day ends at shift_end (0100), and clocking out more than 15
-- minutes before it was "Clocked out early". The office can now let people
-- leave from a set time: for example, a day 08:30 to 18:30 where clocking
-- out any time from 18:00 is fine.
--
--   * profiles.clock_out_from (optional): from when they may clock out
--     without it being early; after the start, no later than the end;
--   * the early clock-out flag measures from it, with no extra grace; with
--     none set, it is as before (15 minutes before the end);
--   * staff still cannot change their own hours or window.
--
-- Rerunnable.
-- =====================================================================

alter table public.profiles add column if not exists clock_out_from time;
alter table public.profiles drop constraint if exists profiles_clock_out_window;
alter table public.profiles add constraint profiles_clock_out_window
  check (clock_out_from is null or (clock_out_from > shift_start and clock_out_from <= shift_end)) not valid;
comment on column public.profiles.clock_out_from is
  'From when (Lagos time) this person may clock out without it counting as early; null: 15 minutes before shift_end (0105).';

-- Staff cannot change their own hours or window.
create or replace function public.profiles_self_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or new.id <> auth.uid() then
    return new;
  end if;
  new.role          := old.role;
  new.staff_role_id := old.staff_role_id;
  new.outlet_id     := old.outlet_id;
  new.supervisor_id := old.supervisor_id;
  new.is_active     := old.is_active;
  new.push_exempt   := old.push_exempt;
  new.app_only      := old.app_only;
  -- 0100: their working hours are set by the office; 0105: and the window.
  new.shift_start    := old.shift_start;
  new.shift_end      := old.shift_end;
  new.clock_out_from := old.clock_out_from;
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;

-- Late and early flags against the person's own hours, and their window.
create or replace function public.attendance_punctuality()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  shift record;
  -- When the photo was taken, which is when they clocked: a clock-in made
  -- offline and sent later is not late for having waited for signal.
  at_local timestamp := (coalesce(new.client_captured_at, new.created_at) at time zone 'Africa/Lagos');
  minutes integer;
begin
  if new.user_id is null then
    return null;
  end if;

  select p.shift_start, p.shift_end, p.clock_out_from,
         o.id, o.name
    into shift
  from public.profiles p
  left join public.outlets o on o.id = coalesce(new.outlet_id, p.outlet_id)
  where p.id = new.user_id;
  if shift.shift_start is null or shift.shift_end is null then
    return null;
  end if;

  if new.type = 'opening' then
    minutes := floor(extract(epoch from at_local - (new.attendance_date + shift.shift_start)) / 60);
    if minutes > public.punctuality_grace_minutes() then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'late_clock_in', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked in %s late%s (their day starts %s)',
                     public.minutes_label(minutes), coalesce(' at ' || shift.name, ''), to_char(shift.shift_start, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  elsif new.type = 'closing' and shift.clock_out_from is not null then
    -- 0105: any time from their window is fine; before it is early.
    minutes := floor(extract(epoch from (new.attendance_date + shift.clock_out_from) - at_local) / 60);
    if minutes > 0 then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'early_clock_out', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked out %s early%s (they may clock out from %s)',
                     public.minutes_label(minutes), coalesce(' at ' || shift.name, ''), to_char(shift.clock_out_from, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  elsif new.type = 'closing' then
    minutes := floor(extract(epoch from (new.attendance_date + shift.shift_end) - at_local) / 60);
    if minutes > public.punctuality_grace_minutes() then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'early_clock_out', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked out %s early%s (their day ends %s)',
                     public.minutes_label(minutes), coalesce(' at ' || shift.name, ''), to_char(shift.shift_end, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  end if;
  return null;
end;
$$;

select 'A clock-out window (0105) installed' as result;
