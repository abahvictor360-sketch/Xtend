import { z } from 'zod'
import Anthropic from '@anthropic-ai/sdk'
import { createAdminSupabase } from '@/lib/supabase/admin'
import { apiError, requireApiSession, FIELD_ROLES } from '@/lib/auth'
import { judgePhoto, photoCheckConfigured, type PhotoKind, type PhotoSetting } from '@/lib/photo-check'

export const maxDuration = 60

const schema = z.object({
  bucket: z.enum(['selfies', 'reports']),
  path: z.string().min(1).max(300),
  /** The selfie's thumbnail, which takes the same verdict. */
  thumb_path: z.string().min(1).max(300).nullable().optional(),
  /** A photo in the reports bucket is a shelf photo unless it names a place. */
  kind: z.enum(['shelf', 'storefront']).optional(),
})

/**
 * Checks a photo the person has just uploaded, and records the verdict
 * where the database will look for it: a clock-in, store visit or store
 * count is refused unless its photo was checked here and not rejected.
 *
 * If the checking service is unavailable the photo is recorded as
 * unchecked and allowed, with an integrity flag, so nobody is stuck unable
 * to clock in because of an outage.
 */
export async function POST(request: Request) {
  try {
    const session = await requireApiSession([...FIELD_ROLES])
    const parsed = schema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return Response.json({ error: 'Invalid photo' }, { status: 400 })
    const { bucket, path } = parsed.data
    const thumb = parsed.data.thumb_path ?? null
    for (const p of [path, thumb]) {
      if (p && !p.startsWith(`${session.userId}/`)) {
        return Response.json({ error: 'That photo does not belong to you' }, { status: 400 })
      }
    }
    const kind: PhotoKind = bucket === 'selfies' ? 'selfie' : (parsed.data.kind ?? 'shelf')
    const admin = createAdminSupabase()

    // Checked already (a retry after a dropped connection): same answer.
    const { data: existing } = await admin
      .from('photo_checks')
      .select('verdict, message')
      .eq('path', path)
      .maybeSingle<{ verdict: string; message: string | null }>()
    if (existing) return verdictResponse(existing.verdict, existing.message)

    const { data: file, error: downloadError } = await admin.storage.from(bucket).download(path)
    if (downloadError || !file) {
      return Response.json({ error: 'The photo was not uploaded. Take it again.' }, { status: 400 })
    }

    let verdict: 'pass' | 'reject' | 'unchecked' = 'unchecked'
    let problem: string | null = null
    let message: string | null = null
    let setting: PhotoSetting = 'unclear'
    if (photoCheckConfigured()) {
      try {
        const judged = await judgePhoto(await file.arrayBuffer(), kind)
        verdict = judged.verdict
        problem = judged.problem
        message = judged.verdict === 'reject' ? judged.message : null
        setting = judged.setting
      } catch (error) {
        if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) {
          console.error('photo check failed', error)
        }
      }
    }

    const rows = [path, thumb].filter((p): p is string => Boolean(p)).map((p) => ({
      path: p,
      bucket,
      user_id: session.userId,
      kind,
      verdict,
      problem,
      message,
    }))
    const { error: saveError } = await admin.from('photo_checks').upsert(rows, { onConflict: 'path' })
    // Before migration 023 there is nowhere to keep the verdict, and nothing
    // requires one either: still tell the phone, so a bad photo is retaken.
    if (saveError && saveError.code !== '42P01' && saveError.code !== 'PGRST205') {
      return Response.json({ error: saveError.message }, { status: 500 })
    }

    // A rejected photo is worth a supervisor knowing about: one is a bad
    // photo, several photos of a screen is somebody trying it on.
    if (verdict === 'reject' || (verdict === 'unchecked' && photoCheckConfigured())) {
      await admin.from('integrity_flags').insert({
        user_id: session.userId,
        kind: verdict === 'reject' ? 'photo_rejected' : 'photo_unchecked',
        severity: verdict === 'reject' && (problem === 'screen' || problem === 'printed_photo') ? 'high' : 'low',
        summary:
          verdict === 'reject'
            ? `A ${NOUN[kind]} was rejected: ${describe(problem)}`
            : `A ${NOUN[kind]} could not be checked and was allowed`,
        detail: { bucket, path, problem },
      })
    }

    // A selfie that passed but was plainly taken inside a house. Allowed,
    // since the GPS decides where somebody is, but a supervisor should see
    // it: at home with a store's GPS is exactly what a faked location looks
    // like. (Before migration 025 this kind is refused; nothing is lost.)
    if (verdict === 'pass' && kind === 'selfie' && setting === 'home') {
      await admin.from('integrity_flags').insert({
        user_id: session.userId,
        kind: 'selfie_at_home',
        severity: 'medium',
        summary: 'The selfie looks like it was taken inside a home',
        detail: { bucket, path, setting },
      })
    }

    return verdictResponse(verdict, message)
  } catch (error) {
    return apiError(error)
  }
}

const NOUN: Record<PhotoKind, string> = {
  selfie: 'selfie',
  shelf: 'shelf photo',
  storefront: 'photo of a place being named',
}

function describe(problem: string | null) {
  switch (problem) {
    case 'screen':
      return 'it looks like a photo of a screen'
    case 'printed_photo':
      return 'it looks like a photo of a printed picture'
    case 'no_face':
      return 'no face in the selfie'
    case 'face_unclear':
      return 'the face could not be seen clearly'
    case 'not_a_shelf':
      return 'no products in the shelf photo'
    case 'not_a_business':
      return 'it shows a home, not a business'
    case 'blurry':
      return 'too blurry'
    case 'too_dark':
      return 'too dark'
    default:
      return 'not a usable photo'
  }
}

function verdictResponse(verdict: string, message: string | null) {
  if (verdict === 'reject') {
    return Response.json(
      { verdict, error: message ?? 'That photo cannot be used. Take it again.' },
      { status: 422 },
    )
  }
  return Response.json({ verdict })
}
