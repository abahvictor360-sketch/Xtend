'use client'

import { useEffect, useRef, useState } from 'react'
import { BellRing, CheckCircle2, Loader2, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase/client'
import { formatLagos } from '@/lib/utils'

/** How long to wait for the phone before saying it did not answer. */
const WAIT_MS = 3 * 60_000
const POLL_MS = 3000

type State =
  | { stage: 'idle' }
  | { stage: 'waiting'; id: string; sentAt: number }
  | { stage: 'delivered'; at: string; opened: string | null; id: string }
  | { stage: 'silent' }
  | { stage: 'error'; message: string }

/**
 * Sends "Please open Xtend now" to one person's phone and watches for the
 * phone's answer (phone_checks, migration 026).
 */
export function PhoneCheck({ userId, name }: { userId: string; name: string }) {
  const [state, setState] = useState<State>({ stage: 'idle' })
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
  }, [])

  // A different person: start again.
  useEffect(() => {
    if (timer.current) clearInterval(timer.current)
    setState({ stage: 'idle' })
  }, [userId])

  function watch(id: string, sentAt: number) {
    if (timer.current) clearInterval(timer.current)
    timer.current = setInterval(async () => {
      const { data } = await supabase()
        .from('phone_checks')
        .select('delivered_at, opened_at')
        .eq('id', id)
        .maybeSingle<{ delivered_at: string | null; opened_at: string | null }>()
      if (data?.delivered_at) {
        setState({ stage: 'delivered', at: data.delivered_at, opened: data.opened_at, id })
        // Keep watching a little longer, to see whether they open it.
        if (data.opened_at || Date.now() - sentAt > WAIT_MS) clearInterval(timer.current!)
        return
      }
      if (Date.now() - sentAt > WAIT_MS) {
        clearInterval(timer.current!)
        setState({ stage: 'silent' })
      }
    }, POLL_MS)
  }

  async function send() {
    setState({ stage: 'waiting', id: '', sentAt: Date.now() })
    try {
      const res = await fetch('/api/admin/phone-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      const json = (await res.json().catch(() => ({}))) as { id?: string; reached?: boolean; error?: string }
      if (!res.ok || !json.id) throw new Error(json.error ?? 'The check could not be sent.')
      if (!json.reached) {
        setState({
          stage: 'error',
          message: `${name} has notifications turned off in Xtend, so their phone cannot be checked. Ask them to turn notifications on.`,
        })
        return
      }
      const sentAt = Date.now()
      setState({ stage: 'waiting', id: json.id, sentAt })
      watch(json.id, sentAt)
    } catch (e) {
      setState({ stage: 'error', message: e instanceof Error ? e.message : 'The check could not be sent.' })
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <Button size="sm" className="h-10" onClick={() => void send()} disabled={state.stage === 'waiting'}>
        {state.stage === 'waiting' ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
        {state.stage === 'waiting' ? 'Waiting for the phone…' : `Check ${name}'s phone now`}
      </Button>

      {state.stage === 'waiting' && state.id && (
        <p className="text-muted-foreground">Sent. Waiting up to 3 minutes for the phone to answer.</p>
      )}
      {state.stage === 'delivered' && (
        <p className="flex items-start gap-2 font-medium text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The phone is on and has network: the check reached it at {formatLagos(state.at, false)}.
            {state.opened
              ? ` They opened it at ${formatLagos(state.opened, false)}.`
              : ' They have not opened it (yet).'}
          </span>
        </p>
      )}
      {state.stage === 'silent' && (
        <p className="flex items-start gap-2 font-medium text-destructive">
          <PhoneOff className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            No answer after 3 minutes. The phone is off, has no network, or is on strong battery
            saver. Try again in a few minutes; a phone that answers later was not off.
          </span>
        </p>
      )}
      {state.stage === 'error' && <p className="text-destructive">{state.message}</p>}
    </div>
  )
}
