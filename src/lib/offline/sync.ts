'use client'

import { supabase } from '@/lib/supabase/client'
import {
  dropOutbox,
  enqueue,
  listOutbox,
  markAttempt,
  type ClockJob,
  type OutboxRecord,
  type PingJob,
  type ReportJob,
  type XmCountJob,
  type XmSalesJob,
} from '@/lib/offline/db'

/**
 * A capture older than this can never be accepted by the server, so it is
 * dropped locally instead of retried forever.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
/** X Metrics counts and sales are accepted up to three days late (043). */
const XM_MAX_AGE_MS = 72 * 60 * 60 * 1000

function maxAge(kind: OutboxRecord['kind']) {
  return kind === 'xm_count' || kind === 'xm_sales' ? XM_MAX_AGE_MS : MAX_AGE_MS
}
const MAX_ATTEMPTS = 8

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export class PermanentJobError extends Error {}

/**
 * Asks the server to check a photo just uploaded: a live selfie, or a real
 * shelf, not a picture of a screen. A rejection is final for that photo
 * (retake it); a network failure is not, so it is thrown as an ordinary
 * error that the offline queue retries.
 */
export async function checkPhoto(
  bucket: 'selfies' | 'reports',
  path: string,
  thumbPath?: string | null,
  kind?: 'shelf' | 'storefront',
) {
  const res = await fetch('/api/photo-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, path, thumb_path: thumbPath ?? null, kind }),
  })
  const data = (await res.json().catch(() => ({}))) as { verdict?: string; error?: string }
  if (res.ok) return data.verdict ?? 'pass'
  if (res.status >= 400 && res.status < 500) {
    throw new PermanentJobError(data.error ?? 'That photo cannot be used. Take it again.')
  }
  throw new Error(data.error ?? `The photo check failed (${res.status})`)
}

async function uploadSelfie(userId: string, full: Blob, thumb: Blob) {
  const client = supabase()
  const id = uuid()
  const selfie_path = `${userId}/${id}.jpg`
  const thumb_path = `${userId}/${id}_thumb.jpg`

  const a = await client.storage.from('selfies').upload(selfie_path, full, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (a.error) throw new Error(a.error.message)

  const b = await client.storage.from('selfies').upload(thumb_path, thumb, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (b.error) throw new Error(b.error.message)

  return { selfie_path, thumb_path }
}

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // An expired daily login is not a bad payload: keep the job, and send
    // the person to sign in. The queue retries it once they have.
    if (res.status === 401) {
      if (data.code === 'relogin' && typeof window !== 'undefined') {
        window.location.href = '/api/auth/expired?reason=new-day'
      }
      throw new Error(data.error ?? 'Log in again')
    }
    // 4xx means the server will never accept this payload. Do not retry it.
    if (res.status >= 400 && res.status < 500) {
      throw new PermanentJobError(data.error ?? `Rejected (${res.status})`)
    }
    throw new Error(data.error ?? `Request failed (${res.status})`)
  }
  return data
}

async function currentUserId() {
  const {
    data: { user },
  } = await supabase().auth.getUser()
  if (!user) throw new Error('Signed out')
  return user.id
}

async function runClock(job: ClockJob) {
  const userId = await currentUserId()
  const { selfie_path, thumb_path } = await uploadSelfie(userId, job.selfie, job.thumb)
  // A photo of a screen or of a printed photo is refused here, before the
  // clock event is recorded; the database will not take an unchecked one.
  await checkPhoto('selfies', selfie_path, thumb_path)
  return postJson('/api/attendance', {
    type: job.type,
    lat: job.lat,
    lng: job.lng,
    accuracy_m: job.accuracy_m,
    address: job.address,
    place_name: job.place_name,
    place_source: job.place_source,
    selfie_path,
    thumb_path,
    // The phone's clock at sending, against the server's: a clock that was
    // changed shows here, and the true time of an offline capture follows.
    device_info: { ...job.device_info, sent_at: new Date().toISOString() },
    client_captured_at: job.client_captured_at,
  })
}

/**
 * Positions kept while offline, sent together and stamped with when they
 * were taken, not when they arrive (migration 029). sent_at lets the
 * server correct a phone whose clock is wrong.
 */
async function sendPings(jobs: PingJob[]) {
  return postJson('/api/pings/offline', {
    sent_at: new Date().toISOString(),
    points: jobs.map((j) => ({
      lat: j.lat,
      lng: j.lng,
      accuracy_m: j.accuracy_m,
      captured_at: j.client_captured_at,
    })),
  })
}

async function runPing(job: PingJob) {
  return sendPings([job])
}

async function runReport(job: ReportJob) {
  const userId = await currentUserId()
  const client = supabase()
  const paths: string[] = []

  for (const photo of job.photos) {
    const path = `${userId}/${uuid()}.jpg`
    const { error } = await client.storage.from('reports').upload(path, photo, {
      contentType: 'image/jpeg',
      upsert: true,
    })
    if (error) throw new Error(error.message)
    paths.push(path)
  }

  return postJson('/api/reports', {
    body: job.body,
    sales_summary: job.sales_summary,
    stock_status: job.stock_status,
    competitor_activity: job.competitor_activity,
    issues: job.issues,
    photo_paths: paths,
  })
}

/** Uploads a shelf photo for X Metrics and has it checked. */
async function uploadShelfPhoto(photo: Blob, label: string) {
  const userId = await currentUserId()
  const path = `${userId}/xm-${label}-${uuid()}.jpg`
  const { error } = await supabase().storage.from('reports').upload(path, photo, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (error) throw new Error(error.message)
  await checkPhoto('reports', path)
  return path
}

async function runXmCount(job: XmCountJob) {
  const photo_path = await uploadShelfPhoto(job.photo, 'count')
  return postJson('/api/metrics/counts', {
    outlet_id: job.outlet_id,
    lat: job.lat,
    lng: job.lng,
    accuracy_m: job.accuracy_m,
    photo_path,
    captured_at: job.client_captured_at,
    lines: job.lines,
  })
}

async function runXmSales(job: XmSalesJob) {
  const photo_path = job.photo ? await uploadShelfPhoto(job.photo, 'sales') : null
  return postJson('/api/metrics/sales', {
    outlet_id: job.outlet_id,
    sale_date: job.sale_date,
    photo_path,
    captured_at: job.client_captured_at,
    lines: job.lines,
  })
}

export async function runJob(record: OutboxRecord) {
  switch (record.job.kind) {
    case 'clock':
      return runClock(record.job)
    case 'ping':
      return runPing(record.job)
    case 'report':
      return runReport(record.job)
    case 'xm_count':
      return runXmCount(record.job)
    case 'xm_sales':
      return runXmSales(record.job)
  }
}

export interface FlushResult {
  sent: number
  failed: number
  dropped: number
  remaining: number
}

let flushing = false

/** Drains the outbox oldest-first. Safe to call on every reconnect. */
export async function flushOutbox(): Promise<FlushResult> {
  if (flushing) return { sent: 0, failed: 0, dropped: 0, remaining: (await listOutbox()).length }
  flushing = true
  const result: FlushResult = { sent: 0, failed: 0, dropped: 0, remaining: 0 }

  try {
    const records = await listOutbox()
    for (let i = 0; i < records.length; i++) {
      const record = records[i]

      // A run of positions goes as one batch rather than one request each.
      if (record.job.kind === 'ping') {
        const run: OutboxRecord[] = []
        while (i < records.length && records[i].job.kind === 'ping' && run.length < 400) {
          const r = records[i]
          const old = Date.now() - new Date(r.job.client_captured_at).getTime() > MAX_AGE_MS
          if (old || r.attempts >= MAX_ATTEMPTS) {
            await dropOutbox(r.id!)
            result.dropped += 1
          } else {
            run.push(r)
          }
          i++
        }
        i-- // the for loop moves on past the run
        if (!run.length) continue
        try {
          await sendPings(run.map((r) => r.job as PingJob))
          for (const r of run) await dropOutbox(r.id!)
          result.sent += run.length
          continue
        } catch (error) {
          if (error instanceof PermanentJobError) {
            for (const r of run) await dropOutbox(r.id!)
            result.dropped += run.length
            continue
          }
          for (const r of run) await markAttempt(r, error instanceof Error ? error.message : 'Unknown error')
          result.failed += run.length
          break
        }
      }

      const age = Date.now() - new Date(record.job.client_captured_at).getTime()
      if (age > maxAge(record.kind) || record.attempts >= MAX_ATTEMPTS) {
        await dropOutbox(record.id!)
        result.dropped += 1
        continue
      }

      try {
        await runJob(record)
        await dropOutbox(record.id!)
        result.sent += 1
      } catch (error) {
        if (error instanceof PermanentJobError) {
          await dropOutbox(record.id!)
          result.dropped += 1
          continue
        }
        await markAttempt(record, error instanceof Error ? error.message : 'Unknown error')
        result.failed += 1
        // Preserve ordering: stop at the first transient failure.
        break
      }
    }
    result.remaining = (await listOutbox()).length
    return result
  } finally {
    flushing = false
  }
}

/** Tries now; queues for later if the network is not there. */
export async function submitOrQueue(job: Parameters<typeof enqueue>[0]) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await enqueue(job)
    return { queued: true as const }
  }

  try {
    const data = await runJob({
      kind: job.kind,
      job,
      attempts: 0,
      last_error: null,
      queued_at: new Date().toISOString(),
    })
    return { queued: false as const, data }
  } catch (error) {
    if (error instanceof PermanentJobError) throw error
    await enqueue(job)
    return { queued: true as const }
  }
}
