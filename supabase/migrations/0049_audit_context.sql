-- =====================================================================
-- 0049: Where and on what each admin action was done
--
-- Every audit row now records the request it came from:
--   * the IP address, and whether it is a VPN or datacentre address;
--   * the device: browser, operating system, phone or computer, and
--     whether it was the Xtend app;
--   * the location: from the browser (when the admin allowed it) or,
--     failing that, roughly from the IP address; with the store or known
--     place it falls in, when there is one.
-- Supervisors' actions are now recorded too.
-- =====================================================================

alter table public.audit_log add column if not exists ip text check (ip is null or length(ip) <= 64);
alter table public.audit_log add column if not exists user_agent text check (user_agent is null or length(user_agent) <= 500);
alter table public.audit_log add column if not exists device jsonb;
alter table public.audit_log add column if not exists lat double precision check (lat is null or lat between -90 and 90);
alter table public.audit_log add column if not exists lng double precision check (lng is null or lng between -180 and 180);
alter table public.audit_log add column if not exists accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0);
alter table public.audit_log add column if not exists location_source text check (location_source is null or location_source in ('browser', 'ip'));
alter table public.audit_log add column if not exists place text check (place is null or length(place) <= 200);
alter table public.audit_log add column if not exists country text check (country is null or length(country) <= 8);
alter table public.audit_log add column if not exists vpn boolean;

create index if not exists audit_log_by_actor on public.audit_log (actor_id, created_at desc);
create index if not exists audit_log_by_time on public.audit_log (created_at desc);

-- The context as the server read it: {ip, user_agent, device, lat, lng,
-- accuracy_m, location_source, country, vpn}. Anything malformed is left out.
create or replace function public.audit_context_columns(p jsonb)
returns table (ip text, user_agent text, device jsonb, lat double precision, lng double precision,
               accuracy_m double precision, location_source text, place text, country text, vpn boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  la double precision;
  ln double precision;
  where_name text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return query select null::text, null::text, null::jsonb, null::float8, null::float8, null::float8,
                        null::text, null::text, null::text, null::boolean;
    return;
  end if;
  if jsonb_typeof(p->'lat') = 'number' and jsonb_typeof(p->'lng') = 'number'
     and abs((p->>'lat')::float8) <= 90 and abs((p->>'lng')::float8) <= 180 then
    la := (p->>'lat')::float8;
    ln := (p->>'lng')::float8;
    -- The store or known place the action was done in, if any.
    select o.name into where_name from public.outlets o where o.id = public.outlet_containing(la, ln);
    if where_name is null then
      select k.name into where_name from public.known_place_at(la, ln) k where k.source <> 'clock_in';
    end if;
  end if;
  return query select
    left(nullif(p->>'ip', ''), 64),
    left(nullif(p->>'user_agent', ''), 500),
    case when jsonb_typeof(p->'device') = 'object' then p->'device' end,
    la, ln,
    case when la is not null and jsonb_typeof(p->'accuracy_m') = 'number' and (p->>'accuracy_m')::float8 >= 0
         then (p->>'accuracy_m')::float8 end,
    case when la is not null and p->>'location_source' in ('browser', 'ip') then p->>'location_source' end,
    left(where_name, 200),
    left(nullif(p->>'country', ''), 8),
    case when jsonb_typeof(p->'vpn') = 'boolean' then (p->>'vpn')::boolean end;
end;
$$;
revoke all on function public.audit_context_columns(jsonb) from public, anon, authenticated;
grant execute on function public.audit_context_columns(jsonb) to service_role;

drop function if exists public.write_audit(text, text, uuid, jsonb);
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
                                       where id = auth.uid() and role = 'supervisor' and is_active)) then
    raise exception 'Admins and supervisors only';
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
revoke all on function public.write_audit(text, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.write_audit(text, text, uuid, jsonb, jsonb) to authenticated, service_role;

-- Rows written straight by the server (service role) carry the context in
-- meta._context. Rows written inside SQL functions (store allocation, count
-- requests) take it from the x-xt-audit header the server sends with every
-- request (base64 JSON), when PostgREST passes it on.
create or replace function public.audit_fill_context()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c record;
  ctx jsonb;
begin
  if new.meta ? '_context' then
    ctx := new.meta->'_context';
  elsif new.ip is null and new.user_agent is null then
    begin
      ctx := convert_from(decode(
               nullif(current_setting('request.headers', true), '')::jsonb->>'x-xt-audit', 'base64'), 'utf8')::jsonb;
    exception when others then
      ctx := null;
    end;
  end if;
  if ctx is not null then
    select * into c from public.audit_context_columns(ctx);
    new.ip := coalesce(new.ip, c.ip);
    new.user_agent := coalesce(new.user_agent, c.user_agent);
    new.device := coalesce(new.device, c.device);
    new.lat := coalesce(new.lat, c.lat);
    new.lng := coalesce(new.lng, c.lng);
    new.accuracy_m := coalesce(new.accuracy_m, c.accuracy_m);
    new.location_source := coalesce(new.location_source, c.location_source);
    new.place := coalesce(new.place, c.place);
    new.country := coalesce(new.country, c.country);
    new.vpn := coalesce(new.vpn, c.vpn);
  end if;
  new.meta := coalesce(new.meta, '{}'::jsonb) - '_context';
  return new;
end;
$$;
drop trigger if exists trg_audit_fill_context on public.audit_log;
create trigger trg_audit_fill_context before insert on public.audit_log
  for each row execute function public.audit_fill_context();

-- For the Audit log page: the row with who did it.
create or replace view public.audit_log_detail
with (security_invoker = true) as
  select a.*, p.full_name as actor_name, p.role::text as actor_role
  from public.audit_log a
  left join public.profiles p on p.id = a.actor_id;
grant select on public.audit_log_detail to authenticated;

select 'Audit context (049) installed' as result;
