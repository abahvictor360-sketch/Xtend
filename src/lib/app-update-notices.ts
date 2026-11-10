import 'server-only'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { notifyUsers } from '@/lib/notify'
import { publishedAndroidApk } from '@/lib/app-release'
import { noticeHour, updateNoticeMessage } from '@/lib/app-update-notice'

interface Claimed {
  user_id: string
  platform: 'android' | 'ios'
  build: number
  times: number
}

/**
 * The five-minute job's part for new phone apps (migration 0082): everyone
 * active whose app is older than the newest is sent "A new Xtend app is
 * ready" once, then "Please update Xtend" every two days while they stay
 * behind, three times in all per build. Only in the day (Lagos). Never
 * throws.
 */
export async function flushAppUpdateNotices(at: Date = new Date()): Promise<{ claimed: number; delivered: number }> {
  if (!noticeHour(at)) return { claimed: 0, delivered: 0 }
  try {
    const envAndroid = Number(process.env.ANDROID_LATEST_BUILD)
    const envIos = Number(process.env.IOS_LATEST_BUILD)
    let android: number | null = Number.isInteger(envAndroid) ? envAndroid : null
    let version: string | null = null
    if (!process.env.ANDROID_APK_URL) {
      const apk = await publishedAndroidApk()
      if (apk) {
        android = android ?? apk.build
        version = apk.version
      }
    }
    const ios = Number.isInteger(envIos) ? envIos : null
    if (android == null && ios == null) return { claimed: 0, delivered: 0 }

    const admin = createAdminSupabase()
    const { data, error } = await admin.rpc('claim_app_update_notices', { p_android: android, p_ios: ios })
    if (error) {
      // Before migration 0082 the function does not exist; nothing to send.
      if (!/claim_app_update_notices/.test(error.message)) {
        console.error('claim_app_update_notices failed', error.message)
      }
      return { claimed: 0, delivered: 0 }
    }
    const rows = (data ?? []) as Claimed[]
    const groups = new Map<string, Claimed[]>()
    for (const row of rows) {
      const key = `${row.platform}|${row.build}|${row.times > 1 ? 'again' : 'first'}`
      groups.set(key, [...(groups.get(key) ?? []), row])
    }
    let delivered = 0
    for (const group of groups.values()) {
      const { platform, build, times } = group[0]
      const result = await notifyUsers(
        group.map((r) => r.user_id),
        {
          ...updateNoticeMessage(platform, platform === 'android' ? version : null, times),
          url: '/download',
          detail: { kind: 'app_update', system: true, platform, build },
        },
      )
      delivered += result.delivered
    }
    return { claimed: rows.length, delivered }
  } catch (error) {
    console.error('app update notices failed', error)
    return { claimed: 0, delivered: 0 }
  }
}
