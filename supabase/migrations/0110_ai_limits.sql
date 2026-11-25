-- =====================================================================
-- XTEND migration 0110 — How much each person may use the AI
--
-- Each AI answer is paid for by the key the admin added (0102). The staff
-- helper and Ask Xtend had an hourly limit kept in the server's memory,
-- which reset whenever the server restarted. Now each person has an hourly
-- and a daily limit per feature, kept in the database:
--
--   * ai_limits: per feature ('staff_helper', 'admin_assistant') the most
--     answers one person may get in an hour and in a day (Lagos), set by
--     admins on Settings → AI keys; defaults 15 / 40 for the staff helper and
--     40 / 200 for Ask Xtend;
--   * ai_usage: one row per answer asked for (person, feature, time), kept
--     3 days;
--   * consume_ai_use(user, feature) counts the last hour and today, and
--     either records one more use (ok) or says which limit was reached;
--   * both tables: row level security on, no grants: the server alone.
--
-- Rerunnable.
-- =====================================================================

create table if not exists public.ai_limits (
  feature text primary key check (feature in ('staff_helper', 'admin_assistant')),
  per_hour integer not null check (per_hour between 1 and 1000),
  per_day integer not null check (per_day between 1 and 10000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check (per_day >= per_hour)
);
insert into public.ai_limits (feature, per_hour, per_day) values
  ('staff_helper', 15, 40),
  ('admin_assistant', 40, 200)
on conflict (feature) do nothing;

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  feature text not null check (feature in ('staff_helper', 'admin_assistant')),
  used_at timestamptz not null default now()
);
create index if not exists ai_usage_user_feature_time on public.ai_usage (user_id, feature, used_at desc);

alter table public.ai_limits enable row level security;
alter table public.ai_usage enable row level security;
revoke all on public.ai_limits, public.ai_usage from anon, authenticated;

-- One more use, if the person is within their limits. The server calls it
-- (service role) before asking the AI.
create or replace function public.consume_ai_use(p_user uuid, p_feature text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  lim record;
  in_hour integer;
  in_day integer;
  day_start timestamptz := ((now() at time zone 'Africa/Lagos')::date)::timestamp at time zone 'Africa/Lagos';
begin
  select per_hour, per_day into lim from public.ai_limits where feature = p_feature;
  if lim.per_hour is null then
    lim := row(case when p_feature = 'staff_helper' then 15 else 40 end,
               case when p_feature = 'staff_helper' then 40 else 200 end);
  end if;
  -- One person at a time, so two quick requests cannot both slip under it.
  perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_user::text || ':' || p_feature));
  select count(*) filter (where used_at > now() - interval '1 hour'),
         count(*) filter (where used_at >= day_start)
    into in_hour, in_day
  from public.ai_usage
  where user_id = p_user and feature = p_feature and used_at > least(day_start, now() - interval '1 hour');
  if in_day >= lim.per_day then
    return jsonb_build_object('ok', false, 'period', 'day', 'limit', lim.per_day, 'used', in_day);
  end if;
  if in_hour >= lim.per_hour then
    return jsonb_build_object('ok', false, 'period', 'hour', 'limit', lim.per_hour, 'used', in_hour);
  end if;
  insert into public.ai_usage (user_id, feature) values (p_user, p_feature);
  -- Now and then, forget uses older than 3 days.
  if random() < 0.02 then
    delete from public.ai_usage where used_at < now() - interval '3 days';
  end if;
  return jsonb_build_object('ok', true, 'left_hour', lim.per_hour - in_hour - 1, 'left_day', lim.per_day - in_day - 1);
end;
$$;
revoke all on function public.consume_ai_use(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_ai_use(uuid, text) to service_role;

select 'AI limits per person (0110) installed' as result;
