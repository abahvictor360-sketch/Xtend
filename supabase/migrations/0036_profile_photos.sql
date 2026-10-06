-- =====================================================================
-- XTEND migration 036 — profile photos and first-run onboarding
--
-- Field staff take a profile photo in the app (onboarding asks for it
-- first). Admins and their supervisor see it beside the person's name and
-- on the movement map. The photo lives in a private "avatars" bucket under
-- avatars/<user id>/..., readable by the person, admins, and whoever
-- supervises them; pages read it through short-lived signed URLs.
--
-- profiles.onboarded_at marks that the person finished the first-run
-- walkthrough, so it is shown once.
-- =====================================================================

alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists onboarded_at timestamptz;

insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
  on conflict do nothing;

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects
  for select using (
    bucket_id = 'avatars'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(((storage.foldername(name))[1])::uuid)
    )
  );

-- A person's own photo. The path must be in their own folder and the file
-- must already be uploaded; nobody can point their profile at somebody
-- else's picture.
create or replace function public.set_my_avatar(p_path text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_path is null or p_path not like uid::text || '/%' then
    raise exception 'That photo is not yours';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then
    raise exception 'Upload the photo first';
  end if;
  perform set_config('xtend.own_photo', 'on', true);
  update public.profiles set avatar_path = p_path where id = uid;
end;
$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- The walkthrough is done. Once set, it stays set.
create or replace function public.finish_onboarding()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles set onboarded_at = coalesce(onboarded_at, now()) where id = auth.uid();
end;
$$;

revoke all on function public.finish_onboarding() from public, anon;
grant execute on function public.finish_onboarding() to authenticated;

-- People still cannot change their own store, supervisor, active status or
-- exemption (027); the photo now only changes through set_my_avatar.
create or replace function public.profiles_self_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or new.id <> auth.uid() then
    return new;
  end if;
  new.role          := old.role;
  new.outlet_id     := old.outlet_id;
  new.supervisor_id := old.supervisor_id;
  new.is_active     := old.is_active;
  new.push_exempt   := old.push_exempt;
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_self_guard() from public, anon, authenticated;

select 'Profile photos and onboarding (036) installed' as result;
