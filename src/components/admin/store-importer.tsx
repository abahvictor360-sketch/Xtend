'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Papa from 'papaparse'
import { MapPin, Upload } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface RowResult {
  line: number
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  geofence_radius_m: number
  source: string | null
  resolved_address: string | null
  error: string | null
  created?: boolean
}

interface Draft {
  name: string
  address: string | null
}

const SAMPLE = `Justrite Superstore Bariga, 56/58 Jagun Molu St, Bariga, Lagos
Shoprite Ikeja City Mall, Obafemi Awolowo Way, Ikeja, Lagos
Spar Port Harcourt, Azikiwe Road, Port Harcourt`

const SOURCE_LABEL: Record<string, string> = {
  google_places: 'Shop pinned',
  google_geocode: 'Street only',
  osm: 'OpenStreetMap',
  given: 'Coordinates given',
}

/**
 * Paste the stockist list, check where each one landed, then import. The
 * lookup happens on the server so the map key never reaches a browser.
 */
export function StoreImporter() {
  const router = useRouter()
  const [text, setText] = useState('')
  const [radius, setRadius] = useState(150)
  const [shiftStart, setShiftStart] = useState('08:00')
  const [shiftEnd, setShiftEnd] = useState('18:00')
  const [drafts, setDrafts] = useState<Draft[] | null>(null)
  const [preview, setPreview] = useState<RowResult[] | null>(null)
  const [ready, setReady] = useState(0)
  const [created, setCreated] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  /** One store per line: the name, then a comma, then the address. */
  function parseText(value: string): Draft[] {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const comma = line.indexOf(',')
        if (comma === -1) return { name: line, address: null }
        return { name: line.slice(0, comma).trim(), address: line.slice(comma + 1).trim() || null }
      })
      .filter((row) => row.name.length >= 2)
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (parsed) => {
        const rows = parsed.data
          .map((row) => ({
            name: (row.name ?? row.store ?? row.outlet ?? '').trim(),
            address: (row.address ?? row.location ?? '').trim() || null,
          }))
          .filter((row) => row.name.length >= 2)
        if (rows.length === 0) {
          setError('That file has no "name" column with store names in it.')
          return
        }
        setText(rows.map((r) => [r.name, r.address].filter(Boolean).join(', ')).join('\n'))
      },
    })
  }

  async function send(rows: Draft[], commit: boolean) {
    setBusy(commit ? 'Importing' : 'Looking up each address')
    setError(null)
    try {
      const res = await fetch('/api/admin/outlets/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          geofence_radius_m: radius,
          shift_start: shiftStart,
          shift_end: shiftEnd,
          commit,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'That import did not go through.')
        return
      }
      setPreview(data.rows as RowResult[])
      if (commit) {
        setCreated(data.created as number)
        setDrafts(null)
        router.refresh()
      } else {
        setReady(data.ready as number)
        setDrafts(rows)
      }
    } finally {
      setBusy(null)
    }
  }

  const lines = parseText(text)

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}
      {created !== null && (
        <Alert variant="success">
          {created} store{created === 1 ? '' : 's'} added. They can be allocated to staff now.
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="stores">One store per line — name, then the address</Label>
        <Textarea
          id="stores"
          rows={8}
          spellCheck={false}
          placeholder={SAMPLE}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {lines.length} store{lines.length === 1 ? '' : 's'} in the box. Coordinates are looked up
          for you; nothing is saved until you have checked the list.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Geofence radius (m)</Label>
          <Input
            type="number"
            min={25}
            max={2000}
            value={radius}
            onChange={(event) => setRadius(Number(event.target.value) || 150)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Shift start</Label>
          <Input type="time" value={shiftStart} onChange={(e) => setShiftStart(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Shift end</Label>
          <Input type="time" value={shiftEnd} onChange={(e) => setShiftEnd(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Or upload a CSV</Label>
          <Input type="file" accept=".csv,text/csv" onChange={onFile} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button disabled={Boolean(busy) || lines.length === 0} onClick={() => void send(lines, false)}>
          <MapPin className="h-4 w-4" />
          {busy === 'Looking up each address' ? busy : 'Find these on the map'}
        </Button>
        {drafts && ready > 0 && (
          <Button variant="default" disabled={Boolean(busy)} onClick={() => void send(drafts, true)}>
            <Upload className="h-4 w-4" />
            {busy === 'Importing' ? busy : `Import ${ready} store${ready === 1 ? '' : 's'}`}
          </Button>
        )}
      </div>

      {preview && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {created === null
              ? `${ready} of ${preview.length} ready to import.`
              : 'Result of the import.'}{' '}
            Check anything marked <strong>Street only</strong> — the pin is on the road, not the
            shop door, so widen the radius or set the coordinates by hand afterwards.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Store</TableHead>
                  <TableHead>Where it landed</TableHead>
                  <TableHead>Coordinates</TableHead>
                  <TableHead>Accuracy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.map((row) => (
                  <TableRow key={row.line}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                      {row.resolved_address ?? row.address ?? '—'}
                    </TableCell>
                    <TableCell className="tabular-nums text-xs">
                      {row.lat !== null && row.lng !== null
                        ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}`
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.source === 'google_geocode' ? (
                        <Badge variant="warning">{SOURCE_LABEL[row.source]}</Badge>
                      ) : row.source ? (
                        <Badge variant="outline">{SOURCE_LABEL[row.source] ?? row.source}</Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      {row.error ? (
                        <span className="text-xs text-destructive">{row.error}</span>
                      ) : row.created ? (
                        <Badge variant="success">Added</Badge>
                      ) : (
                        <Badge variant="brand">Ready</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
