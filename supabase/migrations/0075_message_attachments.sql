-- =====================================================================
-- 0075  Message attachments
--
-- A message (0073) may carry one picture or one PDF. The sender uploads the
-- file to the private "message-files" bucket under their own folder first,
-- then send_message records it on the message. A message with an attachment
-- may have no words. The office and staff open an attachment through a
-- short-lived signed link, gated by the same can_message rule as the words.
-- =====================================================================

alter table public.messages
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text,
  add column if not exists attachment_size_bytes integer,
  add column if not exists attachment_kind text;

-- A message now needs words or an attachment, not always words.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (
  length(btrim(body)) <= 2000
  and (length(btrim(body)) >= 1 or attachment_path is not null)
);

-- The attachment's five columns are all there or all absent, and a picture
-- or a PDF up to 10 MB.
alter table public.messages drop constraint if exists messages_attachment_check;
alter table public.messages add constraint messages_attachment_check check (
  (attachment_path is null and attachment_name is null and attachment_mime is null
   and attachment_size_bytes is null and attachment_kind is null)
  or
  (attachment_path is not null and attachment_name is not null and attachment_mime is not null
   and attachment_size_bytes between 1 and 10485760 and attachment_kind in ('image', 'pdf'))
);

-- ---------------------------------------------------------------------
-- Storage. The real gate is the message row's RLS, read in the download
-- route before a link is signed, exactly as report files and selfies work.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('message-files', 'message-files', false)
on conflict (id) do nothing;

drop policy if exists message_files_insert_own on storage.objects;
create policy message_files_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'message-files' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists message_files_read on storage.objects;
create policy message_files_read on storage.objects for select to authenticated
  using (bucket_id = 'message-files');

-- ---------------------------------------------------------------------
-- send_message, now able to carry an attachment. p_attachment is
-- {path, name, mime, size} for a file the caller has just uploaded to
-- their own folder; the kind (picture or PDF) is worked out from the type.
-- ---------------------------------------------------------------------
drop function if exists public.send_message(uuid, text);
create or replace function public.send_message(p_staff uuid, p_body text, p_attachment jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, storage as $$
declare
  me public.profiles;
  staff uuid;
  clean text := btrim(coalesce(p_body, ''));
  t uuid;
  m uuid;
  a_path text;
  a_name text;
  a_mime text;
  a_size integer;
  a_kind text;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.is_active then
    raise exception 'Sign in first';
  end if;
  staff := case when public.is_field_role(me.role) then me.id else p_staff end;
  if staff is null or not public.can_message(staff) then
    raise exception 'You can only message your own team';
  end if;
  if not exists (select 1 from public.profiles where id = staff and is_active) then
    raise exception 'That person''s account is not active';
  end if;

  if p_attachment is not null and jsonb_typeof(p_attachment) = 'object' then
    a_path := p_attachment->>'path';
    a_name := left(btrim(coalesce(p_attachment->>'name', '')), 200);
    a_mime := lower(btrim(coalesce(p_attachment->>'mime', '')));
    a_size := nullif(p_attachment->>'size', '')::integer;
    if a_mime = 'application/pdf' then
      a_kind := 'pdf';
    elsif a_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
      a_kind := 'image';
    else
      raise exception 'Attach a picture or a PDF';
    end if;
    if a_path is null or a_path not like (me.id::text || '/%') then
      raise exception 'That attachment is not yours';
    end if;
    if a_size is null or a_size < 1 or a_size > 10485760 then
      raise exception 'Each attachment must be 10 MB or smaller';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'message-files' and name = a_path) then
      raise exception 'Upload the attachment before sending';
    end if;
    if a_name = '' then
      a_name := case when a_kind = 'pdf' then 'document.pdf' else 'picture' end;
    end if;
  end if;

  if length(clean) < 1 and a_path is null then
    raise exception 'Write your message first';
  end if;
  if length(clean) > 2000 then
    raise exception 'Keep the message under 2,000 characters';
  end if;

  insert into public.message_threads (staff_id) values (staff)
  on conflict (staff_id) do nothing;
  select id into t from public.message_threads where staff_id = staff;

  insert into public.messages
    (thread_id, sender_id, body, attachment_path, attachment_name, attachment_mime,
     attachment_size_bytes, attachment_kind)
  values (t, me.id, clean, a_path, a_name, a_mime, a_size, a_kind)
  returning id into m;
  update public.message_threads set last_message_at = now(), last_sender_id = me.id where id = t;
  insert into public.message_reads (thread_id, user_id, read_at) values (t, me.id, clock_timestamp())
  on conflict (thread_id, user_id) do update set read_at = excluded.read_at;

  return jsonb_build_object('message_id', m, 'thread_id', t, 'staff_id', staff,
                            'from_staff', staff = me.id, 'has_attachment', a_path is not null,
                            'attachment_kind', a_kind,
                            'supervisor_id', (select supervisor_id from public.profiles where id = staff));
end;
$$;
revoke all on function public.send_message(uuid, text, jsonb) from public, anon;
grant execute on function public.send_message(uuid, text, jsonb) to authenticated;

-- One conversation, now returning each message's attachment too.
drop function if exists public.conversation(uuid);
create or replace function public.conversation(p_staff uuid)
returns table (id uuid, body text, created_at timestamptz, sender_name text,
               from_staff boolean, mine boolean,
               attachment_mime text, attachment_name text,
               attachment_size_bytes integer, attachment_kind text)
language sql stable security definer set search_path = public as $$
  with who as (
    select case when public.is_field_role(public.current_user_role()) then auth.uid() else p_staff end as staff
  )
  select m.id, m.body, m.created_at, coalesce(s.full_name, 'Former staff'),
         m.sender_id = t.staff_id, m.sender_id = auth.uid(),
         m.attachment_mime, m.attachment_name, m.attachment_size_bytes, m.attachment_kind
  from who
  join public.message_threads t on t.staff_id = who.staff
  join public.messages m on m.thread_id = t.id
  left join public.profiles s on s.id = m.sender_id
  where public.can_message(who.staff)
  order by m.created_at
  limit 500;
$$;
revoke all on function public.conversation(uuid) from public, anon;
grant execute on function public.conversation(uuid) to authenticated;

-- The office inbox preview reads "Attachment" when a message is a file only.
create or replace function public.message_inbox()
returns table (staff_id uuid, full_name text, role user_role, outlet_name text,
               supervisor_name text, last_message_at timestamptz, last_body text,
               last_from_staff boolean, unread integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.role, o.name, sup.full_name,
         t.last_message_at,
         (select coalesce(nullif(btrim(m.body), ''), 'Attachment')
          from public.messages m where m.thread_id = t.id order by m.created_at desc limit 1),
         t.last_sender_id = p.id,
         coalesce((select count(*)::integer from public.messages m
                   left join public.message_reads r on r.thread_id = t.id and r.user_id = auth.uid()
                   where m.thread_id = t.id and m.sender_id is distinct from auth.uid()
                     and m.created_at > coalesce(r.read_at, '-infinity'::timestamptz)), 0)
  from public.profiles p
  left join public.outlets o on o.id = p.outlet_id
  left join public.profiles sup on sup.id = p.supervisor_id
  left join public.message_threads t on t.staff_id = p.id
  where p.is_active and public.is_field_role(p.role) and p.id <> auth.uid()
    and public.can_message(p.id)
  order by t.last_message_at desc nulls last, p.full_name;
$$;
revoke all on function public.message_inbox() from public, anon;
grant execute on function public.message_inbox() to authenticated;

select 'Message attachments (0075) installed' as result;
