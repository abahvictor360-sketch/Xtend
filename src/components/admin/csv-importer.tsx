'use client'

import { useState } from 'react'
import Papa from 'papaparse'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface RowResult {
  line: number
  full_name: string
  email: string
  phone: string | null
  role: string
  outlet_name: string | null
  error: string | null
  created?: boolean
  temp_password?: string
}

const TEMPLATE = `full_name,email,phone,outlet_name,role
Ada Okafor,ada@xpel.ng,08031234567,Ikeja City Mall,merchandiser
Bala Yusuf,bala@xpel.ng,08039876543,Wuse Market Kiosk,merchandiser
`

export function CsvImporter({ outletNames }: { outletNames: string[] }) {
  const router = useRouter()
  const [rows, setRows] = useState<Record<string, string | null>[] | null>(null)
  const [preview, setPreview] = useState<RowResult[] | null>(null)
  const [summary, setSummary] = useState<{ valid: number; invalid: number } | null>(null)
  const [committed, setCommitted] = useState<{ created: number; failed: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setPreview(null)
    setCommitted(null)

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (result) => {
        const parsed = result.data.filter((row) => Object.values(row).some((v) => v?.trim()))
        if (!parsed.length) {
          setError('That file has no rows.')
          return
        }
        if (parsed.length > 500) {
          setError('Split the file: 500 rows at a time is the limit.')
          return
        }
        setRows(parsed)
        void validate(parsed)
      },
      error: () => setError('That file could not be read as CSV.'),
    })
  }

  async function validate(parsed: Record<string, string | null>[]) {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsed, commit: false }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Validation failed.')
        return
      }
      setPreview(data.rows as RowResult[])
      setSummary({ valid: data.valid, invalid: data.invalid })
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!rows) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, commit: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Import failed.')
        if (data.rows) setPreview(data.rows as RowResult[])
        return
      }
      setPreview(data.rows as RowResult[])
      setCommitted({ created: data.created, failed: data.failed })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  function downloadPasswords() {
    if (!preview) return
    const csv = [
      'full_name,email,temp_password',
      ...preview
        .filter((row) => row.temp_password)
        .map((row) => `"${row.full_name}","${row.email}","${row.temp_password}"`),
    ].join('\r\n')

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'xtend-temporary-passwords.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="destructive">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-md border border-input px-4 py-2 text-sm">
          Choose CSV
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        </label>
        <a
          className="text-sm text-primary"
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="xtend-staff-template.csv"
        >
          Download template
        </a>
        <span className="text-xs text-muted-foreground">
          Known outlets: {outletNames.length ? outletNames.join(', ') : 'none yet — create outlets first'}
        </span>
      </div>

      {busy && <p className="text-sm text-muted-foreground">Working…</p>}

      {summary && !committed && (
        <Alert variant={summary.invalid ? 'warning' : 'success'}>
          {summary.valid} row(s) ready, {summary.invalid} with problems.{' '}
          {summary.invalid ? 'Fix the file and upload it again.' : 'Nothing has been created yet.'}
        </Alert>
      )}

      {committed && (
        <Alert variant="success">
          <p className="font-medium">
            {committed.created} account(s) created, {committed.failed} failed.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Temporary passwords are shown once. Download them now and hand them out.
          </p>
          <Button size="sm" variant="outline" className="mt-2" onClick={downloadPasswords}>
            Download passwords CSV
          </Button>
        </Alert>
      )}

      {preview && (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Outlet</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row) => (
                <TableRow key={row.line}>
                  <TableCell className="tabular-nums">{row.line}</TableCell>
                  <TableCell>{row.full_name || '—'}</TableCell>
                  <TableCell>{row.email || '—'}</TableCell>
                  <TableCell>{row.phone ?? '—'}</TableCell>
                  <TableCell>{row.outlet_name ?? '—'}</TableCell>
                  <TableCell>{row.role}</TableCell>
                  <TableCell>
                    {row.error ? (
                      <Badge variant="destructive">{row.error}</Badge>
                    ) : row.created ? (
                      <Badge variant="success">Created</Badge>
                    ) : (
                      <Badge variant="outline">Ready</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {preview && !committed && summary?.invalid === 0 && (
        <Button onClick={commit} disabled={busy}>
          {busy ? 'Creating accounts…' : `Create ${summary.valid} account(s)`}
        </Button>
      )}
    </div>
  )
}
