-- =====================================================================
-- XTEND migration 0093 — the office undoes a clock-out made by mistake
--
-- Someone taps Clock out by mistake (or too early) and carries on working.
-- "Ask them to clock out again" (0090) only shows the button again: until
-- they do, Xtend still treats them as clocked out, so their location is
-- not followed and they show as gone for the day.
--
-- office_reset_clock_out(person, reason) puts them back on shift:
--   * today's clock-out is set aside (deleted from attendance, kept whole
--     in field_corrections as 'reset_clock_out', with who, why and when);
--   * any movement linked to it moves to their clock-in;
--   * an "early clock-out" flag it raised, still unreviewed, goes;
--   * today's clock-out reminders are cleared, so they are reminded again;
--   * an open "clock out again" request for today is closed: this replaces it.
-- Their phone sees no clock-out, shows Clock out again and starts sharing
-- location again; they clock out normally at the end of the shift.
-- Today only, for an active merchandiser or marketer, by an admin, HR or
-- their supervisor (may_correct_field, 0090).
--
-- Rerunnable.
-- =====================================================================

alter table public.field_corrections drop constraint if exists field_corrections_action_check;
alter table public.field_corrections add constraint field_corrections_action_check check (action in (
  'office_clock_in', 'office_clock_out', 'office_check_in', 'office_check_out',
  'redo_clock_in', 'redo_clock_out', 'redo_check_in', 'redo_check_out',
  'reset_clock_out'));

create or replace function public.office_reset_clock_out(p_user uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  actor uuid := auth.uid();
  closing public.attendance;
  opening_id uuid;
  pings uuid[];
  new_id uuid;
begin
  if actor is null or not public.may_correct_field(p_user) then
    raise exception 'You can only fix the day of active field staff you look after';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why, so they know what happened';
  end if;

  select * into closing from public.attendance a
  where a.user_id = p_user and a.attendance_date = public.business_date() and a.type = 'closing';
  if not found then
    raise exception 'They have not clocked out today, so there is nothing to undo';
  end if;
  select a.id into opening_id from public.attendance a
  where a.user_id = p_user and a.attendance_date = public.business_date() and a.type = 'opening';

  select coalesce(array_agg(p.id), '{}') into pings from public.location_pings p where p.attendance_id = closing.id;
  update public.location_pings set attendance_id = opening_id where attendance_id = closing.id;

  delete from public.integrity_flags f
  where f.user_id = p_user and f.kind = 'early_clock_out' and f.reviewed_at is null
    and f.detail->>'attendance_id' = closing.id::text;
  delete from public.clock_out_reminders r
  where r.user_id = p_user and r.reminder_date = public.business_date();
  update public.field_corrections set status = 'done', done_at = now()
  where user_id = p_user and status = 'open' and correction_date = public.business_date()
    and action in ('redo_clock_out', 'office_clock_out');

  insert into public.field_corrections
    (user_id, action, reason, requested_by, status, record_id, old_record, ping_ids, done_at)
  values (p_user, 'reset_clock_out', btrim(p_reason), actor, 'done', closing.id, to_jsonb(closing), pings, now())
  returning id into new_id;

  delete from public.attendance where id = closing.id;
  return new_id;
end;
$$;

revoke all on function public.office_reset_clock_out(uuid, text) from public, anon;
grant execute on function public.office_reset_clock_out(uuid, text) to authenticated, service_role;
