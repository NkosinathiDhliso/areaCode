import { create } from 'zustand'

import {
  applyResult,
  createEntry,
  isParked,
  partitionExpired,
  reEnqueue,
  selectNextDue,
  shouldEnqueue,
  type AttemptResult,
  type CheckinAttempt,
  type OutboxEntry,
} from '../lib/checkinOutbox'

const STORAGE_KEY = 'areacode.checkinOutbox.v1'

// localStorage-backed persistence for the outbox. Guarded for non-browser
// environments (tests, SSR). A corrupt payload resets to empty rather than
// throwing — a lost queue is acceptable, a crashed profile is not.
function readStorage(): OutboxEntry[] {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : []
  } catch {
    return []
  }
}

function writeStorage(entries: OutboxEntry[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Quota / private-mode failures are non-fatal: the in-memory queue still
    // drives this session; only cross-reload durability is lost.
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `ob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Submits one queued entry as a replayed check-in. Injected into `pump` so the
// store stays free of the API client and is testable synchronously.
export type OutboxSubmit = (entry: OutboxEntry) => Promise<AttemptResult>

interface CheckinOutboxState {
  entries: OutboxEntry[]
  // Enqueue a failed live check-in. Only transient failures (network/5xx) queue;
  // returns whether the attempt was queued (R5.1).
  enqueue: (attempt: CheckinAttempt, statusCode: number, nowMs?: number) => boolean
  // Discard aged-out queued entries, then attempt the single oldest due entry.
  // Returns the number of entries discarded for the Replay_Window (so the caller
  // can toast honestly, R5.4).
  pump: (submit: OutboxSubmit, nowMs?: number) => Promise<{ discarded: number }>
  // Manual retry of a parked entry (R5.6). Returns 'requeued' or 'discarded'
  // when the entry has already aged out of the Replay_Window.
  retryParked: (id: string, nowMs?: number) => 'requeued' | 'discarded'
  // Manual discard of a parked entry (R5.6).
  discard: (id: string) => void
  parkedEntries: () => OutboxEntry[]
}

function persist(set: (partial: { entries: OutboxEntry[] }) => void, entries: OutboxEntry[]) {
  writeStorage(entries)
  set({ entries })
}

export const useCheckinOutboxStore = create<CheckinOutboxState>((set, get) => ({
  entries: readStorage(),

  enqueue: (attempt, statusCode, nowMs = Date.now()) => {
    if (!shouldEnqueue(statusCode)) return false
    const entry = createEntry(attempt, new Date(nowMs).toISOString(), nowMs, newId())
    persist(set, [...get().entries, entry])
    return true
  },

  pump: async (submit, nowMs = Date.now()) => {
    const { expired, kept } = partitionExpired(get().entries, nowMs)
    if (expired.length > 0) persist(set, kept)
    const due = selectNextDue(kept, nowMs)
    if (!due) return { discarded: expired.length }

    const result = await submit(due)
    const next = applyResult(due, result, Date.now())
    const after = get()
      .entries.map((e) => (e.id === due.id ? next : e))
      .filter((e): e is OutboxEntry => e !== null)
    persist(set, after)
    return { discarded: expired.length }
  },

  retryParked: (id, nowMs = Date.now()) => {
    const entry = get().entries.find((e) => e.id === id)
    if (!entry) return 'discarded'
    const revived = reEnqueue(entry, nowMs)
    if (revived === null) {
      persist(
        set,
        get().entries.filter((e) => e.id !== id),
      )
      return 'discarded'
    }
    persist(
      set,
      get().entries.map((e) => (e.id === id ? revived : e)),
    )
    return 'requeued'
  },

  discard: (id) => {
    persist(
      set,
      get().entries.filter((e) => e.id !== id),
    )
  },

  parkedEntries: () => get().entries.filter(isParked),
}))
