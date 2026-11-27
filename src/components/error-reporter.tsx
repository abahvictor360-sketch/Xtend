'use client'

import { useEffect } from 'react'
import { reportAppError } from '@/lib/app-recover'
import { MAX_PER_PAGE, isNoise, messageOf } from '@/lib/background-errors'

/**
 * Reports errors that happen in the background of a page, without crashing
 * it (src/lib/background-errors.ts): a failed promise or a script error.
 * Crashes are reported by the error screens; a missing file after an
 * update is handled by UpdateManager. Shows nothing.
 */
export function ErrorReporter() {
  useEffect(() => {
    const sent = new Set<string>()
    const send = (message: string, source = '') => {
      if (sent.size >= MAX_PER_PAGE || isNoise(message, source) || sent.has(message)) return
      sent.add(message)
      reportAppError({ kind: 'unknown', code: 'BG', message, where: 'background' })
    }
    const onError = (e: ErrorEvent) => send(e.error ? messageOf(e.error) : e.message ?? '', e.filename ?? '')
    const onRejection = (e: PromiseRejectionEvent) => send(messageOf(e.reason))
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
