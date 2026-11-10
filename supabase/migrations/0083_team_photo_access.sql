-- =====================================================================
-- XTEND migration 0083 — supervisors and HR can open their people's photos
--
-- Clock-in selfies (the "selfies" bucket), shelf, count and place photos
-- (the "reports" bucket) and profile photos (the "avatars" bucket) could
-- only be read by the person who took them and by admins. A supervisor
-- checking a flagged photo, or HR looking through attendance, got no image.
-- Now a photo can also be opened by:
--
--   * the person's supervisor (supervises_user: their own team only);
--   * HR (hr_sees: every field and office person except admins);
--   * an admin, as before, and the person themselves.
--
-- Nothing else changes: uploads stay in the owner's own folder, deleting
-- and overwriting rules are untouched, and a signed-out visitor still
-- reads nothing (the policies are now for signed-in people only, so the
-- helper functions they call are never asked of a signed-out visitor).
--
-- The first folder of every path is the owner's id. safe_uuid() turns a
-- folder that is not an id into null instead of an error, so a stray file
-- can never break a listing.
--
-- Rerunnable.
-- =====================================================================

drop policy if exists selfies_read on storage.objects;
create policy selfies_read on storage.objects for select to authenticated
  using (
    bucket_id = 'selfies' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(public.safe_uuid((storage.foldername(name))[1]))
      or public.hr_sees(public.safe_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists reports_read on storage.objects;
create policy reports_read on storage.objects for select to authenticated
  using (
    bucket_id = 'reports' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(public.safe_uuid((storage.foldername(name))[1]))
      or public.hr_sees(public.safe_uuid((storage.foldername(name))[1]))
    )
  );

drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated
  using (
    bucket_id = 'avatars' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or public.supervises_user(public.safe_uuid((storage.foldername(name))[1]))
      or public.hr_sees(public.safe_uuid((storage.foldername(name))[1]))
    )
  );

select 'Team photo access (0083) installed' as result;
