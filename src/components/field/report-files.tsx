'use client'

import { useRef, useState } from 'react'
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

/** A document already on today's report. */
export interface SavedReportFile {
  id: string
  name: string
  mime: string
  size_bytes: number
}

/** A document picked on the phone, sent when the report is saved. */
export interface PendingReportFile {
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
    <li className="flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-2">
      <FileIcon mime={mime} />
      <div className="min-w-0 flex-1">
        {href ? (
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
      {onRemove && (
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
 * report locks at midnight.
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
  const [removing, setRemoving] = useState<string | null>(null)

  const used = saved.length + pending.length
  const room = MAX_REPORT_FILES - used

  function pick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    const { ok, problems: why } = checkReportFiles(used, files)
    setProblems(why)
    if (ok.length) {
      onPendingChange([
        ...pending,
        ...ok.map(({ file, mime }) => ({
          key: `${file.name}-${file.size}-${Math.random().toString(16).slice(2)}`,
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
    setRemoving(file.id)
    try {
      const res = await fetch(`/api/report-files/${file.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'That document could not be removed.')
      router.refresh()
    } catch (e) {
      setProblems([
        e instanceof Error && e.message !== 'Failed to fetch'
          ? e.message
          : 'No connection. Try again when you have data.',
      ])
    } finally {
      setRemoving(null)
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

      {problems.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      {used > 0 && (
        <ul className="space-y-2">
          {saved.map((f) => (
            <Row
              key={f.id}
              name={f.name}
              mime={f.mime}
              size={f.size_bytes}
              note="Attached"
              href={`/api/report-files/${f.id}`}
              removing={removing === f.id}
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
              onRemove={disabled ? undefined : () => onPendingChange(pending.filter((p) => p.key !== f.key))}
            />
          ))}
        </ul>
      )}

      {room > 0 && !disabled && (
        <>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand/35 bg-tint/50 text-sm font-semibold text-brand"
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
