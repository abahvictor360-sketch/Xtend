'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AttendanceType } from '@/lib/types'

export type OutboxKind = 'clock' | 'ping' | 'report'

export interface ClockJob {
  kind: 'clock'
  type: AttendanceType
  lat: number
  lng: number
  accuracy_m: number
  address: string | null
  place_name: string | null
  place_source: string | null
  device_info: Record<string, unknown>
  /** The moment of capture, never the moment of sync. */
  client_captured_at: string
  selfie: Blob
  thumb: Blob
}

export interface PingJob {
  kind: 'ping'
  lat: number
  lng: number
  accuracy_m: number
  client_captured_at: string
}

export interface ReportJob {
  kind: 'report'
  body: string
  sales_summary: string
  stock_status: string
  competitor_activity: string
  issues: string
  photos: Blob[]
  client_captured_at: string
}

export type OutboxJob = ClockJob | PingJob | ReportJob

export interface OutboxRecord {
  id?: number
  kind: OutboxKind
  job: OutboxJob
  attempts: number
  last_error: string | null
  queued_at: string
}

interface XtendDB extends DBSchema {
  outbox: {
    key: number
    value: OutboxRecord
    indexes: { by_queued_at: string }
  }
}

let dbPromise: Promise<IDBPDatabase<XtendDB>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<XtendDB>('xtend', 1, {
      upgrade(database) {
        const store = database.createObjectStore('outbox', {
          keyPath: 'id',
          autoIncrement: true,
        })
        store.createIndex('by_queued_at', 'queued_at')
      },
    })
  }
  return dbPromise
}

export async function enqueue(job: OutboxJob): Promise<number> {
  const database = await db()
  return database.add('outbox', {
    kind: job.kind,
    job,
    attempts: 0,
    last_error: null,
    queued_at: new Date().toISOString(),
  }) as Promise<number>
}

export async function listOutbox(): Promise<OutboxRecord[]> {
  const database = await db()
  return database.getAllFromIndex('outbox', 'by_queued_at')
}

export async function countOutbox(): Promise<number> {
  const database = await db()
  return database.count('outbox')
}

export async function dropOutbox(id: number) {
  const database = await db()
  await database.delete('outbox', id)
}

export async function markAttempt(record: OutboxRecord, error: string) {
  const database = await db()
  await database.put('outbox', { ...record, attempts: record.attempts + 1, last_error: error })
}
