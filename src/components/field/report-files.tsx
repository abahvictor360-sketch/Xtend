'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileSpreadsheet, FileText, Image as ImageIcon, Paperclip, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import {
  MAX_REPORT_FILES,
  REPORT_FILE_ACCEPT,
  checkReportFiles,
  fileSizeLabel,
  reportFileLabel,
} from '@/lib/report-files'
import { newClientId, savedFileView, takeRemovalNotices } from '@/lib/report-file-queue'
import { PermanentJobError, flushOutbox, noticeStore, queuedRemovals, submitOrQueue } from '@/lib/offline/sync'

/** A document already on today's report. */
export interface SavedReportFile {
  id: string
  name: string
  mime: string
  size_bytes: number
}

/** A document picked on the phone, sent when the report is saved. */
export interface PendingReportFile {
  /** Its id from the moment it is picked: the name it is uploaded under (0065). */
  key: string
  blob: Blob
  name: string
  mime: string
  size: number
}

function FileIcon({ mime }: { mime: string }) {
  const label = reportFileLabel(mime)
  const Icon = label === 'Picture' ? ImageIcon : label === 'Excel' || label === 'CSV' ? FileSpreadsheet : FileText
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand">
      <Icon className="h-4 w-4" />
    </span>
  )
}

function Row({
  name,
  mime,
  size,
  note,
  href,
  onRemove,
  removing,
}: {
  name: string
  mime: string
  size: number
  note: string
  href?: string
  onRemove?: () => void
  removing?: boolean
}) {
  return (
    <li
      className={`flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2 ${removing ? 'opacity-60' : ''}`}
    >
      <FileIcon mime={mime} />
      <div className="min-w-0 flex-1">
        {href && !removing ? (
          <a href={href} className="line-clamp-2 text-sm font-semibold text-foreground [overflow-wrap:anywhere] hover:text-brand">
            {name}
          </a>
        ) : (
          <p className="line-clamp-2 text-sm font-semibold [overflow-wrap:anywhere]">{name}</p>
        )}
        <p className="text-[11px] text-muted-foreground">
          {reportFileLabel(mime)} · {fileSizeLabel(size)} · {note}
        </p>
      </div>
      {onRemove && !removing && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          disabled={removing}
          onClick={onRemove}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-tint hover:text-brand disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  )
}

/**
 * "Attach documents" on the daily report: PDF, Word, Excel or CSV files and
 * pictures, up to five, 10 MB each. Picked files wait on the phone and go
 * with the report when it is saved; saved ones can be removed until the
 * report locks at midnight. With no signal a removal waits on the phone
 * (0065): the document reads "Removing…" and goes when there is signal.
 */
export function ReportFiles({
  saved,
  pending,
  onPendingChange,
  disabled,
}: {
  saved: SavedReportFile[]
  pending: PendingReportFile[]
  onPendingChange: (next: PendingReportFile[]) => void
  disabled?: boolean
}) {
  const router = useRouter()
  const input = useRef<HTMLInputElement>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notices, setNotices] = useState<string[]>([])
  // Removals being sent now, and those waiting on the phone.
  const [sending, setSending] = useState<string[]>([])
  const [waiting, setWaiting] = useState<string[]>([])
  // Taken off: hidden until the page reloads without them.
  const [gone, setGone] = useState<string[]>([])
  const busy = sending.length > 0

  const shown = saved.filter((f) => !gone.includes(f.id))
  const { files: savedView, counted } = savedFileView(shown, [...sending, ...waiting])
  const used = counted + pending.length
  const room = MAX_REPORT_FILES - used

  const lastWaiting = useRef<string[]>([])
  const check = useCallback(async () => {
    const now = await queuedRemovals()
    // One that left the queue was sent (or given up, with a notice).
    if (lastWaiting.current.some((id) => !now.includes(id))) router.refresh()
    lastWaiting.current = now
    setWaiting(now)
    const fresh = takeRemovalNotices(noticeStore())
    if (fresh.length) setNotices((current) => [...current, ...fresh.filter((n) => !current.includes(n))])
  }, [router])

  useEffect(() => {
    void check()
    const onOnline = () => {
      void (async () => {
        if ((await queuedRemovals()).length) await flushOutbox().catch(() => undefined)
        await check()
      })()
    }
    window.addEventListener('online', onOnline)
    if (navigator.onLine) onOnline()
    const timer = setInterval(() => void check(), 5000)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(timer)
    }
  }, [check])

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (busy || disabled) return
    const { ok, problems: why } = checkReportFiles(used, files)
    setProblems(why)
    if (ok.length) {
      onPendingChange([
        ...pending,
        ...ok.map(({ file, mime }) => ({
          key: newClientId(),
          blob: file,
          name: file.name,
          mime,
          size: file.size,
        })),
      ])
    }
  }

  async function removeSaved(file: SavedReportFile) {
    setProblems([])
    setSending((current) => [...current, file.id])
    try {
      const result = await submitOrQueue({
        kind: 'report_file_remove',
        file_id: file.id,
        name: file.name,
        client_captured_at: new Date().toISOString(),
      })
      if (result.queued) {
        await check()
      } else {
        setGone((current) => [...current, file.id])
        router.refresh()
      }
    } catch (e) {
      setProblems([
        e instanceof PermanentJobError || (e instanceof Error && e.message !== 'Failed to fetch')
          ? e.message
          : 'That document could not be removed. Try again.',
      ])
    } finally {
      setSending((current) => current.filter((id) => id !== file.id))
    }
  }

  return (
    <div className="space-y-2">
      <Label className="field-label">
        Attach documents ({used}/{MAX_REPORT_FILES})
      </Label>
      <p className="text-xs text-muted-foreground">
        Price lists, display plans, invoices or anything else for the office: PDF, Word, Excel or
        CSV files, or pictures. Up to {MAX_REPORT_FILES}, each 10 MB or smaller.
      </p>

      {notices.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-tint px-3 py-2 text-xs text-tint-foreground">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <p role="status" className="text-xs text-muted-foreground">
        {busy ? 'Updating documents…' : ''}
      </p>

      {savedView.length + pending.length > 0 && (
        <ul className="space-y-2">
          {savedView.map((f) => (
            <Row
              key={f.id}
              name={f.name}
              mime={f.mime}
              size={f.size_bytes}
              note={f.removing ? 'Removing…' : 'Attached'}
              href={`/api/report-files/${f.id}`}
              removing={f.removing}
              onRemove={disabled ? undefined : () => void removeSaved(f)}
            />
          ))}
          {pending.map((f) => (
            <Row
              key={f.key}
              name={f.name}
              mime={f.mime}
              size={f.size}
              note="Sent when you save"
              removing={busy}
              onRemove={disabled ? undefined : () => onPendingChange(pending.filter((p) => p.key !== f.key))}
            />
          ))}
        </ul>
      )}

      {waiting.some((id) => shown.some((f) => f.id === id)) && (
        <p className="text-xs text-muted-foreground">
          Documents you removed are taken off the report as soon as your phone has signal.
        </p>
      )}

      {room > 0 && !disabled && (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/35 bg-tint/50 text-sm font-semibold text-brand disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" />
            Choose documents
          </button>
          <input
            ref={input}
            type="file"
            multiple
            accept={REPORT_FILE_ACCEPT}
            className="hidden"
            onChange={pick}
          />
        </>
      )}
    </div>
  )
}
