'use client'

import dynamic from 'next/dynamic'

/**
 * "Name this place" (045) is shown only now and then, but it carries the
 * camera and form checks: loaded when it is needed (2026-11-27), not with
 * every page of the staff app.
 */
export const NamePlaceLazy = dynamic(() => import('@/components/field/name-place').then((m) => m.NamePlace), {
  ssr: false,
  loading: () => <div className="h-40 animate-pulse rounded-3xl bg-card" aria-hidden />,
})
