-- =====================================================================
-- XTEND migration 0079 — security fixes from the November 2026 review
--
-- 1. Only field staff report to a supervisor. Promoting somebody to
--    supervisor, HR or admin used to leave their old supervisor_id in
--    place, and the server's "is this person on my team?" check read that
--    link, so a supervisor could reset the password of (or deactivate) the
--    person who had just been promoted above them. Now any account that is
--    not a merchandiser or marketer never has a supervisor: the link is
--    cleared on the way in, and stale links are cleared once below.
-- 2. Message attachments (0075) were readable by any signed-in person who
--    knew the path. A file is now readable by its uploader, or by whoever
--    may read the message it is on (the same can_message rule as the
--    words: the staff member, their supervisor, HR and admins).
-- 3. outlets_for_user(target) answered for anybody. It now answers only
--    for yourself, somebody you supervise, anyone for an admin, anyone but
--    an admin for HR, and for the server (no signed-in user), which is how
--    the database's own functions and jobs use it.
-- 4. A shelf, count or place photo in the "reports" bucket can no longer be
--    overwritten after it was checked: the owner's update policy is gone.
--    Every upload there uses a fresh name, so nothing needed it.
--
-- Rerunnable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Field staff only have a supervisor.
--
-- Named to sort after every other BEFORE trigger on profiles (Postgres
-- fires them in name order), so it sees the role that
-- trg_profiles_staff_role_sync (0042) has just worked out from an added
-- role.
-- ---------------------------------------------------------------------
create or replace function public.profiles_field_only_reporting()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.supervisor_id is not null and not public.is_field_role(new.role) then
    new.supervisor_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.profiles_field_only_reporting() from public, anon, authenticated;

drop trigger if exists trg_profiles_zz_field_only_reporting on public.profiles;
create trigger trg_profiles_zz_field_only_reporting
  before insert or update on public.profiles
  for each row execute function public.profiles_field_only_reporting();

-- Links left behind by promotions made before this migration.
update public.profiles
set supervisor_id = null
where supervisor_id is not null and not public.is_field_role(role);

-- ---------------------------------------------------------------------
-- 2. Message attachments follow the message.
-- ---------------------------------------------------------------------
create index if not exists messages_by_attachment_path
  on public.messages (attachment_path) where attachment_path is not null;

create or replace function public.message_file_readable(p_name text)
returns boolean
language sql stable security definer set search_path = public, storage as $$
  select (storage.foldername(p_name))[1] = auth.uid()::text
      or exists (select 1
                 from public.messages m
                 join public.message_threads t on t.id = m.thread_id
                 where m.attachment_path = p_name
                   and public.can_message(t.staff_id));
$$;
revoke all on function public.message_file_readable(text) from public, anon;
grant execute on function public.message_file_readable(text) to authenticated, service_role;

drop policy if exists message_files_read on storage.objects;
create policy message_files_read on storage.objects for select to authenticated
  using (bucket_id = 'message-files' and public.message_file_readable(name));

-- ---------------------------------------------------------------------
-- 3. Whose stores you may ask about.
-- ---------------------------------------------------------------------
create or replace function public.outlets_for_user(target uuid)
returns table (outlet_id uuid)
language sql stable security definer set search_path = public as $$
  select o.id
  from public.outlets o
  where (auth.uid() is null
         or target = auth.uid()
         or public.is_admin()
         or public.supervises_user(target)
         or public.hr_sees(target))
    and o.is_active
    and (o.id in (select s.outlet_id from public.staff_outlets s where s.user_id = target)
         or o.id = (select p.outlet_id from public.profiles p where p.id = target));
$$;

revoke all on function public.outlets_for_user(uuid) from public, anon;
grant execute on function public.outlets_for_user(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4. Photos in the reports bucket are never overwritten in place.
-- ---------------------------------------------------------------------
drop policy if exists reports_update_own on storage.objects;

select 'Security fixes (0079) installed' as result;
