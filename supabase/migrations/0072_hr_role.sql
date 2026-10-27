-- =====================================================================
-- XTEND migration 0072 — the HR role
--
-- HR looks after people, not stock or locations. An HR account sees every
-- staff member (everyone but admins): their details, attendance and
-- lateness, leave and schedules. HR decides leave, sets schedules and adds
-- or deactivates merchandisers and marketers. HR does not see settings,
-- stores, X Metrics, movement, alerts or integrity checks: none of those
-- policies or functions name HR, so they stay closed.
--
--   * is_hr(): the signed-in person is an active HR account.
--   * hr_sees(target): HR, looking at anybody who is not an admin.
--   * New read policies sit beside the existing ones (nothing is dropped).
--   * The people functions the HR pages call let HR in.
--   * write_audit() accepts HR, so every HR change is audited.
--
-- Run 0071 first: it adds the 'hr' value this file uses.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'user_role' and e.enumlabel = 'hr') then
    raise exception 'Run 0071 (the HR role value) first, then this file';
  end if;
end $$;

create or replace function public.is_hr()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'hr'::user_role and is_active from public.profiles where id = auth.uid()),
    false);
$$;
revoke all on function public.is_hr() from public, anon;
grant execute on function public.is_hr() to authenticated, service_role;

-- HR sees everybody except admins (and themselves, as everyone does).
create or replace function public.hr_sees(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_hr() and exists (
    select 1 from public.profiles p where p.id = target and p.role <> 'admin'::user_role);
$$;
revoke all on function public.hr_sees(uuid) from public, anon;
grant execute on function public.hr_sees(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- What HR reads.
-- ---------------------------------------------------------------------
create policy profiles_hr_select on public.profiles
  for select using (public.hr_sees(id));
create policy attendance_hr_select on public.attendance
  for select using (public.hr_sees(user_id));
create policy leave_requests_hr_read on public.leave_requests
  for select using (public.hr_sees(user_id));
create policy work_patterns_hr_read on public.work_patterns
  for select using (public.hr_sees(user_id));
create policy schedule_overrides_hr_read on public.schedule_overrides
  for select using (public.hr_sees(user_id));
create policy staff_outlets_hr_select on public.staff_outlets
  for select using (public.hr_sees(user_id));

-- The staff list behind Staff, Schedules and Leave.
create or replace function public.my_staff()
returns setof public.profiles
language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p
  where public.is_admin() or public.supervises_user(p.id) or public.hr_sees(p.id) or p.id = auth.uid()
  order by p.full_name;
$$;

-- Who can be named as somebody's supervisor: admins and HR choose.
create or replace function public.available_supervisors()
returns table (id uuid, full_name text, role user_role, outlet_id uuid)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, p.outlet_id
  from public.profiles p
  where (public.is_admin() or public.is_hr())
    and p.is_active
    and p.role in ('supervisor'::user_role, 'admin'::user_role)
  order by p.full_name;
$$;

-- Punctuality and coverage (Analytics).
create or replace function public.staff_analytics(p_from date, p_to date)
returns table (user_id uuid, full_name text, outlet_name text, days_present integer,
               days_late integer, days_off_site integer, avg_distance_m double precision)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    p.full_name,
    o.name,
    count(*) filter (where a.type = 'opening')::int,
    count(*) filter (
      where a.type = 'opening' and o.shift_start is not null
        and (a.created_at at time zone 'Africa/Lagos')::time > o.shift_start
    )::int,
    count(*) filter (where a.type = 'opening' and a.status <> 'on_site')::int,
    round(avg(a.distance_m) filter (where a.type = 'opening')::numeric, 1)::double precision
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  left join public.attendance a
    on a.user_id = p.id and a.attendance_date between p_from and p_to
  where public.is_field_role(p.role)
    and (public.is_admin() or public.supervises_user(p.id) or public.hr_sees(p.id))
  group by p.id, p.full_name, o.name
  order by p.full_name;
$$;

-- Schedules: HR sets them for any merchandiser or marketer.
create or replace function public.can_manage_schedule(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select public.is_field_role(p.role)
            and (public.is_admin() or public.supervises_user(p.id) or public.hr_sees(p.id))
       from public.profiles p where p.id = p_user),
    false);
$$;

create or replace function public.schedule_guard(p_user uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
declare
  target_role user_role;
begin
  if not (public.is_admin() or public.is_hr() or public.current_user_role() = 'supervisor') then
    raise exception 'Only admins, HR and supervisors set schedules';
  end if;
  select role into target_role from public.profiles where id = p_user;
  if target_role is null then
    raise exception 'That person was not found';
  end if;
  if not public.is_field_role(target_role) then
    raise exception 'Schedules are for merchandisers and marketers';
  end if;
  if not public.can_manage_schedule(p_user) then
    raise exception 'You can only set schedules for your own team';
  end if;
end;
$$;

create or replace function public.is_working_day(p_user uuid, p_day date)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_user = auth.uid() or public.is_admin() or public.supervises_user(p_user)
         or public.hr_sees(p_user)
      then public.day_kind(p_user, p_day) = 'working'
  end;
$$;

-- Leave: HR decides it for anybody but themselves.
create or replace function public.decide_leave(p_id uuid, p_approve boolean, p_note text default '')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l public.leave_requests;
  clean text := btrim(coalesce(p_note, ''));
  outcome text;
begin
  if not (public.is_admin() or public.is_hr() or public.current_user_role() = 'supervisor') then
    raise exception 'Only admins, HR and supervisors decide leave';
  end if;
  if p_approve is null then
    raise exception 'Approve or reject the request';
  end if;
  select * into l from public.leave_requests where id = p_id for update;
  if l.id is null then
    raise exception 'That request was not found';
  end if;
  if l.user_id = auth.uid() then
    raise exception 'You cannot decide your own leave';
  end if;
  if not (public.is_admin() or public.supervises_user(l.user_id) or public.hr_sees(l.user_id)) then
    raise exception 'You can only decide leave for your own team';
  end if;
  if l.status = 'cancelled' then
    raise exception 'That request was cancelled';
  end if;
  if l.status <> 'pending' then
    raise exception 'That request has already been decided';
  end if;
  if length(clean) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  outcome := case when p_approve then 'approved' else 'rejected' end;
  update public.leave_requests
     set status = outcome, decided_by = auth.uid(), decided_at = now(), decision_note = clean
   where id = p_id;

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), case when p_approve then 'leave.approve' else 'leave.reject' end,
          'leave_requests', p_id,
          jsonb_build_object('user_id', l.user_id, 'kind', l.kind, 'from', l.from_date,
                             'to', l.to_date, 'note', clean));

  return jsonb_build_object('id', l.id, 'user_id', l.user_id, 'status', outcome, 'kind', l.kind,
                            'from_date', l.from_date, 'to_date', l.to_date, 'note', clean);
end;
$$;

-- Every HR change is audited, like an admin's or a supervisor's.
create or replace function public.write_audit(
  p_action text,
  p_target_table text default null,
  p_target_id uuid default null,
  p_meta jsonb default '{}'::jsonb,
  p_context jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  c record;
begin
  if not (public.is_admin() or exists (select 1 from public.profiles
                                       where id = auth.uid() and role in ('supervisor', 'hr') and is_active)) then
    raise exception 'Admins, HR and supervisors only';
  end if;
  select * into c from public.audit_context_columns(p_context);
  insert into public.audit_log (actor_id, action, target_table, target_id, meta,
                                ip, user_agent, device, lat, lng, accuracy_m, location_source, place, country, vpn)
  values (auth.uid(), p_action, p_target_table, p_target_id, coalesce(p_meta, '{}'::jsonb),
          c.ip, c.user_agent, c.device, c.lat, c.lng, c.accuracy_m, c.location_source, c.place, c.country, c.vpn)
  returning id into new_id;
  return new_id;
end;
$$;

select 'HR role (0072) installed' as result;
