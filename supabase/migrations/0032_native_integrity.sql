-- ---------------------------------------------------------------------
-- XTEND: native-shell integrity flags.
--
-- When Xtend runs inside the Android/iOS wrapper (see /native), the OS gives
-- two signals a browser cannot: Android's hard mock-location flag, and
-- whether the device is rooted / jailbroken. The attendance route records
-- these through flag_own_integrity(), so this migration only widens the two
-- places that whitelist flag kinds.
-- ---------------------------------------------------------------------

alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check
  check (kind in (
    -- 022
    'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
    'count_units_missing', 'count_identical', 'count_round_numbers',
    -- 030
    'vpn_suspected', 'ip_location_mismatch', 'timezone_mismatch', 'gps_mock_fingerprint',
    -- 032: from the native shell
    'mock_location_confirmed', 'device_integrity_failed'
  ));

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
                    'timezone_mismatch', 'gps_mock_fingerprint',
                    'mock_location_confirmed', 'device_integrity_failed') then
    raise exception 'flag_own_integrity does not accept kind %', p_kind;
  end if;

  if p_severity not in ('low', 'medium', 'high') then
    p_severity := 'medium';
  end if;

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
