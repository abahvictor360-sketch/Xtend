'use client'

import { useEffect, useState } from 'react'
import { diagnoseAppError } from '@/lib/app-error'
import { reloadFresh, reportAppError } from '@/lib/app-recover'

/**
 * The last line before the browser's bare "Application error: a client-side
 * exception has occurred": a crash in the app's outer frame lands here. It
 * says what happened and what to do (lib/app-error.ts). Styled inline,
 * because the app's own styles may be what failed to load.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    setOnline(navigator.onLine)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  const info = diagnoseAppError(error, online)
  useEffect(() => {
    reportAppError({ kind: info.kind, code: info.code, message: error?.message, digest: error?.digest, where: 'global' })
    // Once per error.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])

  const brand = '#d1531b'
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#faf7f5', color: '#1f1a17', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        <main
          style={{
            boxSizing: 'border-box',
            minHeight: '100dvh',
            maxWidth: 440,
            margin: '0 auto',
            padding: '32px 16px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 16,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 1, color: brand }}>XTEND</div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{info.title}</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, margin: 0, color: '#5b524d' }}>{info.message}</p>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, textAlign: 'left', display: 'grid', gap: 8 }}>
            {info.steps.map((step, i) => (
              <li key={step} style={{ display: 'flex', gap: 12, background: '#fdeee6', borderRadius: 16, padding: 12, fontSize: 14 }}>
                <span
                  style={{
                    flex: '0 0 24px',
                    height: 24,
                    borderRadius: 12,
                    background: brand,
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {i + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => (info.primary === 'reload_fresh' ? void reloadFresh() : reset())}
            style={{ minHeight: 48, border: 0, borderRadius: 14, background: brand, color: '#fff', fontSize: 16, fontWeight: 700 }}
          >
            {info.primary === 'reload_fresh' ? 'Load the new version' : 'Try again'}
          </button>
          {info.primary === 'retry' && (
            <button
              type="button"
              onClick={() => void reloadFresh()}
              style={{ minHeight: 44, border: `1px solid ${brand}`, borderRadius: 14, background: 'transparent', color: brand, fontSize: 15, fontWeight: 600 }}
            >
              Still stuck? Load the newest version
            </button>
          )}
          <p style={{ fontSize: 11, color: '#8a7f79', margin: 0 }}>Code {info.code}</p>
        </main>
      </body>
    </html>
  )
}
