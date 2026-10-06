import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Profile photos (migration 037) live in the private "avatars" bucket.
 * Pages read them through signed links that expire after an hour; storage
 * RLS decides whose photos this session may see (their own, an admin's
 * everyone, a supervisor's team).
 */
export async function avatarUrls(
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(userIds)].filter(Boolean)
  if (!ids.length) return out
  try {
    const { data: rows } = await supabase
      .from('profiles')
      .select('id, avatar_path')
      .in('id', ids)
      .not('avatar_path', 'is', null)
    const withPhoto = ((rows ?? []) as { id: string; avatar_path: string }[]).filter((r) => r.avatar_path)
    if (!withPhoto.length) return out
    const { data: signed } = await supabase.storage
      .from('avatars')
      .createSignedUrls(withPhoto.map((r) => r.avatar_path), 3600)
    const byPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
    for (const r of withPhoto) {
      const url = byPath.get(r.avatar_path)
      if (url) out.set(r.id, url)
    }
  } catch {
    // Before migration 037, or storage unreachable: names and initials only.
  }
  return out
}

/** The same rows, each with its person's photo link (or null). */
export async function withAvatars<T extends { user_id: string }>(
  supabase: SupabaseClient,
  rows: T[],
): Promise<(T & { avatar_url: string | null })[]> {
  const urls = await avatarUrls(
    supabase,
    rows.map((r) => r.user_id),
  )
  return rows.map((r) => ({ ...r, avatar_url: urls.get(r.user_id) ?? null }))
}
