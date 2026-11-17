-- 0092: the office flags a photo that is not right.
--
-- On a person's day (Attendance → their name) the office sees every photo
-- of the day: the clock-in and clock-out selfies and each store check-in and
-- check-out. When one is wrong (not them, not at the store, a photo of a
-- photo or a screen, unclear) an admin, or that person's supervisor, flags
-- it. The flag is an integrity flag like the automatic ones, so it shows on
-- Integrity, on the person's day and in Ask Xtend, and it can be looked at
-- and closed the same way. Staff are never told.
--
--   * integrity_flags.kind 'photo_flagged' (severity high), already
--     notified (the person who flagged it does not need an alert about it);
--   * one flag per photo: flagging again changes the reason;
--   * flag_photo(path, reason, note) finds the clock-in, clock-out or store
--     visit the photo belongs to (it must be one, in that person's own
--     records) and records the date, event and store with the flag;
--   * unflag_photo(path) takes the flag off again.

alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check check (kind in (
  'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
  'count_units_missing', 'count_identical', 'count_round_numbers',
  'photo_rejected', 'photo_unchecked', 'own_named_place', 'selfie_at_home',
  'backdated_clock', 'phone_clock_wrong', 'late_sync_with_network',
  'vpn_suspected', 'ip_location_mismatch', 'timezone_mismatch', 'gps_mock_fingerprint',
  'mock_location_confirmed', 'device_integrity_failed',
  'late_clock_in', 'early_clock_out',
  'stock_discrepancy',
  'photo_flagged'));

-- One open office flag per photo.
create unique index if not exists integrity_flags_one_per_photo
  on public.integrity_flags ((detail->>'path'))
  where kind = 'photo_flagged';

-- The reasons the office can give, in the words the dashboard shows.
create or replace function public.photo_flag_reasons()
returns text[] language sql immutable as $$
  select array['not_them', 'not_at_store', 'photo_of_photo', 'unclear', 'other'];
$$;

create or replace function public.flag_photo(p_path text, p_reason text, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  ev record;
  note text := nullif(btrim(coalesce(p_note, '')), '');
  summary text;
  flag_id uuid;
begin
  if actor is null then
    raise exception 'Sign in to flag a photo';
  end if;
  if p_reason is null or not (p_reason = any(public.photo_flag_reasons())) then
    raise exception 'Choose why the photo is not right';
  end if;
  if p_reason = 'other' and note is null then
    raise exception 'Say what is wrong with the photo';
  end if;
  if note is not null and length(note) > 300 then
    raise exception 'Keep the note under 300 characters';
  end if;

  -- The photo must be one of a clock-in, clock-out or store visit.
  select * into ev from (
    select a.user_id, a.attendance_date as day,
           case a.type when 'opening' then 'clock_in' else 'clock_out' end as event,
           a.id as event_id, a.outlet_id, a.created_at as at
    from public.attendance a
    where p_path in (a.selfie_path, a.thumb_path)
    union all
    select v.user_id, v.visit_date, 'check_in', v.id, v.outlet_id, v.arrived_at
    from public.store_visits v
    where p_path in (v.selfie_path, v.thumb_path)
    union all
    select v.user_id, v.visit_date, 'check_out', v.id, v.outlet_id, v.departed_at
    from public.store_visits v
    where p_path in (v.departed_selfie_path, v.departed_thumb_path)
  ) x
  limit 1;
  if not found then
    raise exception 'That photo is not part of anyone''s clock-in, clock-out or store visit';
  end if;
  if not (public.is_admin() or public.supervises_user(ev.user_id)) then
    raise exception 'Only an admin or their supervisor can flag this photo';
  end if;

  summary := case ev.event
               when 'clock_in' then 'Clock-in photo'
               when 'clock_out' then 'Clock-out photo'
               when 'check_in' then 'Store check-in photo'
               else 'Store check-out photo'
             end
             || ' flagged by the office: '
             || case p_reason
                  when 'not_them' then 'not the right person'
                  when 'not_at_store' then 'not taken at the store'
                  when 'photo_of_photo' then 'a photo of a photo or a screen'
                  when 'unclear' then 'face not clear'
                  else 'other'
                end
             || coalesce(' (' || note || ')', '');

  insert into public.integrity_flags
    (user_id, kind, severity, summary, detail, outlet_id, flag_date, notified_at)
  values
    (ev.user_id, 'photo_flagged', 'high', summary,
     jsonb_build_object('path', p_path, 'reason', p_reason, 'note', note, 'event', ev.event,
                        'event_id', ev.event_id, 'event_at', ev.at, 'flagged_by', actor),
     ev.outlet_id, ev.day, now())
  on conflict ((detail->>'path')) where kind = 'photo_flagged'
  do update set summary = excluded.summary, detail = excluded.detail, created_at = now(),
                reviewed_by = null, reviewed_at = null, review_note = null
  returning id into flag_id;
  return flag_id;
end;
$$;
revoke all on function public.flag_photo(text, text, text) from public, anon;
grant execute on function public.flag_photo(text, text, text) to authenticated, service_role;

create or replace function public.unflag_photo(p_path text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  f record;
begin
  select id, user_id into f from public.integrity_flags
  where kind = 'photo_flagged' and detail->>'path' = p_path;
  if f is null then
    return false;
  end if;
  if not (public.is_admin() or public.supervises_user(f.user_id)) then
    raise exception 'Only an admin or their supervisor can take this flag off';
  end if;
  delete from public.integrity_flags where id = f.id;
  return true;
end;
$$;
revoke all on function public.unflag_photo(text) from public, anon;
grant execute on function public.unflag_photo(text) to authenticated, service_role;
