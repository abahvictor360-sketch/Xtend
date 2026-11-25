-- =====================================================================
-- XTEND migration 0109 — No clocking out before it is time
--
-- Clocking out early was allowed and flagged "Clocked out early" (0105).
-- Now it is refused until the person's clock-out time:
--
--   * their "Can clock out from" time (0105), or with none set, 15
--     minutes before the end of their day (0100), the same line the early
--     flag used;
--   * measured by when the selfie was taken (never later than now), so a
--     clock-out saved with no signal and sent later is judged by when it
--     was made, and on the day it was made (0107);
--   * refused with hint 'too_early' and the time as JSON in the detail;
--     the app says the same before the camera opens: "It is not time to
--     clock out yet. You can clock out from 18:00.";
--   * not refused: entries the office makes (0090), which is how the office
--     lets someone leave early, and system jobs;
--   * system_settings.block_early_clock_out (default on) turns it off:
--       update public.system_settings set block_early_clock_out = false;
--
-- Runs after attendance_enforce and attendance_capture_day (BEFORE
-- triggers fire in name order). Rerunnable.
-- =====================================================================

alter table public.system_settings add column if not exists block_early_clock_out boolean not null default true;
comment on column public.system_settings.block_early_clock_out is
  'Refuse clock-outs before the person''s clock-out time (0109).';

create or replace function public.early_clock_out_blocked()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.block_early_clock_out from public.system_settings s where s.id), true);
$$;
revoke all on function public.early_clock_out_blocked() from public, anon;
grant execute on function public.early_clock_out_blocked() to authenticated, service_role;

-- From when this person may clock out (Lagos time).
create or replace function public.clock_out_opens_at(p_user uuid)
returns time
language sql stable security definer set search_path = public as $$
  select coalesce(
    p.clock_out_from,
    p.shift_end - make_interval(mins => public.punctuality_grace_minutes())
  )
  from public.profiles p
  where p.id = p_user;
$$;
revoke all on function public.clock_out_opens_at(uuid) from public, anon;
grant execute on function public.clock_out_opens_at(uuid) to authenticated, service_role;

create or replace function public.attendance_no_early_clock_out()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  opens time;
  taken timestamptz;
begin
  if new.type <> 'closing' or auth.uid() is null or auth.uid() <> new.user_id
     or not public.early_clock_out_blocked() then
    return new;
  end if;
  opens := public.clock_out_opens_at(new.user_id);
  if opens is null then
    return new;
  end if;
  taken := least(coalesce(new.client_captured_at, now()), now());
  if taken < ((new.attendance_date + opens) at time zone 'Africa/Lagos') then
    raise exception 'It is not time to clock out yet. You can clock out from %.', to_char(opens, 'HH24:MI')
      using hint = 'too_early',
            detail = jsonb_build_object('opens_at', to_char(opens, 'HH24:MI'))::text;
  end if;
  return new;
end;
$$;
revoke all on function public.attendance_no_early_clock_out() from public, anon, authenticated;

drop trigger if exists trg_attendance_zw_clock_out_time on public.attendance;
create trigger trg_attendance_zw_clock_out_time
  before insert on public.attendance
  for each row when (not public.office_entry_on())
  execute function public.attendance_no_early_clock_out();

select 'No clocking out before it is time (0109) installed' as result;
