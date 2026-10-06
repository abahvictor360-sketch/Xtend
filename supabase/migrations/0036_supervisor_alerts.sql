-- =====================================================================
-- XTEND migration 036 — supervisors hear about it
--
--   * Alerts go to a person's supervisor however they supervise them:
--     the person reports to them (Teams), or shares or is allocated to
--     their store. Before, only a supervisor whose own store was the
--     person's home store was told, so a team built on the Teams page
--     heard nothing.
--   * Clocking in late, and clocking out early, against the store's shift
--     are recorded as integrity flags.
--   * Every medium or high integrity flag is pushed to the watchers once:
--     claim_flag_alerts() hands the server the flags nobody has been told
--     about yet, and marks them told in the same statement, so two
--     servers sweeping at once never send the same alert twice.
-- =====================================================================

do $$
begin
  if to_regclass('public.integrity_flags') is null then
    raise exception 'Run the integrity checks update (022) first, then this file';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Who is told about somebody: every admin, and every supervisor who
-- supervises them in the sense supervises_user() uses.
-- ---------------------------------------------------------------------
create or replace function public.alert_watchers(p_user uuid)
returns table (user_id uuid, full_name text, role user_role)
language sql stable security definer set search_path = public as $$
  select w.id, w.full_name, w.role
  from public.profiles w
  join public.profiles them on them.id = p_user
  where w.is_active
    and w.id <> p_user
    and (
      w.role = 'admin'::user_role
      or (
        w.role = 'supervisor'::user_role
        and public.is_field_role(them.role)
        and (
          them.supervisor_id = w.id
          or (w.outlet_id is not null and them.outlet_id = w.outlet_id)
          or (w.outlet_id is not null
              and exists (select 1 from public.staff_outlets s
                          where s.user_id = them.id and s.outlet_id = w.outlet_id))
        )
      )
    );
$$;
revoke all on function public.alert_watchers(uuid) from public, anon, authenticated;
grant execute on function public.alert_watchers(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Late in, early out.
-- ---------------------------------------------------------------------
alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check check (kind in (
  'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
  'count_units_missing', 'count_identical', 'count_round_numbers',
  'photo_rejected', 'photo_unchecked', 'own_named_place', 'selfie_at_home',
  'backdated_clock', 'phone_clock_wrong', 'late_sync_with_network',
  'vpn_suspected', 'ip_location_mismatch', 'timezone_mismatch', 'gps_mock_fingerprint',
  'mock_location_confirmed', 'device_integrity_failed',
  'late_clock_in', 'early_clock_out'));

-- Minutes either side of the shift that are not worth a word.
create or replace function public.punctuality_grace_minutes()
returns integer language sql immutable as $$ select 15 $$;

create or replace function public.attendance_punctuality()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  shift record;
  -- When the photo was taken, which is when they clocked: a clock-in made
  -- offline and sent later is not late for having waited for signal.
  -- (A phone clock moved to look punctual is flagged by 026.)
  at_local timestamp := (coalesce(new.client_captured_at, new.created_at) at time zone 'Africa/Lagos');
  minutes integer;
begin
  if new.user_id is null then
    return null;
  end if;

  -- The store they clocked at, or their home store.
  select o.id, o.name, o.shift_start, o.shift_end into shift
  from public.outlets o
  where o.id = coalesce(new.outlet_id,
                        (select p.outlet_id from public.profiles p where p.id = new.user_id));
  if shift.id is null or shift.shift_start is null or shift.shift_end is null then
    return null;
  end if;

  if new.type = 'opening' then
    minutes := floor(extract(epoch from at_local - (new.attendance_date + shift.shift_start)) / 60);
    if minutes > public.punctuality_grace_minutes() then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'late_clock_in', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked in %s late at %s (shift starts %s)',
                     public.minutes_label(minutes), shift.name, to_char(shift.shift_start, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  elsif new.type = 'closing' then
    minutes := floor(extract(epoch from (new.attendance_date + shift.shift_end) - at_local) / 60);
    if minutes > public.punctuality_grace_minutes() then
      insert into public.integrity_flags (user_id, kind, severity, summary, detail, outlet_id, flag_date)
      values (new.user_id, 'early_clock_out', case when minutes > 60 then 'high' else 'medium' end,
              format('Clocked out %s early at %s (shift ends %s)',
                     public.minutes_label(minutes), shift.name, to_char(shift.shift_end, 'HH24:MI')),
              jsonb_build_object('attendance_id', new.id, 'minutes', minutes),
              shift.id, new.attendance_date);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function public.attendance_punctuality() from public, anon, authenticated;

-- "25 min", "1 h 10 min".
create or replace function public.minutes_label(p_minutes integer)
returns text language sql immutable as $$
  select case
    when p_minutes < 60 then p_minutes || ' min'
    when p_minutes % 60 = 0 then (p_minutes / 60) || ' h'
    else (p_minutes / 60) || ' h ' || (p_minutes % 60) || ' min'
  end;
$$;

drop trigger if exists trg_attendance_punctuality on public.attendance;
create trigger trg_attendance_punctuality
  after insert on public.attendance
  for each row execute function public.attendance_punctuality();

-- ---------------------------------------------------------------------
-- Pushing flags. Flags raised before this file are history: marked told.
-- ---------------------------------------------------------------------
alter table public.integrity_flags add column if not exists notified_at timestamptz;
update public.integrity_flags set notified_at = created_at where notified_at is null;

create index if not exists integrity_flags_to_notify
  on public.integrity_flags (created_at) where notified_at is null;

create or replace function public.claim_flag_alerts(p_limit integer default 50)
returns table (
  id uuid, user_id uuid, staff_name text, kind text, severity text,
  summary text, outlet_name text, created_at timestamptz
)
language sql security definer set search_path = public as $$
  with due as (
    select f.id
    from public.integrity_flags f
    where f.notified_at is null
      and f.reviewed_at is null
      and f.severity in ('medium', 'high')
      and f.created_at > now() - interval '1 day'
    order by f.created_at
    limit greatest(1, least(p_limit, 200))
    for update skip locked
  ), told as (
    update public.integrity_flags f
    set notified_at = now()
    from due
    where f.id = due.id
    returning f.id, f.user_id, f.kind, f.severity, f.summary, f.outlet_id, f.created_at
  )
  select t.id, t.user_id, p.full_name, t.kind, t.severity, t.summary, o.name, t.created_at
  from told t
  join public.profiles p on p.id = t.user_id
  left join public.outlets o on o.id = t.outlet_id
  order by t.created_at;
$$;
revoke all on function public.claim_flag_alerts(integer) from public, anon, authenticated;
grant execute on function public.claim_flag_alerts(integer) to service_role;

select 'Supervisor alerts (036) installed' as result;
