'use client'

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // Field staff must not be logged out overnight.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    },
  )
}

let browserClient: ReturnType<typeof createClient> | null = null

/** One client per tab. Repeated createClient() calls leak realtime sockets. */
export function supabase() {
  if (!browserClient) browserClient = createClient()
  return browserClient
}
