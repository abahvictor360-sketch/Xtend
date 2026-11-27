import 'server-only'
import { cache } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The signed-in person's own stores (home and allocated), read once per
 * request (2026-11-27): the staff app's frame and the page inside it both
 * need them, and asked the database twice on every page load. React's
 * cache() shares the answer within one request only, so it is never stale.
 */
export const myOutlets = cache(async (supabase: SupabaseClient) => supabase.rpc('my_outlets'))

/** The X Metrics switches (0063), read once per request. */
export const xmSettingsOnce = cache(async (supabase: SupabaseClient) => supabase.from('xm_settings').select('*').maybeSingle())
