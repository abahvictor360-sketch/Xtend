'use client'

import { useState } from 'react'
import { MapPinPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Shown after a clock-in or check-in at a spot no map could name. What the
 * person types is remembered, so everyone after them gets the name without
 * any map lookup.
 */
export function NamePlace({ lat, lng }: { lat: number; lng: number }) {
  const [name, setName] = useState('')
  const [state, setState] = useState<'asking' | 'saving' | 'saved' | 'skipped'>('asking')
  const [error, setError] = useState<string | null>(null)

  if (state === 'skipped') return null
  if (state === 'saved') {
    return (
      <p className="rounded-2xl bg-tint px-4 py-3 text-sm text-tint-foreground">
        Thank you. Xtend will call this place &ldquo;{name.trim()}&rdquo; from now on.
      </p>
    )
  }

  async function save() {
    setState('saving')
    setError(null)
    try {
      const res = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, name }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That name could not be saved.')
      setState('saved')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That name could not be saved.')
      setState('asking')
    }
  }

  return (
    <div className="surface space-y-2 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <MapPinPlus className="h-4 w-4 text-brand" />
        This place is not on the map. What is it called?
      </p>
      <p className="text-xs text-muted-foreground">
        For example the shop or mall name. Everyone who comes here after you will see it.
      </p>
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Ikeja City Mall"
          maxLength={120}
          autoCapitalize="words"
          className="h-10"
        />
        <Button
          size="sm"
          className="h-10"
          disabled={state === 'saving' || name.trim().length < 2}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <button
        type="button"
        onClick={() => setState('skipped')}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Not now
      </button>
    </div>
  )
}
