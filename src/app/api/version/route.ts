import { createServerSupabase } from '@/lib/supabase/server'
import { publishedAndroidApk } from '@/lib/app-release'
import type { ReleaseNote, VersionInfo } from '@/lib/app-update'

export const dynamic = 'force-dynamic'

const FIELD = new Set(['merchandiser', 'marketer'])

/**
 * What is live now, for UpdateManager: this deploy's build id, the newest
 * phone apps and the lowest builds still allowed, and (signed in) the
 * newest "What's new" for this person. Public: a signed-out page still
 * needs to know it is out of date.
 */
export async function GET() {
  const info: VersionInfo = {
    build: process.env.NEXT_PUBLIC_BUILD_ID ?? '',
    android: { latest_build: null, latest_version: null, minimum: null, url: '/download' },
    ios: { latest_build: null, minimum: null, url: process.env.IOS_APP_URL || null },
    release: null,
  }

  const envAndroid = Number(process.env.ANDROID_LATEST_BUILD)
  if (process.env.ANDROID_APK_URL) {
    info.android.url = process.env.ANDROID_APK_URL
    if (Number.isInteger(envAndroid)) info.android.latest_build = envAndroid
  } else {
    const apk = await publishedAndroidApk()
    if (apk) {
      info.android.latest_build = Number.isInteger(envAndroid) ? envAndroid : apk.build
      info.android.latest_version = apk.version
    }
  }
  const envIos = Number(process.env.IOS_LATEST_BUILD)
  if (Number.isInteger(envIos)) info.ios.latest_build = envIos

  try {
    const supabase = await createServerSupabase()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const [{ data: profile }, { data: minimum }, { data: releases }] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
        supabase.from('app_minimum_builds').select('android, ios').maybeSingle(),
        supabase
          .from('app_releases')
          .select('id, title, notes, required, audience, created_at')
          .is('withdrawn_at', null)
          .order('created_at', { ascending: false })
          .limit(5),
      ])
      const field = FIELD.has((profile as { role?: string } | null)?.role ?? '')
      info.android.minimum = (minimum as { android: number | null } | null)?.android ?? null
      info.ios.minimum = (minimum as { ios: number | null } | null)?.ios ?? null
      const mine = ((releases ?? []) as (ReleaseNote & { audience: string })[]).find(
        (r) => r.audience === 'everyone' || (r.audience === 'field') === field,
      )
      if (mine) {
        const { audience: _audience, ...note } = mine
        info.release = note
      }
    }
  } catch {
    // Before 057, or the database is busy: the build id alone still works.
  }

  return Response.json(info, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}
