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
} from '@/lib/offline/db'

/**
 * A capture older than this can never be accepted by the server, so it is
 * dropped locally instead of retried forever.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 8

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export class PermanentJobError extends Error {}

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
    device_info: job.device_info,
    client_captured_at: job.client_captured_at,
  })
}

async function runPing(job: PingJob) {
  return postJson('/api/pings', {
    lat: job.lat,
    lng: job.lng,
    accuracy_m: job.accuracy_m,
  })
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

export async function runJob(record: OutboxRecord) {
  switch (record.job.kind) {
    case 'clock':
      return runClock(record.job)
    case 'ping':
      return runPing(record.job)
    case 'report':
      return runReport(record.job)
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
    for (const record of records) {
      const age = Date.now() - new Date(record.job.client_captured_at).getTime()
      if (age > MAX_AGE_MS || record.attempts >= MAX_ATTEMPTS) {
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
