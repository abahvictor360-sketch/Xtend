import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { judgeExcuse, type Claim, type ExcuseEvidence, type MoreEvidence } from '@/lib/excuse'

/**
 * Gathers the evidence for a window and judges the claim. The extra
 * evidence (048) is fetched for every claim, for the timeline; before that
 * migration runs it is simply missing and the original two claims still work.
 */
export async function checkExcuse(db: SupabaseClient, user: string, from: string, to: string, claim: Claim) {
  const [base, extra] = await Promise.all([
    db.rpc('check_excuse', { p_user: user, p_from: from, p_to: to }),
    db.rpc('check_excuse_more', { p_user: user, p_from: from, p_to: to }),
  ])
  if (base.error) return { error: base.error, evidence: null, more: null, result: null }
  const evidence = base.data as ExcuseEvidence
  const more = extra.error ? null : (extra.data as MoreEvidence)
  if (!more && (claim === 'gps_failed' || claim === 'at_store' || claim === 'app_failed')) {
    return {
      error: { code: 'needs_048', message: 'This check needs the excuse update (048) run in Supabase.' },
      evidence,
      more,
      result: null,
    }
  }
  return { error: null, evidence, more, result: judgeExcuse(evidence, claim, more ?? undefined) }
}
