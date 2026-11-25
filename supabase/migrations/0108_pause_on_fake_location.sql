-- =====================================================================
-- XTEND migration 0108 — A fake location pauses the account
--
-- When the phone reports that its location comes from a fake-GPS app
-- (integrity flag 'mock_location_confirmed', from a clock-in or from the
-- app's background positions), the person can no longer use Xtend:
--
--   * profiles.paused_at / paused_reason ('fake_location') / paused_flag
--     (the flag that caused it) are set at once, by trigger;
--   * their tracking tokens end, so the phone's tracker stops;
--   * is_active_staff() is false for them, so the data stays closed;
--   * the app signs them out and says: "Your account is paused. Contact
--     your supervisor or admin." (src/lib/auth.ts, /api/auth/paused);
--   * the clock-in that showed it stays, with its photo and the flag, as
--     evidence for the conversation;
--   * an admin, or their supervisor, lifts it with unpause_staff() (Staff
--     → Unpause), written to the audit log. Staff cannot lift it.
--
-- Only merchandisers and marketers are paused. Rerunnable.
-- =====================================================================

alter table public.profiles add column if not exists paused_at timestamptz;
alter table public.profiles add column if not exists paused_reason text;
alter table public.profiles add column if not exists paused_flag uuid;
comment on column public.profiles.paused_at is
  'When the account was paused for a fake location (0108); null when not paused.';

create or replace function public.profiles_self_guard()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() or new.id <> auth.uid() then
    return new;
  end if;
  new.role          := old.role;
  new.staff_role_id := old.staff_role_id;
  new.outlet_id     := old.outlet_id;
  new.supervisor_id := old.supervisor_id;
  new.is_active     := old.is_active;
  new.push_exempt   := old.push_exempt;
  new.app_only      := old.app_only;
  -- 0100: their working hours are set by the office; 0105: and the window.
  new.shift_start    := old.shift_start;
  new.shift_end      := old.shift_end;
  new.clock_out_from := old.clock_out_from;
  -- 0108: a pause for a fake location is lifted by the office only. (The
  -- pause itself is set by trigger in the person's own request, so only
  -- lifting or changing one is blocked here.)
  if old.paused_at is not null then
    new.paused_at     := old.paused_at;
    new.paused_reason := old.paused_reason;
    new.paused_flag   := old.paused_flag;
  elsif coalesce(current_setting('xtend.pausing', true), '') <> 'on' then
    new.paused_at     := null;
    new.paused_reason := null;
    new.paused_flag   := null;
  end if;
  if coalesce(current_setting('xtend.own_photo', true), '') <> 'on' then
    new.avatar_path := old.avatar_path;
  end if;
  return new;
end;
$$;

-- The flag pauses the account.
create or replace function public.pause_for_fake_location()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  paused boolean;
begin
  if new.kind <> 'mock_location_confirmed' or new.user_id is null then
    return null;
  end if;
  perform set_config('xtend.pausing', 'on', true);
  update public.profiles
     set paused_at = now(), paused_reason = 'fake_location', paused_flag = new.id
   where id = new.user_id and paused_at is null
     and role in ('merchandiser', 'marketer');
  paused := found;
  perform set_config('xtend.pausing', '', true);
  if paused then
    update public.tracking_tokens set revoked_at = now()
     where user_id = new.user_id and revoked_at is null;
  end if;
  return null;
end;
$$;
revoke all on function public.pause_for_fake_location() from public, anon, authenticated;

drop trigger if exists trg_integrity_flags_pause on public.integrity_flags;
create trigger trg_integrity_flags_pause
  after insert on public.integrity_flags
  for each row execute function public.pause_for_fake_location();

-- A paused account is not active staff: nothing to read or write.
create or replace function public.is_active_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active and p.paused_at is null);
$$;
revoke all on function public.is_active_staff() from public, anon;
grant execute on function public.is_active_staff() to authenticated, service_role;

-- Lifting it: an admin, or the person's own supervisor. Audited.
create or replace function public.unpause_staff(p_user uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  was record;
begin
  if not public.can_unlock_sign_in(p_user) then
    raise exception 'You can only unpause your own team';
  end if;
  select paused_at, paused_reason, paused_flag into was from public.profiles where id = p_user;
  if was.paused_at is null then
    return false;
  end if;
  update public.profiles set paused_at = null, paused_reason = null, paused_flag = null where id = p_user;
  insert into public.audit_log (actor_id, action, target_table, target_id, meta)
  values (auth.uid(), 'user.unpause', 'profiles', p_user,
          jsonb_build_object('reason', was.paused_reason, 'paused_at', was.paused_at, 'flag', was.paused_flag));
  return true;
end;
$$;
revoke all on function public.unpause_staff(uuid) from public, anon;
grant execute on function public.unpause_staff(uuid) to authenticated;

select 'A fake location pauses the account (0108) installed' as result;
