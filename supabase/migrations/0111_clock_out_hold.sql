-- =====================================================================
-- XTEND migration 0111 — The office switches the clock-out hold per person
--
-- 0109 stops everyone clocking out before their clock-out time. Now the
-- office can switch that off for one person ("let them clock out now")
-- and back on again:
--
--   * profiles.hold_clock_out (default on): on, they cannot clock out
--     before their time (0109); off, they can clock out whenever;
--   * set_clock_out_hold(user, hold): an admin, HR, or their own
--     supervisor (may_correct_field, 0090), for active field staff;
--   * staff cannot change it themselves (profiles_self_guard);
--   * an early clock-out made while it is off is still flagged early.
--
-- Rerunnable.
-- =====================================================================

alter table public.profiles add column if not exists hold_clock_out boolean not null default true;
comment on column public.profiles.hold_clock_out is
  'On: no clocking out before their clock-out time (0109). Off: the office has let them clock out whenever (0111).';

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
  -- 0111: and whether their clock-out waits for their time.
  new.hold_clock_out := old.hold_clock_out;
  -- 0108: a pause for a fake location is lifted by the office only. (The
  -- pause itself is set by trigger in the person's own request, so only
  -- lifting or changing one is blocked here.)
  if old.paused_at is not null then
    new.paused_at     := old.paused_at;
    new.paused_reason := old.paused_reason;
    new.paused_flag   := old.paused_flag;
  elsif coalesce(current_setting('xtend.pausing', true), '') <> 'on' then
    new.paused_at     := null;
    new.paused_reason := null;
    new.paused_flag   := null;
  end if;
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;

create or replace function public.set_clock_out_hold(p_user uuid, p_hold boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_hold is null then
    raise exception 'Say on or off.';
  end if;
  if not public.may_correct_field(p_user) then
    raise exception 'Not permitted';
  end if;
  update public.profiles set hold_clock_out = p_hold where id = p_user;
  return p_hold;
end;
$$;
revoke all on function public.set_clock_out_hold(uuid, boolean) from public, anon;
grant execute on function public.set_clock_out_hold(uuid, boolean) to authenticated, service_role;

-- 0109's rule, now only while their hold is on.
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
  -- 0111: the office has let them clock out whenever.
  if not coalesce((select p.hold_clock_out from public.profiles p where p.id = new.user_id), true) then
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

select 'The clock-out hold per person (0111) installed' as result;
