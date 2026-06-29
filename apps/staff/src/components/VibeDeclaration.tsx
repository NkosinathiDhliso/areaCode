/**
 * Staff-side vibe declaration surface (Staff_Declaration_Surface).
 *
 * Lets a staff member set/update the promised vibe for the venue they are
 * assigned to, for the current shift. The promise is persisted through the
 * SAME Music_Schedule API the business operator uses
 * (`/v1/business/:businessId/music-schedule`) via the shared `api` client, so
 * the Declared_Vibe has a single source of truth (R5.4). There is no parallel
 * client and no parallel endpoint.
 *
 * Scope & denial (R5.5): the surface is strictly scoped to the staff member's
 * assigned venue, read from the authenticated staff session (`businessId`).
 * If the session is not scoped to a venue we render a denial state and issue
 * NO declaration API request.
 *
 * No phone / no SMS (R5.6): this surface never requires, reads, or persists a
 * phone number and never depends on SMS or phone-OTP.
 */

import { useEffect, useMemo, useState } from 'react'
import { Music, ShieldOff } from 'lucide-react'

import { api, type ApiError } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'
import { MUSIC_GENRES, GENRE_LABELS } from '@area-code/shared/constants/genre-weights'
import { validateMusicSchedule } from '@area-code/shared/lib/schedule-validator'
import { resolveActiveSlot, resolveScheduleClock } from '@area-code/shared/lib/scheduleResolver'
import type { MusicGenre, MusicSchedule, ScheduleSlot } from '@area-code/shared/types'

import { useStaffAuthStore } from '../stores/staffAuthStore'

// Matches the default the business Schedule_Editor uses for new schedules.
const DEFAULT_TIMEZONE = 'Africa/Johannesburg'
const END_OF_DAY = '23:59'
const END_OF_DAY_MIN = 1439

function minToHhMm(min: number): string {
  const clamped = Math.max(0, Math.min(END_OF_DAY_MIN, min))
  const hh = Math.floor(clamped / 60)
  const mm = clamped % 60
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`
}

/** The genres a resolved Active_Slot is currently promising. */
function genresOfActiveSlot(schedule: MusicSchedule, nowIso: string): MusicGenre[] | null {
  let resolved: ReturnType<typeof resolveActiveSlot> = null
  try {
    resolved = resolveActiveSlot(schedule, nowIso)
  } catch {
    // Malformed schedule on disk - treat as no active promise rather than crash.
    return null
  }
  if (!resolved) return null
  if (resolved.slot.mode === 'lineup') {
    return resolved.lineupEntry?.genres ?? null
  }
  return resolved.slot.genres ?? null
}

/**
 * Build the schedule we will POST. If a slot is already live right now we
 * rewrite it as a blanket slot carrying the chosen genres (keeping its
 * window). Otherwise we add a fresh blanket slot covering "now → end of day"
 * on the current schedule-local day. The full schedule is then revalidated
 * client-side with the SAME shared validator the backend enforces.
 */
function buildProposedSchedule(schedule: MusicSchedule, nowIso: string, genres: MusicGenre[]): MusicSchedule {
  let active: ReturnType<typeof resolveActiveSlot> = null
  try {
    active = resolveActiveSlot(schedule, nowIso)
  } catch {
    active = null
  }

  if (active) {
    const updated: ScheduleSlot = {
      slotId: active.slot.slotId,
      dayOfWeek: active.slot.dayOfWeek,
      startTime: active.slot.startTime,
      endTime: active.slot.endTime,
      startTimeMin: active.slot.startTimeMin,
      endTimeMin: active.slot.endTimeMin,
      mode: 'blanket',
      genres,
    }
    return {
      ...schedule,
      slots: schedule.slots.map((s) => (s.slotId === active!.slot.slotId ? updated : s)),
    }
  }

  // No active slot: seed one for "right now" on the schedule-local day.
  const clock = resolveScheduleClock(nowIso, schedule.timezone)
  const dayOfWeek = clock?.dayOfWeek ?? 'FRI'
  let startMin = clock?.minutesSinceMidnight ?? 0
  if (startMin >= END_OF_DAY_MIN) startMin = END_OF_DAY_MIN - 1
  const newSlot: ScheduleSlot = {
    slotId:
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `slot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    dayOfWeek,
    startTime: minToHhMm(startMin),
    endTime: END_OF_DAY,
    startTimeMin: startMin,
    endTimeMin: END_OF_DAY_MIN,
    mode: 'blanket',
    genres,
  }
  return { ...schedule, slots: [...schedule.slots, newSlot] }
}

export function VibeDeclaration() {
  const businessId = useStaffAuthStore((s) => s.businessId)

  // R5.5: a staff session that is not scoped to a venue gets a denial state
  // and issues zero declaration API requests.
  const accessAllowed = Boolean(businessId)

  const [schedule, setSchedule] = useState<MusicSchedule | null>(null)
  const [selected, setSelected] = useState<MusicGenre[]>([])
  const [loading, setLoading] = useState<boolean>(accessAllowed)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    // R5.5: never issue a schedule request when the session is not venue-scoped.
    if (!accessAllowed || !businessId) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)

    api
      .get<MusicSchedule>(`/v1/business/${encodeURIComponent(businessId)}/music-schedule`)
      .then((res) => {
        if (cancelled) return
        setSchedule(res ?? null)
        const current = res ? genresOfActiveSlot(res, new Date().toISOString()) : null
        if (current && current.length > 0) setSelected(current)
      })
      .catch((err: ApiError) => {
        if (cancelled) return
        // 404 = no schedule yet; treat as an empty promise the staff can fill.
        if (err.statusCode === 404) {
          setSchedule(null)
          return
        }
        setLoadError(err.message ?? 'Could not load the vibe.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessAllowed, businessId, reloadTick])

  const currentGenres = useMemo(() => {
    if (!schedule) return null
    return genresOfActiveSlot(schedule, new Date().toISOString())
  }, [schedule])

  function toggleGenre(genre: MusicGenre) {
    setSaveError(null)
    setSavedAt(null)
    setSelected((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]))
  }

  async function handleSave() {
    if (!businessId || saving || selected.length === 0) return
    setSaving(true)
    setSaveError(null)
    setSavedAt(null)

    const nowIso = new Date().toISOString()
    const base: MusicSchedule = schedule ?? {
      businessId,
      scheduleId: 'default',
      timezone: DEFAULT_TIMEZONE,
      slots: [],
      updatedAt: nowIso,
      schemaVersion: 1,
    }
    const proposed = buildProposedSchedule(base, nowIso, selected)

    // Reuse the SAME shared validator the backend enforces, so we surface
    // problems (e.g. an overlapping slot the operator owns) before the call.
    const validation = validateMusicSchedule(proposed)
    if (!validation.ok) {
      setSaveError(validation.error.message)
      setSaving(false)
      return
    }

    try {
      const persisted = await api.post<MusicSchedule>(
        `/v1/business/${encodeURIComponent(businessId)}/music-schedule`,
        validation.value,
      )
      setSchedule(persisted)
      setSavedAt(Date.now())
    } catch (err) {
      const apiErr = err as ApiError
      setSaveError(apiErr.message ?? 'Could not save the vibe. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ─── Denial state (R5.5) ────────────────────────────────────────────────
  if (!accessAllowed) {
    return (
      <section className="px-5 pt-2 pb-3" data-testid="vibe-declaration-denied">
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col items-center gap-2 text-center">
          <ShieldOff size={20} strokeWidth={1.5} className="text-[var(--danger)]" />
          <span className="text-[var(--text-primary)] font-semibold text-sm">Vibe not available</span>
          <span className="text-[var(--text-muted)] text-xs max-w-xs">
            Your account isn&apos;t linked to a venue, so you can&apos;t set its vibe. Ask the venue owner to check your
            access.
          </span>
        </div>
      </section>
    )
  }

  const dirty =
    selected.length > 0 &&
    (currentGenres === null ||
      currentGenres.length !== selected.length ||
      selected.some((g) => !currentGenres.includes(g)))

  return (
    <section className="px-5 pt-2 pb-3" data-testid="vibe-declaration">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-row items-center gap-2">
          <Music size={18} strokeWidth={1.5} className="text-[var(--accent)] shrink-0" />
          <span className="text-[var(--text-primary)] font-semibold text-sm flex-1">Tonight&apos;s vibe</span>
        </div>
        <p className="text-[var(--text-muted)] text-xs">
          Set what the room is promising right now. The map shows this as the venue&apos;s expected vibe until the crowd
          takes over.
        </p>

        {loading && (
          <div className="flex items-center justify-center py-4">
            <Spinner size="md" />
          </div>
        )}

        {!loading && loadError && (
          <div className="flex flex-col items-center gap-2 py-2">
            <span className="text-[var(--danger)] text-xs text-center">{loadError}</span>
            <button onClick={() => setReloadTick((n) => n + 1)} className="text-[var(--accent)] text-xs">
              Retry
            </button>
          </div>
        )}

        {!loading && !loadError && (
          <>
            <div className="flex flex-row flex-wrap gap-2" data-testid="vibe-declaration-genres">
              {MUSIC_GENRES.map((genre) => {
                const active = selected.includes(genre)
                return (
                  <button
                    key={genre}
                    type="button"
                    onClick={() => toggleGenre(genre)}
                    aria-pressed={active}
                    data-testid={`vibe-genre-${genre}`}
                    className={
                      active
                        ? 'rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--accent)] text-white'
                        : 'rounded-full px-3 py-1.5 text-xs font-medium bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-secondary)]'
                    }
                  >
                    {GENRE_LABELS[genre]}
                  </button>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={selected.length === 0 || saving || !dirty}
              data-testid="vibe-declaration-save"
              className="bg-[var(--accent)] text-white font-semibold rounded-xl py-2.5 text-sm transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
            >
              {saving ? 'Saving…' : 'Set tonight\u2019s vibe'}
            </button>

            {saveError && <p className="text-[var(--danger)] text-xs">{saveError}</p>}
            {savedAt !== null && !saveError && (
              <p className="text-[var(--text-muted)] text-xs" data-testid="vibe-declaration-saved">
                Saved. The map now shows this as your expected vibe.
              </p>
            )}
          </>
        )}
      </div>
    </section>
  )
}
