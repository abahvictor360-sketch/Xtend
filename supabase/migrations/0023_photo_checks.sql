-- =====================================================================
-- XTEND migration 023 — photos are checked before they count
--
-- Every selfie and shelf photo is looked at by the server (the app's
-- /api/photo-check) before it can be used: a photo of a phone or computer
-- screen, a printed photo, a selfie with no face, or a shelf photo with no
-- products is rejected, and the person retakes it.
--
-- The verdict lives here, written by the server only. A clock-in, store
-- visit or store count whose photo has no verdict, or a rejected one, is
-- refused, so skipping the check by talking to the database directly
-- does not work. If the checking service was down the photo is recorded as
-- 'unchecked' and allowed, with an integrity flag, so an outage never
-- stops anybody clocking in.
-- =====================================================================

-- 023 builds on 022. Say so plainly rather than fail halfway.
do $$
begin
  if to_regclass('public.integrity_flags') is null then
    raise exception 'Run the integrity checks update (022, four parts) first, then this file';
  end if;
end $$;

create table if not exists public.photo_checks (
  path       text primary key,
  bucket     text not null check (bucket in ('selfies', 'reports')),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('selfie', 'shelf')),
  verdict    text not null check (verdict in ('pass', 'reject', 'unchecked')),
  problem    text,
  message    text,
  created_at timestamptz not null default now()
);

create index if not exists photo_checks_by_user on public.photo_checks (user_id, created_at desc);

alter table public.photo_checks enable row level security;
-- No policies: only the server (service role) reads or writes verdicts.
revoke all on public.photo_checks from anon, authenticated;

-- Two more kinds of flag: a rejected photo, and one that could not be checked.
alter table public.integrity_flags drop constraint if exists integrity_flags_kind_check;
alter table public.integrity_flags add constraint integrity_flags_kind_check check (kind in (
  'repeated_exact_location', 'perfect_accuracy', 'impossible_journey',
  'count_units_missing', 'count_identical', 'count_round_numbers',
  'photo_rejected', 'photo_unchecked'));

-- What the check said about a photo: 'pass', 'reject', 'unchecked', or null.
create or replace function public.photo_verdict(p_path text)
returns text
language sql stable security definer set search_path = public as $$
  select verdict from public.photo_checks where path = p_path;
$$;

revoke all on function public.photo_verdict(text) from public, anon, authenticated;

-- Fresh, theirs, and not rejected. Used by store counts (022) as before;
-- it now also needs a verdict that is not a rejection.
create or replace function public.photo_is_fresh(p_bucket text, p_path text, p_minutes integer)
returns boolean
language sql stable security definer set search_path = public, storage as $$
  select auth.uid() is not null
     and p_path like auth.uid()::text || '/%'
     and exists (
       select 1 from storage.objects o
       where o.bucket_id = p_bucket
         and o.name = p_path
         and o.created_at >= now() - make_interval(mins => p_minutes)
     )
     and coalesce(public.photo_verdict(p_path), 'none') in ('pass', 'unchecked');
$$;

revoke all on function public.photo_is_fresh(text, text, integer) from public, anon, authenticated;

-- Clock-ins and store visits, with a clear message for each way to fail.
create or replace function public.selfie_check()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if new.selfie_path is null then
    if tg_table_name = 'attendance' then
      raise exception 'A clock-in needs a selfie taken in the app';
    end if;
    return new;
  end if;

  if public.photo_verdict(new.selfie_path) = 'reject' then
    raise exception 'That selfie was rejected. Take a new one, live, of your face';
  end if;
  if public.photo_verdict(new.selfie_path) is null then
    raise exception 'The selfie has not been checked. Take it again in the app';
  end if;

  if not public.photo_is_fresh('selfies', new.selfie_path, 30)
     or (new.thumb_path is not null and not public.photo_is_fresh('selfies', new.thumb_path, 30)) then
    raise exception 'The selfie must be taken in the app just now';
  end if;

  if public.photo_already_used(new.selfie_path)
     or (new.thumb_path is not null and public.photo_already_used(new.thumb_path)) then
    raise exception 'That selfie has already been used';
  end if;

  return new;
end;
$$;

revoke all on function public.selfie_check() from public, anon, authenticated;

select 'Photo checks (023) installed' as result;
