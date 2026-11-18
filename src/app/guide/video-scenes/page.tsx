import { notFound } from 'next/navigation'
import { SceneView } from '@/components/video/staff-video-scenes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Video scenes — Xtend', robots: { index: false } }

/**
 * One scene of the staff video guide, for scripts/make-staff-video.ts to
 * photograph (?s=<scene id>), or the list of scenes (?list=1). Only in
 * development: the live site answers 404.
 */
export default async function VideoScene({ searchParams }: { searchParams: Promise<{ s?: string; list?: string }> }) {
  if (process.env.NODE_ENV === 'production') notFound()
  const { s, list } = await searchParams
  return <SceneView id={s ?? null} list={Boolean(list)} />
}
