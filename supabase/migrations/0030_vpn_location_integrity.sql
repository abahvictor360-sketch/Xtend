-- ---------------------------------------------------------------------
-- XTEND: VPN and location-manipulation checks.
--
-- Migration 022 already flags faked GPS from the shape of the fix itself:
-- the same point twice, impossibly good accuracy, impossible journeys.
-- Those are decided in the database from columns it already holds.
--
-- The checks added here need something the database cannot see on its own:
-- the IP address the clock-in arrived from, the phone's own time zone, and
-- the extra GPS fields (altitude, speed, heading) that a real chip fills in
-- and a fake-location app usually leaves empty. That evaluation happens in
-- the attendance API route, which then calls flag_own_integrity() below to
-- record whatever it found. Nothing here blocks a clock-in; a flag is a
-- reason for a supervisor to look, exactly like the 022 flags.
-- ---------------------------------------------------------------------

-- 1. Allow the four new flag kinds on the existing table.
alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check
  check (kind in (
    -- 022
    'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
    'count_units_missing', 'count_identical', 'count_round_numbers',
    -- 030: manipulation checks evaluated in the API route
    'vpn_suspected', 'ip_location_mismatch', 'timezone_mismatch', 'gps_mock_fingerprint'
  ));

-- 2. A caller may record one of the new flags, for themselves only.
--
-- Insert on integrity_flags is revoked from authenticated (022), so the
-- route cannot write the row directly; it calls this. The function pins the
-- user to auth.uid(), allows only the route-evaluated kinds, and keeps one
-- row per user per kind per hour so a retry loop cannot flood the queue.
-- A supervisor forging a "clean" review still cannot erase a flag: review
-- only sets reviewed_at.
create or replace function public.flag_own_integrity(
  p_kind     text,
  p_severity text,
  p_summary  text,
  p_detail   jsonb default '{}'::jsonb,
  p_outlet   uuid  default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_kind not in ('vpn_suspected', 'ip_location_mismatch',
                    'timezone_mismatch', 'gps_mock_fingerprint') then
    raise exception 'flag_own_integrity does not accept kind %', p_kind;
  end if;

  if p_severity not in ('low', 'medium', 'high') then
    p_severity := 'medium';
  end if;

  -- One per user per kind per hour.
  if exists (
    select 1 from public.integrity_flags f
    where f.user_id = uid
      and f.kind = p_kind
      and f.created_at > now() - interval '1 hour'
  ) then
    return;
  end if;

  insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id)
  values (uid, p_kind, p_severity, left(p_summary, 300), coalesce(p_detail, '{}'::jsonb), p_outlet);
end;
$$;

revoke all on function public.flag_own_integrity(text, text, text, jsonb, uuid) from public, anon;
grant execute on function public.flag_own_integrity(text, text, text, jsonb, uuid) to authenticated, service_role;
