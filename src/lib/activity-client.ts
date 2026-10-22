'use client'

import { buildNumber } from '@/lib/app-update'
import { callNative, hasPlugin, nativePlatform } from '@/lib/native'

/**
 * Tells the server about a sign-out or an app open (migration 062). Never
 * throws and never waits long: the person's tap or screen comes first.
 */

let appBuild: Promise<number | null> | null = null

function myAppBuild(): Promise<number | null> {
  if (!appBuild) {
    appBuild = (async () => {
      if (!nativePlatform() || !hasPlugin('App')) return null
      try {
        const got = await callNative<{ version?: string; build?: string }>('App', 'getInfo')
        return buildNumber(got.build) ?? buildNumber(got.version)
      } catch {
        return null
      }
    })()
  }
  return appBuild
}

export async function sendActivity(kind: 'sign_out' | 'app_open', waitMs = 1500): Promise<void> {
  try {
    const send = (async () => {
      const body = JSON.stringify({ kind, platform: nativePlatform() ?? 'web', app_build: await myAppBuild() })
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
    })().catch(() => {})
    await Promise.race([send, new Promise((resolve) => setTimeout(resolve, waitMs))])
  } catch {
    // Nothing to tell anyone.
  }
}
