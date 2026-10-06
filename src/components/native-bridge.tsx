'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { isNativeApp, listenNative } from '@/lib/native'

interface PushData {
  url?: string
  check_id?: string
  check_token?: string
}

function answerCheck(data: PushData | undefined, stage: 'delivered' | 'opened') {
  if (!data?.check_id || !data.check_token) return
  void fetch('/api/phone-check/ack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: data.check_id, token: data.check_token, stage }),
  }).catch(() => {})
}

/**
 * Renders nothing. Inside the Xtend Android or iOS app it does for native
 * notifications what public/sw.js does for web ones: answers a
 * supervisor's phone check (026) when it arrives and when it is opened,
 * and opens the page a notification points to.
 */
export function NativeBridge() {
  const router = useRouter()

  useEffect(() => {
    if (!isNativeApp()) return
    const received = listenNative<{ data?: PushData }>('PushNotifications', 'pushNotificationReceived', (n) =>
      answerCheck(n.data, 'delivered'),
    )
    const opened = listenNative<{ notification?: { data?: PushData } }>(
      'PushNotifications',
      'pushNotificationActionPerformed',
      (action) => {
        const data = action.notification?.data
        answerCheck(data, 'opened')
        // A page in Xtend only; '//host' would leave the app.
        if (data?.url && /^\/(?![/\\])/.test(data.url)) router.push(data.url)
      },
    )
    return () => {
      void received.remove()
      void opened.remove()
    }
  }, [router])

  return null
}
