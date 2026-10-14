-- =====================================================================
-- 0057: Updates
--
-- The apps load the live site, so a new release reaches a phone the next
-- time its page loads. This adds what the update screens need:
--   * app_releases: "What's new" notes an admin publishes, which can mark
--     an update as required and set the lowest Android / iPhone app build
--     that may still be used (older builds are asked to install the new
--     one before carrying on);
--   * app_installs: which app build and site version each person last
--     used, so the office can see who is still on an old app.
-- =====================================================================

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  notes text not null default '' check (length(notes) <= 3000),
  -- Who sees the notes: everyone, field staff only, or the office only.
  audience text not null default 'everyone' check (audience in ('everyone', 'field', 'office')),
  -- Everyone on an older version must update before carrying on.
  required boolean not null default false,
  -- Phone apps older than these builds must be replaced.
  min_android_build integer check (min_android_build is null or min_android_build > 0),
  min_ios_build integer check (min_ios_build is null or min_ios_build > 0),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);
create index if not exists app_releases_by_time on public.app_releases (created_at desc);
alter table public.app_releases enable row level security;

drop policy if exists app_releases_read on public.app_releases;
create policy app_releases_read on public.app_releases
  for select to authenticated
  using (withdrawn_at is null or public.is_admin());
drop policy if exists app_releases_admin_insert on public.app_releases;
create policy app_releases_admin_insert on public.app_releases
  for insert to authenticated
  with check (public.is_admin() and created_by = auth.uid());
drop policy if exists app_releases_admin_update on public.app_releases;
create policy app_releases_admin_update on public.app_releases
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.app_releases to authenticated;

create table if not exists public.app_installs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android', 'ios', 'web')),
  app_version text check (app_version is null or length(app_version) <= 40),
  app_build integer check (app_build is null or app_build >= 0),
  web_build text check (web_build is null or length(web_build) <= 80),
  last_seen timestamptz not null default now(),
  primary key (user_id, platform)
);
alter table public.app_installs enable row level security;

-- Admins see everyone's; a supervisor their own team's; anyone their own.
drop policy if exists app_installs_read on public.app_installs;
create policy app_installs_read on public.app_installs
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.supervises_user(user_id));
grant select on public.app_installs to authenticated;
-- Written only through report_app_install().

-- What the signed-in person's phone or browser is running. At most once a
-- minute per platform, so a busy page does not write on every check.
create or replace function public.report_app_install(
  p_platform text, p_app_version text, p_app_build integer, p_web_build text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null or p_platform not in ('android', 'ios', 'web') then
    return;
  end if;
  insert into public.app_installs (user_id, platform, app_version, app_build, web_build, last_seen)
  values (me, p_platform, left(nullif(p_app_version, ''), 40),
          case when p_app_build >= 0 then p_app_build end, left(nullif(p_web_build, ''), 80), now())
  on conflict (user_id, platform) do update
    set app_version = excluded.app_version,
        app_build = excluded.app_build,
        web_build = excluded.web_build,
        last_seen = now()
    where public.app_installs.last_seen < now() - interval '1 minute'
       or public.app_installs.app_build is distinct from excluded.app_build
       or public.app_installs.web_build is distinct from excluded.web_build;
end;
$$;
revoke all on function public.report_app_install(text, text, integer, text) from public, anon;
grant execute on function public.report_app_install(text, text, integer, text) to authenticated;

-- The lowest phone-app builds still allowed: the highest any live release set.
create or replace view public.app_minimum_builds
with (security_invoker = true) as
  select max(min_android_build) as android, max(min_ios_build) as ios
  from public.app_releases
  where withdrawn_at is null;
grant select on public.app_minimum_builds to authenticated;

select 'App updates (057) installed' as result;
