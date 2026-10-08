-- =====================================================================
-- XTEND migration 044 — which roles take store counts
--
-- An admin chooses, per role, whether its people take store counts (the
-- month-end count and counts a supervisor asks for). Plaza roles such as
-- Sales Rep serve customers and do not count.
--
--   * Built-in Merchandiser and Marketer: role_store_counts, one row each.
--   * Added roles: staff_roles.counts_stock.
--   * can_count_stock() follows the setting, so the count form, the month-
--     end window and every count function close for roles that do not
--     count. Admins still can.
--   * A supervisor cannot ask someone in such a role to count.
--   * X Metrics stock and sales are separate from store counts: they keep
--     their own check (xm_can_submit), unchanged in effect.
-- =====================================================================

alter table public.staff_roles add column if not exists counts_stock boolean not null default true;

create table if not exists public.role_store_counts (
  role          user_role primary key check (role in ('merchandiser', 'marketer')),
  counts_stock  boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into public.role_store_counts (role) values ('merchandiser'), ('marketer')
  on conflict (role) do nothing;

alter table public.role_store_counts enable row level security;
create policy role_store_counts_read on public.role_store_counts
  for select using (auth.uid() is not null);
create policy role_store_counts_admin on public.role_store_counts
  for update using (public.is_admin()) with check (public.is_admin());
-- No insert policy and no removal policy: the two rows are fixed.

-- Whether a person takes store counts: admins always; merchandisers and
-- marketers as their role is set (an added role's own setting, else the
-- built-in one).
create or replace function public.person_counts_stock(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select p.is_active and (
      p.role = 'admin'::user_role
      or (p.role in ('merchandiser'::user_role, 'marketer'::user_role)
          and coalesce(sr.counts_stock, b.counts_stock, true)))
    from public.profiles p
    left join public.staff_roles sr on sr.id = p.staff_role_id
    left join public.role_store_counts b on b.role = p.role
    where p.id = target), false);
$$;
revoke all on function public.person_counts_stock(uuid) from public, anon;
grant execute on function public.person_counts_stock(uuid) to authenticated, service_role;

create or replace function public.can_count_stock()
returns boolean
language sql stable security definer set search_path = public as $$
  select public.person_counts_stock(auth.uid());
$$;

-- X Metrics keeps the rule store counts had before this file: active field
-- staff and admins.
create or replace function public.xm_can_submit()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select is_active and role in ('merchandiser'::user_role, 'marketer'::user_role,
                                   'admin'::user_role)
     from public.profiles where id = auth.uid()),
    false);
$$;
revoke all on function public.xm_can_submit() from public, anon;
grant execute on function public.xm_can_submit() to authenticated, service_role;

create or replace function public.xm_check_field_submission(p_outlet uuid, p_captured_at timestamptz)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.xm_can_submit() then
    raise exception 'You cannot submit stock or sales';
  end if;
  if not exists (select 1 from public.xm_stores where outlet_id = p_outlet and is_active) then
    raise exception 'That store is not in X Metrics yet. Ask your supervisor';
  end if;
  if p_outlet not in (select outlet_id from public.outlets_for_user(auth.uid())) then
    raise exception 'That store is not one of yours';
  end if;
  -- Kept on the phone while offline, but not for days.
  if p_captured_at is null or p_captured_at > now() + interval '2 minutes'
     or p_captured_at < now() - interval '72 hours' then
    raise exception 'Invalid capture time: it must be within the last 3 days';
  end if;
end;
$$;
revoke all on function public.xm_check_field_submission(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.request_store_count(
  p_user_ids uuid[],
  p_due_date date,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  wanted uuid[] := coalesce(p_user_ids, '{}'::uuid[]);
  new_id uuid;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.is_active or me.role not in ('admin'::user_role, 'supervisor'::user_role) then
    raise exception 'Only a supervisor or an admin can ask for a store count';
  end if;
  if array_length(wanted, 1) is null then
    raise exception 'Pick at least one person to count';
  end if;
  if p_due_date is null or p_due_date < public.business_date() then
    raise exception 'The due date cannot be in the past';
  end if;
  if p_due_date > public.business_date() + 60 then
    raise exception 'The due date must be within 60 days';
  end if;

  if exists (
    select 1 from unnest(wanted) as w(id)
    left join public.profiles p on p.id = w.id
    where p.id is null
       or not p.is_active
       or p.role not in ('merchandiser'::user_role, 'marketer'::user_role)
       or not (me.role = 'admin' or public.supervises_user(p.id))
  ) then
    raise exception 'You can only ask your own active merchandisers and marketers to count';
  end if;
  if exists (select 1 from unnest(wanted) as w(id) where not public.person_counts_stock(w.id)) then
    raise exception 'Someone you picked is in a role that does not take store counts';
  end if;

  insert into public.count_requests (requested_by, due_date, note)
  values (me.id, p_due_date, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into new_id;

  insert into public.count_request_targets (request_id, user_id)
  select distinct new_id, w.id from unnest(wanted) as w(id);

  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (me.id, 'store_count.request', 'count_requests', new_id,
          jsonb_build_object('user_ids', to_jsonb(wanted), 'due_date', p_due_date));

  return new_id;
end;
$$;

revoke all on function public.request_store_count(uuid[], date, text) from public, anon;
grant execute on function public.request_store_count(uuid[], date, text) to authenticated, service_role;
