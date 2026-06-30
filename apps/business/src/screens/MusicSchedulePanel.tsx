import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, type ApiError } from '@area-code/shared/lib/api'
import { Spinner } from '@area-code/shared/components/Spinner'
import { ARCHETYPE_CATALOG } from '@area-code/shared/constants/archetype-catalog'
import { MUSIC_GENRES, GENRE_LABELS } from '@area-code/shared/constants/genre-weights'
import { validateMusicSchedule, type ScheduleValidationCode } from '@area-code/shared/lib/schedule-validator'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'
import { useBusinessStore } from '@area-code/shared/stores/businessStore'
import type {
  LineupEntry,
  LiveArchetypeBranch,
  MusicGenre,
  MusicSchedule,
  Node,
  ScheduleDayOfWeek,
  ScheduleSlot,
  ScheduleSlotMode,
} from '@area-code/shared/types'

// Order matches R4.2 (Monday-first horizontal week view).
const DAYS_OF_WEEK: ScheduleDayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const MINUTES_IN_DAY = 24 * 60

// Default IANA timezone for new schedules. The validator will reject anything
// the runtime can't resolve; this default matches the South African market.
const DEFAULT_TIMEZONE = 'Africa/Johannesburg'

// Pretty colours for slot bands. Lineup-mode slots get a slightly different
// hue from blanket so the operator can scan modes at a glance. We pick by
// slot index so each slot is visually distinct within a day.
const BAND_PALETTE: Array<{ bg: string; border: string }> = [
  { bg: 'rgba(124, 58, 237, 0.30)', border: 'rgba(124, 58, 237, 0.85)' }, // violet
  { bg: 'rgba(14, 165, 233, 0.30)', border: 'rgba(14, 165, 233, 0.85)' }, // sky
  { bg: 'rgba(244, 114, 182, 0.30)', border: 'rgba(244, 114, 182, 0.85)' }, // pink
  { bg: 'rgba(251, 146, 60, 0.30)', border: 'rgba(251, 146, 60, 0.85)' }, // orange
  { bg: 'rgba(34, 197, 94, 0.30)', border: 'rgba(34, 197, 94, 0.85)' }, // green
  { bg: 'rgba(234, 179, 8, 0.30)', border: 'rgba(234, 179, 8, 0.85)' }, // amber
]

function bandColour(index: number): { bg: string; border: string } {
  return BAND_PALETTE[index % BAND_PALETTE.length]!
}

// ── Promise-vs-crowd status line (live-vibe-declaration R5.1, R5.2) ─────────
//
// Honest read-only reflection of whatever Resolution_Branch the backend
// resolved for this venue. We do NOT recompute the branch here: it rides on
// the same Node payload the map renders from (`node.lastBranch` is the
// last-emitted Resolution_Branch, written beside `node.liveArchetypeId` by
// the live-archetype-evaluator Lambda). Reusing that single source keeps this
// surface incapable of disagreeing with the glyph on the map.
//
//   declared_promise → "Map is showing your expected vibe"
//   crowd_live       → "The crowd has taken over · {Crowd_Vibe display name}"
//   any other branch / no data → render nothing (assert nothing false)
//
// The Crowd_Vibe display name is the catalog name for the venue's currently
// rendered `liveArchetypeId`; if that id is absent or unknown we omit the
// name rather than invent one.
function archetypeDisplayName(archetypeId: string | null | undefined): string | null {
  if (!archetypeId) return null
  return ARCHETYPE_CATALOG.find((a) => a.id === archetypeId)?.name ?? null
}

interface VibeStatusLineProps {
  branch: LiveArchetypeBranch | null | undefined
  liveArchetypeId: string | null | undefined
  t: (key: string) => string
}

function VibeStatusLine({ branch, liveArchetypeId, t }: VibeStatusLineProps) {
  if (branch === 'declared_promise') {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-raised)] px-3 py-2"
        data-testid="music-schedule-vibe-status"
        data-branch="declared_promise"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--accent)]" />
        <span className="text-[var(--text-secondary)] text-xs">{t('biz.musicSchedule.status.promise')}</span>
      </div>
    )
  }

  if (branch === 'crowd_live') {
    const crowdName = archetypeDisplayName(liveArchetypeId)
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-[var(--success,#22c55e)]/40 bg-[var(--bg-raised)] px-3 py-2"
        data-testid="music-schedule-vibe-status"
        data-branch="crowd_live"
      >
        <span aria-hidden className="h-2 w-2 rounded-full bg-[var(--success,#22c55e)]" />
        <span className="text-[var(--text-secondary)] text-xs">
          {t('biz.musicSchedule.status.crowd')}
          {crowdName ? ` · ${crowdName}` : ''}
        </span>
      </div>
    )
  }

  // Any other branch (default / eclectic_fallback / schedule_* under the
  // flag-off legacy path) or no resolved data ⇒ neutral, assert nothing.
  return null
}

// ── Cross_Midnight_Pair plumbing (R3.12, R4.13, R4.14) ─────────────────────
//
// A Cross_Midnight_Pair is two same-day Schedule_Slots whose `slotId`s share
// the convention `pair-<base>-a` (the dayN half, ending 23:59) and
// `pair-<base>-b` (the dayN+1 half, starting 00:00). The id pattern is the
// editor's source of truth so detecting pairs on read is cheap and exact,
// and editing one half automatically applies to both.
//
// Per R3.12 the validator already accepts the two same-day slots as-is, so
// the pair lives on disk as two ordinary ScheduleSlots; the pairing is a
// purely read-side derivation.
const PAIR_SLOT_ID_PATTERN = /^pair-([0-9a-zA-Z_-]+)-(a|b)$/

function nextDay(d: ScheduleDayOfWeek): ScheduleDayOfWeek {
  const i = DAYS_OF_WEEK.indexOf(d)
  return DAYS_OF_WEEK[(i + 1) % 7]!
}

function pairBaseOf(slotId: string): string | null {
  const m = PAIR_SLOT_ID_PATTERN.exec(slotId)
  return m ? (m[1] ?? null) : null
}

function pairHalfOf(slotId: string): 'a' | 'b' | null {
  const m = PAIR_SLOT_ID_PATTERN.exec(slotId)
  return m ? (m[2] as 'a' | 'b') : null
}

function newPairBase(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

interface CrossMidnightPair {
  base: string
  a: ScheduleSlot
  b: ScheduleSlot
}

/**
 * Group slots into Cross_Midnight_Pairs based on the `pair-<base>-a/b` id
 * convention. Half-pairs (only the `a` or only the `b` survived) are
 * surfaced as a standalone slot via `singles` so we never silently drop a
 * slot, even in malformed-on-disk states.
 */
function derivePairs(slots: ScheduleSlot[]): { pairs: CrossMidnightPair[]; singles: ScheduleSlot[] } {
  const halves = new Map<string, { a?: ScheduleSlot; b?: ScheduleSlot }>()
  const singles: ScheduleSlot[] = []
  for (const slot of slots) {
    const base = pairBaseOf(slot.slotId)
    const half = pairHalfOf(slot.slotId)
    if (!base || !half) {
      singles.push(slot)
      continue
    }
    const bucket = halves.get(base) ?? {}
    bucket[half] = slot
    halves.set(base, bucket)
  }
  const pairs: CrossMidnightPair[] = []
  for (const [base, bucket] of halves) {
    if (bucket.a && bucket.b) {
      pairs.push({ base, a: bucket.a, b: bucket.b })
    } else if (bucket.a) {
      singles.push(bucket.a)
    } else if (bucket.b) {
      singles.push(bucket.b)
    }
  }
  return { pairs, singles }
}

/**
 * Stable colour for a Cross_Midnight_Pair. We hash the base id to a slot in
 * `BAND_PALETTE` so both halves render with the same hue without having to
 * coordinate the index across two day rows.
 */
function pairColour(base: string): { bg: string; border: string } {
  let h = 0
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0
  return BAND_PALETTE[h % BAND_PALETTE.length]!
}

/**
 * Build a virtual merged ScheduleSlot from a Cross_Midnight_Pair so the
 * editor sees the slot the operator originally typed in (R4.14): start on
 * dayA at A.startTime, end on dayA at B.endTime (`endTime < startTime` is
 * the cross-midnight signal). The merged slot keeps A's `slotId` so the
 * save path can recover the pair base.
 */
function mergePairForEditing(pair: CrossMidnightPair): ScheduleSlot {
  const merged: ScheduleSlot = {
    slotId: pair.a.slotId, // pair-<base>-a - preserved so save can re-pair
    dayOfWeek: pair.a.dayOfWeek,
    startTime: pair.a.startTime,
    endTime: pair.b.endTime,
    startTimeMin: pair.a.startTimeMin,
    endTimeMin: pair.b.endTimeMin,
    mode: pair.a.mode,
  }
  if (pair.a.mode === 'blanket') {
    merged.genres = [...(pair.a.genres ?? [])]
  } else {
    // Concatenate A's tail with B's head. The split was deterministic on
    // save, so this faithfully recovers the operator's original lineup.
    merged.lineup = [...(pair.a.lineup ?? []), ...(pair.b.lineup ?? [])]
  }
  return merged
}

function pctFromMinutes(min: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_IN_DAY, min))
  return `${(clamped / MINUTES_IN_DAY) * 100}%`
}

function hhmmToMinutes(hhmm: string): number {
  const [hh, mm] = hhmm.split(':')
  return Number(hh) * 60 + Number(mm)
}

interface MusicScheduleResponse {
  schedule: MusicSchedule | null
}

export function MusicSchedulePanel() {
  const { t } = useTranslation()
  const jwtBusinessId = useBusinessAuthStore((s) => s.businessId)
  const nodes = useBusinessStore((s) => s.nodes)

  // The Schedule_Editor scopes a Music_Schedule to a venue's businessId.
  // The operator's JWT must include the same businessId per R4.11/R4.12;
  // otherwise we render a denial state and issue zero schedule API calls.
  const venueNode: Node | null = nodes[0] ?? null
  const venueBusinessId = venueNode?.businessId ?? null

  // Promise-vs-crowd branch the map is currently rendering for this venue,
  // read straight off the Node payload (live-vibe-declaration R5.2). No
  // recomputation: the evaluator writes `lastBranch`/`liveArchetypeId` and the
  // consumer map reads the same fields, so this stays in lock-step.
  const liveBranch = venueNode?.lastBranch ?? null
  const liveArchetypeId = venueNode?.liveArchetypeId ?? null

  const accessAllowed = useMemo(() => {
    if (!jwtBusinessId) return false
    if (!venueBusinessId) return false
    return jwtBusinessId === venueBusinessId
  }, [jwtBusinessId, venueBusinessId])

  const [schedule, setSchedule] = useState<MusicSchedule | null>(null)
  const [loading, setLoading] = useState<boolean>(accessAllowed)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState<boolean>(false)
  const [editorSlot, setEditorSlot] = useState<ScheduleSlot | null>(null)
  const [reloadTick, setReloadTick] = useState<number>(0)

  useEffect(() => {
    // R4.12: never issue any schedule API requests when the operator's JWT
    // claims do not include the venue's businessId.
    if (!accessAllowed || !venueBusinessId) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)

    api
      .get<MusicScheduleResponse>(`/v1/business/${encodeURIComponent(venueBusinessId)}/music-schedule`)
      .then((res) => {
        if (cancelled) return
        setSchedule(res.schedule ?? null)
      })
      .catch((err: ApiError) => {
        if (cancelled) return
        // 404 = no schedule yet, treat as empty state per R4.10.
        if (err.statusCode === 404) {
          setSchedule(null)
          return
        }
        setLoadError(err.message ?? t('biz.musicSchedule.loadFailed'))
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [accessAllowed, venueBusinessId, reloadTick, t])

  function openEditorForNewSlot() {
    setEditorSlot(null)
    setEditorOpen(true)
  }

  /**
   * Open the editor for an existing slot.
   *
   * If the slot is one half of a Cross_Midnight_Pair we merge both halves
   * into a single virtual ScheduleSlot (start on dayA, end on dayA at
   * B.endTime so the editor's `endTime < startTime` cross-midnight branch
   * fires) and pass that to the editor. Editing either half therefore
   * always operates on the pair as a unit (R4.14).
   */
  function openEditorForExistingSlot(slot: ScheduleSlot) {
    const base = pairBaseOf(slot.slotId)
    if (base && schedule) {
      const { pairs } = derivePairs(schedule.slots)
      const pair = pairs.find((p) => p.base === base)
      if (pair) {
        setEditorSlot(mergePairForEditing(pair))
        setEditorOpen(true)
        return
      }
    }
    setEditorSlot(slot)
    setEditorOpen(true)
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditorSlot(null)
  }

  function handleSavedSchedule(next: MusicSchedule) {
    setSchedule(next)
    closeEditor()
  }

  // ─── No venue yet ────────────────────────────────────────────────────────
  // A legitimate owner who has not added a venue has no node to scope a
  // schedule to. Show a "create a venue first" empty state rather than the
  // access-denied branch (which wrongly implies a permissions problem).
  if (!venueNode) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3" data-testid="music-schedule-no-venue">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne] text-center">
          {t('biz.musicSchedule.noVenue.title', 'No venue yet')}
        </span>
        <span className="text-[var(--text-muted)] text-sm text-center max-w-sm">
          {t(
            'biz.musicSchedule.noVenue.body',
            'Add a venue in Settings first, then you can set its weekly music schedule here.',
          )}
        </span>
      </div>
    )
  }

  // ─── Denial state (R4.11, R4.12) ────────────────────────────────────────────
  if (!accessAllowed) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3" data-testid="music-schedule-denied">
        <span className="text-[var(--text-primary)] font-bold text-lg font-[Syne] text-center">
          {t('biz.musicSchedule.denied.title')}
        </span>
        <span className="text-[var(--text-muted)] text-sm text-center max-w-sm">
          {t('biz.musicSchedule.denied.body')}
        </span>
      </div>
    )
  }

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner size="lg" />
      </div>
    )
  }

  // ─── Load failure ──────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-3">
        <span className="text-[var(--danger)] text-sm text-center">{loadError}</span>
        <button onClick={() => setReloadTick((n) => n + 1)} className="text-[var(--accent)] text-sm">
          {t('biz.musicSchedule.retry')}
        </button>
      </div>
    )
  }

  const slots = schedule?.slots ?? []
  // Either we already have a schedule, or we synthesise an empty one so the
  // first save POSTs a complete MusicSchedule body.
  const editingSchedule: MusicSchedule = schedule ?? {
    businessId: venueBusinessId!,
    scheduleId: 'default',
    timezone: DEFAULT_TIMEZONE,
    slots: [],
    updatedAt: new Date().toISOString(),
    schemaVersion: 1,
  }

  // ─── Empty state (R4.10) ───────────────────────────────────────────────────
  if (slots.length === 0) {
    return (
      <div className="p-5 flex flex-col items-center justify-center h-full gap-4" data-testid="music-schedule-empty">
        <span className="text-[var(--text-primary)] font-bold text-xl font-[Syne] text-center">
          {t('biz.musicSchedule.empty.title')}
        </span>
        <span className="text-[var(--text-muted)] text-sm text-center max-w-sm">
          {t('biz.musicSchedule.empty.body')}
        </span>
        <VibeStatusLine branch={liveBranch} liveArchetypeId={liveArchetypeId} t={t} />
        <button
          type="button"
          onClick={openEditorForNewSlot}
          className="bg-[var(--accent)] text-white rounded-xl px-5 py-2.5 text-sm font-medium"
          data-testid="music-schedule-add-first-slot"
        >
          {t('biz.musicSchedule.empty.cta')}
        </button>
        {editorOpen && (
          <SlotEditorSheet
            schedule={editingSchedule}
            slot={editorSlot}
            onSaved={handleSavedSchedule}
            onClose={closeEditor}
          />
        )}
      </div>
    )
  }

  // ─── Loaded state: horizontal week view (R4.2) ─────────────────────────────
  // Group Cross_Midnight_Pairs (R3.12) so both halves can render with the
  // same hue and a continuation indicator across the day boundary. The
  // underlying ScheduleSlots stay distinct on the wire.
  const { pairs: crossMidnightPairs } = derivePairs(slots)
  const pairBaseById = new Map<string, string>()
  for (const p of crossMidnightPairs) {
    pairBaseById.set(p.a.slotId, p.base)
    pairBaseById.set(p.b.slotId, p.base)
  }
  const slotsByDay = groupSlotsByDay(slots)

  return (
    <div className="p-5 flex flex-col gap-4" data-testid="music-schedule-panel">
      <div className="flex flex-row items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">{t('biz.musicSchedule.title')}</h2>
          <span className="text-[var(--text-muted)] text-xs">{t('biz.musicSchedule.subtitle')}</span>
        </div>
        <button
          type="button"
          onClick={openEditorForNewSlot}
          className="bg-[var(--accent)] text-white rounded-xl px-4 py-2 text-xs font-medium"
          data-testid="music-schedule-add-slot"
        >
          {t('biz.musicSchedule.addSlot')}
        </button>
      </div>

      <VibeStatusLine branch={liveBranch} liveArchetypeId={liveArchetypeId} t={t} />

      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 overflow-x-auto">
        <WeekTimeline
          slotsByDay={slotsByDay}
          pairBaseById={pairBaseById}
          onSlotClick={openEditorForExistingSlot}
          dayLabel={(day) => t(`biz.musicSchedule.day.${day}`)}
        />
      </div>

      {editorOpen && (
        <SlotEditorSheet
          schedule={editingSchedule}
          slot={editorSlot}
          onSaved={handleSavedSchedule}
          onClose={closeEditor}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Week timeline - 7 day rows with a 24-hour timeline drawn beneath each row.
// Slots are positioned by (startTimeMin, endTimeMin) as % of the day.
// ───────────────────────────────────────────────────────────────────────────

interface WeekTimelineProps {
  slotsByDay: Record<ScheduleDayOfWeek, ScheduleSlot[]>
  pairBaseById: Map<string, string>
  onSlotClick: (slot: ScheduleSlot) => void
  dayLabel: (day: ScheduleDayOfWeek) => string
}

function WeekTimeline({ slotsByDay, pairBaseById, onSlotClick, dayLabel }: WeekTimelineProps) {
  return (
    <div className="flex flex-col gap-2 min-w-[640px]">
      {/* hour ticks header */}
      <div className="flex flex-row items-center pl-12">
        <div className="flex-1 relative h-4">
          {[0, 6, 12, 18, 24].map((hour) => (
            <span
              key={hour}
              className="absolute top-0 text-[10px] text-[var(--text-muted)] tabular-nums -translate-x-1/2"
              style={{ left: `${(hour / 24) * 100}%` }}
            >
              {hour.toString().padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>

      {DAYS_OF_WEEK.map((day) => {
        const slots = slotsByDay[day] ?? []
        return (
          <div key={day} className="flex flex-row items-stretch gap-2" data-testid={`music-schedule-day-${day}`}>
            <div className="w-10 flex-shrink-0 flex items-center text-[var(--text-secondary)] text-xs uppercase tracking-wider">
              {dayLabel(day)}
            </div>
            <div className="flex-1 relative h-9 rounded-lg bg-[var(--bg-raised)] border border-[var(--border)] overflow-hidden">
              {/* faint hour gridlines */}
              {[6, 12, 18].map((hour) => (
                <div
                  key={hour}
                  className="absolute top-0 bottom-0 w-px bg-[var(--border)]/60"
                  style={{ left: `${(hour / 24) * 100}%` }}
                />
              ))}

              {slots.map((slot, idx) => {
                const pairBase = pairBaseById.get(slot.slotId) ?? null
                const half = pairBase ? pairHalfOf(slot.slotId) : null
                const colour = pairBase ? pairColour(pairBase) : bandColour(idx)
                // Render the band edge-to-edge of the day boundary on the
                // joined side so the pair reads as a single span (R4.14).
                const joinLeft = half === 'b'
                const joinRight = half === 'a'
                return (
                  <button
                    key={slot.slotId}
                    type="button"
                    onClick={() => onSlotClick(slot)}
                    className="absolute top-1 bottom-1 text-[10px] font-medium text-[var(--text-primary)] truncate text-left px-2 transition-colors"
                    style={{
                      left: pctFromMinutes(slot.startTimeMin),
                      width: `calc(${pctFromMinutes(slot.endTimeMin - slot.startTimeMin)})`,
                      backgroundColor: colour.bg,
                      borderLeft: joinLeft ? 'none' : `2px solid ${colour.border}`,
                      borderTopLeftRadius: joinLeft ? 0 : '0.375rem',
                      borderBottomLeftRadius: joinLeft ? 0 : '0.375rem',
                      borderTopRightRadius: joinRight ? 0 : '0.375rem',
                      borderBottomRightRadius: joinRight ? 0 : '0.375rem',
                    }}
                    title={
                      pairBase
                        ? `Cross-midnight slot · ${slot.startTime}-${slot.endTime} · ${slot.mode}`
                        : `${slot.startTime}-${slot.endTime} · ${slot.mode}`
                    }
                    data-testid={`music-schedule-slot-${slot.slotId}`}
                    data-mode={slot.mode}
                    {...(pairBase ? { 'data-pair-base': pairBase } : {})}
                  >
                    {slot.startTime}-{slot.endTime}
                    {slot.mode === 'lineup' ? ' · lineup' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function groupSlotsByDay(slots: ScheduleSlot[]): Record<ScheduleDayOfWeek, ScheduleSlot[]> {
  const grouped: Record<ScheduleDayOfWeek, ScheduleSlot[]> = {
    MON: [],
    TUE: [],
    WED: [],
    THU: [],
    FRI: [],
    SAT: [],
    SUN: [],
  }
  for (const slot of slots) {
    const bucket = grouped[slot.dayOfWeek]
    if (bucket) bucket.push(slot)
  }
  for (const day of DAYS_OF_WEEK) {
    grouped[day]!.sort((a, b) => a.startTimeMin - b.startTimeMin)
  }
  return grouped
}

// ─────────────────────────────────────────────────────────────────────────────
// SlotEditorSheet - full-screen modal for creating or editing one ScheduleSlot.
//
// Validation runs on every change by composing the proposed full schedule
// (existing slots minus the one being edited + the candidate slot) and
// passing it to the shared `validateMusicSchedule`. The first failure is
// surfaced inline against the offending field. Save is disabled while any
// error is present (R4.5, R4.9).
//
// Cross_Midnight_Pair handling (`endTime < startTime`) is task 13.3 - for
// now the editor surfaces a friendly inline message and blocks save.
// ─────────────────────────────────────────────────────────────────────────────

interface SlotEditorSheetProps {
  schedule: MusicSchedule
  slot: ScheduleSlot | null
  onSaved: (next: MusicSchedule) => void
  onClose: () => void
}

interface ServerValidationError {
  code: ScheduleValidationCode | string
  field: string
  message: string
  slotId?: string
}

interface InlineErrors {
  // Maps a logical field key to the human-readable error message.
  // Keys: 'dayOfWeek' | 'startTime' | 'endTime' | 'genres' | 'lineup' |
  //       `lineup[${i}].startTime` | `lineup[${i}].genres` |
  //       `lineup[${i}].djName` | 'overlap' | 'cross_midnight'
  [field: string]: string | undefined
}

function newSlotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for very old runtimes; we still want a unique-ish key.
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function buildInitialDraft(slot: ScheduleSlot | null): SlotDraft {
  if (slot) {
    return {
      slotId: slot.slotId,
      dayOfWeek: slot.dayOfWeek,
      startTime: slot.startTime,
      endTime: slot.endTime,
      mode: slot.mode,
      genres: slot.mode === 'blanket' ? [...(slot.genres ?? [])] : [],
      lineup:
        slot.mode === 'lineup'
          ? (slot.lineup ?? []).map((entry) => ({
              startTime: entry.startTime,
              djName: entry.djName ?? '',
              genres: [...entry.genres],
            }))
          : [],
    }
  }
  return {
    slotId: newSlotId(),
    dayOfWeek: 'FRI',
    startTime: '20:00',
    endTime: '23:00',
    mode: 'blanket',
    genres: ['amapiano'],
    lineup: [],
  }
}

interface SlotDraft {
  slotId: string
  dayOfWeek: ScheduleDayOfWeek
  startTime: string
  endTime: string
  mode: ScheduleSlotMode
  genres: MusicGenre[] // valid only when mode === 'blanket'
  lineup: LineupDraft[] // valid only when mode === 'lineup'
}

interface LineupDraft {
  startTime: string
  djName: string
  genres: MusicGenre[]
}

/**
 * Detect whether the draft represents a Cross_Midnight_Pair: `endTime` is
 * the same as or earlier than `startTime`, signalling the slot wraps past
 * midnight (R3.12 / R4.13).
 */
function draftIsCrossMidnight(draft: SlotDraft): boolean {
  if (!isHhMm(draft.startTime) || !isHhMm(draft.endTime)) return false
  return hhmmToMinutes(draft.endTime) <= hhmmToMinutes(draft.startTime)
}

/**
 * Compose a candidate ScheduleSlot from the editor's current draft.
 * Mode-specific fields that aren't relevant are omitted (so the validator
 * doesn't reject e.g. a blanket slot that carries a stale lineup list).
 */
function draftToSlot(draft: SlotDraft): ScheduleSlot {
  const startTimeMin = isHhMm(draft.startTime) ? hhmmToMinutes(draft.startTime) : 0
  const endTimeMin = isHhMm(draft.endTime) ? hhmmToMinutes(draft.endTime) : 0
  const slot: ScheduleSlot = {
    slotId: draft.slotId,
    dayOfWeek: draft.dayOfWeek,
    startTime: draft.startTime,
    endTime: draft.endTime,
    startTimeMin,
    endTimeMin,
    mode: draft.mode,
  }
  if (draft.mode === 'blanket') {
    slot.genres = draft.genres
  } else {
    slot.lineup = draft.lineup.map<LineupEntry>((entry) => {
      const lineupEntry: LineupEntry = {
        startTime: entry.startTime,
        startTimeMin: isHhMm(entry.startTime) ? hhmmToMinutes(entry.startTime) : 0,
        genres: entry.genres,
      }
      if (entry.djName.trim().length > 0) lineupEntry.djName = entry.djName.trim()
      return lineupEntry
    })
  }
  return slot
}

function isHhMm(value: string): boolean {
  return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value)
}

/**
 * Split a cross-midnight draft into the two same-day ScheduleSlots required
 * by R3.12 / R4.13:
 *   - half A on the entered dayOfWeek, `startTime` → `23:59`
 *   - half B on the next dayOfWeek, `00:00` → `endTime`
 *
 * In `blanket` mode both halves get the same genres. In `lineup` mode we
 * keep entries whose minute is `≥ startTimeMin` on A and move entries
 * whose minute is `< startTimeMin` to B; we then force B's first
 * LineupEntry to `00:00` (synthesised from A's tail genres / DJ if the
 * operator did not provide one) so the lineup-first-entry-aligned-with-
 * slot-start rule (R3.7) holds on both halves.
 */
function splitCrossMidnightDraft(draft: SlotDraft, baseId: string): [ScheduleSlot, ScheduleSlot] {
  const startMin = hhmmToMinutes(draft.startTime)
  const endMin = hhmmToMinutes(draft.endTime)
  const a: ScheduleSlot = {
    slotId: `pair-${baseId}-a`,
    dayOfWeek: draft.dayOfWeek,
    startTime: draft.startTime,
    endTime: '23:59',
    startTimeMin: startMin,
    endTimeMin: 1439,
    mode: draft.mode,
  }
  const b: ScheduleSlot = {
    slotId: `pair-${baseId}-b`,
    dayOfWeek: nextDay(draft.dayOfWeek),
    startTime: '00:00',
    endTime: draft.endTime,
    startTimeMin: 0,
    endTimeMin: endMin,
    mode: draft.mode,
  }
  if (draft.mode === 'blanket') {
    a.genres = [...draft.genres]
    b.genres = [...draft.genres]
    return [a, b]
  }
  const aLineup: LineupEntry[] = []
  const bLineup: LineupEntry[] = []
  for (const entry of draft.lineup) {
    if (!isHhMm(entry.startTime)) continue
    const min = hhmmToMinutes(entry.startTime)
    const baseEntry: LineupEntry = {
      startTime: entry.startTime,
      startTimeMin: min,
      genres: [...entry.genres],
    }
    if (entry.djName.trim().length > 0) baseEntry.djName = entry.djName.trim()
    if (min >= startMin) aLineup.push(baseEntry)
    else bLineup.push(baseEntry)
  }
  // Force B's first entry to 00:00 so half B passes R3.7 on its own.
  if (bLineup.length === 0 || bLineup[0]!.startTimeMin !== 0) {
    const tail = aLineup[aLineup.length - 1]
    const seed: LineupEntry = {
      startTime: '00:00',
      startTimeMin: 0,
      genres: tail ? [...tail.genres] : [...(draft.lineup[0]?.genres ?? ['amapiano'])],
    }
    if (tail?.djName) seed.djName = tail.djName
    bLineup.unshift(seed)
  }
  a.lineup = aLineup
  b.lineup = bLineup
  return [a, b]
}

/**
 * Build the proposed full schedule by replacing or appending the candidate
 * slot(s) into the existing schedule's slot list. The validator is then run
 * on this whole shape so per-slot AND cross-slot rules (R3.9 overlaps) fire.
 *
 * When the draft is cross-midnight we pass both halves of the pair as
 * `candidates`; we also strip any pre-existing slots whose slotId belongs
 * to the same `pair-<base>-{a,b}` so re-editing a pair replaces - never
 * duplicates - the on-disk halves.
 */
function buildProposedSchedule(schedule: MusicSchedule, candidates: ScheduleSlot[]): MusicSchedule {
  const candidateIds = new Set(candidates.map((c) => c.slotId))
  const candidateBases = new Set(candidates.map((c) => pairBaseOf(c.slotId)).filter((b): b is string => b !== null))
  const existing = schedule.slots.filter((s) => {
    if (candidateIds.has(s.slotId)) return false
    const base = pairBaseOf(s.slotId)
    if (base && candidateBases.has(base)) return false
    return true
  })
  return {
    ...schedule,
    slots: [...existing, ...candidates],
  }
}

/**
 * Translate a `ScheduleValidationError` (or a server-returned equivalent)
 * into an `InlineErrors` map keyed by the editor's logical field names.
 *
 * The validator emits dotted-path field names (`slots[3].lineup[1].genres`).
 * We map the slot index back to the candidate slot via slotId equality -
 * if the error belongs to a different slot, we still show it so the operator
 * sees the full picture (e.g. "your new slot overlaps an existing slot").
 */
function mapValidationError(
  err: { code: string; field: string; message: string; slotId?: string },
  candidateSlotId: string,
): InlineErrors {
  const inline: InlineErrors = {}

  // Cross-slot overlap (R3.9). Field looks like `slots[<j>]`.
  if (err.code === 'overlapping_slots') {
    inline['overlap'] = err.message
    return inline
  }

  // Errors not on our slot are still surfaced under a generic key so we never
  // silently swallow them (e.g. validation can fail because another slot is
  // somehow malformed in storage).
  if (err.slotId !== undefined && err.slotId !== candidateSlotId) {
    inline['_otherSlot'] = err.message
    return inline
  }

  switch (err.code) {
    case 'invalid_day_of_week':
      inline['dayOfWeek'] = err.message
      break
    case 'invalid_time_format': {
      // Field will be `slots[i].startTime` or `slots[i].endTime` or
      // `slots[i].lineup[j].startTime`.
      if (err.field.endsWith('.endTime')) inline['endTime'] = err.message
      else if (err.field.includes('.lineup[')) {
        const m = /\.lineup\[(\d+)\]\.startTime$/.exec(err.field)
        if (m) inline[`lineup[${m[1]}].startTime`] = err.message
        else inline['lineup'] = err.message
      } else inline['startTime'] = err.message
      break
    }
    case 'invalid_slot_interval':
      inline['endTime'] = err.message
      break
    case 'invalid_blanket_genres':
      inline['genres'] = err.message
      break
    case 'blanket_must_not_have_lineup':
      inline['lineup'] = err.message
      break
    case 'invalid_lineup':
      inline['lineup'] = err.message
      break
    case 'invalid_lineup_entry': {
      const m = /\.lineup\[(\d+)\]\.genres$/.exec(err.field)
      if (m) inline[`lineup[${m[1]}].genres`] = err.message
      else inline['lineup'] = err.message
      break
    }
    case 'lineup_first_entry_misaligned':
      inline['lineup[0].startTime'] = err.message
      break
    case 'lineup_entry_outside_slot': {
      const m = /\.lineup\[(\d+)\]\.startTime$/.exec(err.field)
      if (m) inline[`lineup[${m[1]}].startTime`] = err.message
      else inline['lineup'] = err.message
      break
    }
    case 'lineup_duplicate_start_times': {
      const m = /\.lineup\[(\d+)\]\.startTime$/.exec(err.field)
      if (m) inline[`lineup[${m[1]}].startTime`] = err.message
      else inline['lineup'] = err.message
      break
    }
    case 'lineup_must_not_have_top_genres':
      inline['genres'] = err.message
      break
    case 'invalid_timezone':
      inline['_global'] = err.message
      break
    case 'invalid_mode':
      inline['_global'] = err.message
      break
    case 'schema_shape':
      // Map common Zod-shape paths back to the user-facing field.
      if (err.field.endsWith('.startTime')) inline['startTime'] = err.message
      else if (err.field.endsWith('.endTime')) inline['endTime'] = err.message
      else if (err.field.endsWith('.genres')) inline['genres'] = err.message
      else if (err.field.includes('.lineup')) inline['lineup'] = err.message
      else inline['_global'] = err.message
      break
    default:
      inline['_global'] = err.message
  }
  return inline
}

function SlotEditorSheet({ schedule, slot, onSaved, onClose }: SlotEditorSheetProps) {
  const [draft, setDraft] = useState<SlotDraft>(() => buildInitialDraft(slot))
  const [saving, setSaving] = useState<boolean>(false)
  const [serverError, setServerError] = useState<InlineErrors | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false)
  const [deleting, setDeleting] = useState<boolean>(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const isEditing = slot !== null

  // ── Cross_Midnight_Pair (R3.12, R4.13). When `endTime <= startTime` the
  //    slot wraps past midnight; on save we split into two same-day halves.
  //    The pair base is preserved across edits via the `pair-<base>-a` /
  //    `pair-<base>-b` slotId convention so editing one half always edits
  //    both (R4.14).
  const isCrossMidnight = useMemo(() => draftIsCrossMidnight(draft), [draft])

  const editingPairBase = useMemo(() => (slot ? pairBaseOf(slot.slotId) : null), [slot])

  // ── Inline validation. We compute on every render so the user sees
  //    instant feedback as they edit. The validator is pure and cheap.
  const inlineErrors = useMemo<InlineErrors>(() => {
    const errors: InlineErrors = {}

    // Local field-format checks - give crisp messages before the validator
    // has to repeat them with longer prose.
    if (!isHhMm(draft.startTime)) errors['startTime'] = 'Start time must be HH:mm (00:00-23:59).'
    if (!isHhMm(draft.endTime)) errors['endTime'] = 'End time must be HH:mm (00:00-23:59).'
    if (draft.mode === 'blanket' && draft.genres.length === 0) {
      errors['genres'] = 'Pick at least one genre.'
    }
    if (draft.mode === 'lineup' && draft.lineup.length === 0) {
      errors['lineup'] = 'Add at least one lineup entry.'
    }
    if (draft.mode === 'lineup') {
      draft.lineup.forEach((entry, idx) => {
        if (!isHhMm(entry.startTime)) {
          errors[`lineup[${idx}].startTime`] = 'Use HH:mm.'
        }
        if (entry.djName.length > 60) {
          errors[`lineup[${idx}].djName`] = 'DJ name is at most 60 characters.'
        }
        if (entry.genres.length === 0) {
          errors[`lineup[${idx}].genres`] = 'Pick at least one genre.'
        }
      })
    }

    // Run the shared validator on the full proposed schedule so cross-slot
    // overlap (R3.9) and the lineup-first-entry-aligned-with-slot-start
    // rule (R3.7) fire correctly. For cross-midnight drafts we validate the
    // already-split pair so per-half rules (R3.7 on B in particular) catch
    // anything the operator could not have spotted from the merged view.
    if (Object.keys(errors).length === 0) {
      const base = editingPairBase ?? newPairBase()
      const candidates = isCrossMidnight ? splitCrossMidnightDraft(draft, base) : [draftToSlot(draft)]
      const proposed = buildProposedSchedule(schedule, candidates)
      const result = validateMusicSchedule(proposed)
      if (!result.ok) {
        // Surface the offending half's id so `mapValidationError` keeps
        // pair-internal issues from being mistaken for "another slot is
        // malformed" warnings.
        const candidateIds = new Set(candidates.map((c) => c.slotId))
        const mappedSlotId =
          result.error.slotId && candidateIds.has(result.error.slotId) ? result.error.slotId : draft.slotId
        const mapped = mapValidationError(result.error, mappedSlotId)
        Object.assign(errors, mapped)
      }
    }

    return errors
  }, [draft, schedule, isCrossMidnight, editingPairBase])

  // The Save button merges inline (client-side) errors with server-returned
  // errors so a stale 400 still keeps Save disabled. The dirty-state copy
  // (server errors) is cleared as soon as the operator changes any field.
  const allErrors: InlineErrors = useMemo(
    () => ({ ...inlineErrors, ...(serverError ?? {}) }),
    [inlineErrors, serverError],
  )
  const hasErrors = Object.values(allErrors).some((v) => typeof v === 'string' && v.length > 0)

  function patchDraft(patch: Partial<SlotDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }))
    // R4.5 - keep dirty state, but clear stale server-side errors as soon as
    // the operator modifies any field. The next save will surface fresh
    // errors against the new shape.
    setServerError(null)
  }

  function handleModeChange(nextMode: ScheduleSlotMode) {
    setDraft((prev) => {
      if (prev.mode === nextMode) return prev
      // R4.4: when toggling blanket → lineup AND the lineup is empty,
      // pre-seed one LineupEntry at the slot's startTime mirroring the
      // current blanket genres. This makes the first-entry-aligned-with-
      // slot-start rule (R3.7) trivially true by default.
      if (nextMode === 'lineup' && prev.lineup.length === 0) {
        const seed: LineupDraft = {
          startTime: prev.startTime,
          djName: '',
          genres: prev.genres.length > 0 ? [...prev.genres] : ['amapiano'],
        }
        return { ...prev, mode: nextMode, lineup: [seed] }
      }
      return { ...prev, mode: nextMode }
    })
    setServerError(null)
  }

  function toggleGenre(g: MusicGenre) {
    setDraft((prev) => {
      const has = prev.genres.includes(g)
      let next: MusicGenre[]
      if (has) next = prev.genres.filter((x) => x !== g)
      else if (prev.genres.length >= 5) return prev
      else next = [...prev.genres, g]
      return { ...prev, genres: next }
    })
    setServerError(null)
  }

  function patchLineupEntry(idx: number, patch: Partial<LineupDraft>) {
    setDraft((prev) => {
      const next = prev.lineup.slice()
      const existing = next[idx]
      if (!existing) return prev
      next[idx] = { ...existing, ...patch }
      return { ...prev, lineup: next }
    })
    setServerError(null)
  }

  function toggleLineupGenre(idx: number, g: MusicGenre) {
    setDraft((prev) => {
      const next = prev.lineup.slice()
      const existing = next[idx]
      if (!existing) return prev
      const has = existing.genres.includes(g)
      let nextGenres: MusicGenre[]
      if (has) nextGenres = existing.genres.filter((x) => x !== g)
      else if (existing.genres.length >= 5) return prev
      else nextGenres = [...existing.genres, g]
      next[idx] = { ...existing, genres: nextGenres }
      return { ...prev, lineup: next }
    })
    setServerError(null)
  }

  function addLineupEntry() {
    setDraft((prev) => {
      const last = prev.lineup[prev.lineup.length - 1]
      const seedStart = last?.startTime ?? prev.startTime
      const next: LineupDraft = {
        startTime: seedStart,
        djName: '',
        genres: last ? [...last.genres] : ['amapiano'],
      }
      return { ...prev, lineup: [...prev.lineup, next] }
    })
    setServerError(null)
  }

  function removeLineupEntry(idx: number) {
    setDraft((prev) => {
      const next = prev.lineup.slice()
      next.splice(idx, 1)
      return { ...prev, lineup: next }
    })
    setServerError(null)
  }

  async function handleSave() {
    if (hasErrors || saving) return
    setSaving(true)
    setServerError(null)
    try {
      // R3.12 / R4.13: cross-midnight drafts split into two same-day slots
      // sharing a `pair-<base>-a/b` slotId. We reuse the existing base when
      // editing a pair so the on-disk halves are replaced rather than
      // duplicated. Conversely, if the operator collapses a previously
      // cross-midnight slot back into a same-day slot, we promote the draft
      // to a fresh, non-pair slotId so the on-disk shape never carries a
      // stale `pair-...` id without a partner half.
      const base = editingPairBase ?? newPairBase()
      let candidates: ScheduleSlot[]
      if (isCrossMidnight) {
        candidates = splitCrossMidnightDraft(draft, base)
      } else {
        const single = draftToSlot(draft)
        if (editingPairBase) single.slotId = newSlotId()
        candidates = [single]
      }
      // When demoting a pair back to a single same-day slot we strip BOTH
      // halves of the old pair from disk before appending the fresh
      // candidate so the on-disk shape never carries an orphan half.
      const baseSchedule =
        editingPairBase && !isCrossMidnight
          ? { ...schedule, slots: schedule.slots.filter((s) => pairBaseOf(s.slotId) !== editingPairBase) }
          : schedule
      const proposed = buildProposedSchedule(baseSchedule, candidates)
      const persisted = await api.post<MusicSchedule>(
        `/v1/business/${encodeURIComponent(schedule.businessId)}/music-schedule`,
        proposed,
      )
      onSaved(persisted)
    } catch (err) {
      const apiErr = err as Partial<ServerValidationError> & ApiError
      // The schedule-crud Lambda returns 400 with `{ code, field, message,
      // slotId? }` on validator failure (R4.5). Surface those inline so the
      // editor renders against the offending field. We keep the dirty state
      // - the form is NOT closed.
      if (apiErr.statusCode === 400 && typeof apiErr.code === 'string' && typeof apiErr.field === 'string') {
        const mapped = mapValidationError(
          {
            code: apiErr.code,
            field: apiErr.field,
            message: apiErr.message ?? 'Validation failed',
            ...(apiErr.slotId !== undefined ? { slotId: apiErr.slotId } : {}),
          },
          draft.slotId,
        )
        setServerError(mapped)
      } else {
        setServerError({ _global: apiErr.message ?? 'Could not save the slot. Please try again.' })
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!isEditing || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // R4.14: a Cross_Midnight_Pair is deleted as a unit. We POST the full
      // schedule with BOTH halves removed rather than issuing two DELETE
      // calls, so the operation is atomic from the operator's perspective
      // and we never leave a half-pair on disk.
      if (editingPairBase) {
        const remaining = schedule.slots.filter((s) => pairBaseOf(s.slotId) !== editingPairBase)
        const persisted = await api.post<MusicSchedule>(
          `/v1/business/${encodeURIComponent(schedule.businessId)}/music-schedule`,
          { ...schedule, slots: remaining },
        )
        onSaved(persisted)
        return
      }
      const persisted = await api.delete<MusicSchedule>(
        `/v1/business/${encodeURIComponent(schedule.businessId)}/music-schedule/${encodeURIComponent(draft.slotId)}`,
      )
      onSaved(persisted)
    } catch (err) {
      const apiErr = err as ApiError
      // R4.8: keep the slot in the UI on failure and surface a retry
      // affordance. We leave the editor open and show the error inline so
      // the operator can press Delete again.
      setDeleteError(apiErr.message ?? 'Could not delete the slot. Please try again.')
      setConfirmDelete(true)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-5"
      data-testid="music-schedule-editor"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-lg w-full max-h-[92vh] overflow-y-auto flex flex-col gap-4 shadow-2xl">
        <div className="flex flex-row items-center justify-between">
          <h3 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">
            {isEditing ? 'Edit slot' : 'New slot'}
          </h3>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] text-sm" aria-label="Close">
            ✕
          </button>
        </div>

        {allErrors['_global'] && (
          <div className="text-[var(--danger)] text-xs" role="alert">
            {allErrors['_global']}
          </div>
        )}
        {allErrors['_otherSlot'] && (
          <div className="text-[var(--danger)] text-xs" role="alert">
            {allErrors['_otherSlot']}
          </div>
        )}

        {/* Day of week */}
        <label className="flex flex-col gap-1">
          <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Day of week</span>
          <select
            value={draft.dayOfWeek}
            onChange={(e) => patchDraft({ dayOfWeek: e.target.value as ScheduleDayOfWeek })}
            className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm"
            data-testid="slot-editor-day-of-week"
          >
            {DAYS_OF_WEEK.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          {allErrors['dayOfWeek'] && <span className="text-[var(--danger)] text-xs">{allErrors['dayOfWeek']}</span>}
        </label>

        {/* Start / End time */}
        <div className="flex flex-row gap-3">
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Start time</span>
            <input
              type="time"
              value={draft.startTime}
              onChange={(e) => patchDraft({ startTime: e.target.value })}
              className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm"
              data-testid="slot-editor-start-time"
            />
            {allErrors['startTime'] && <span className="text-[var(--danger)] text-xs">{allErrors['startTime']}</span>}
          </label>
          <label className="flex flex-col gap-1 flex-1">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">End time</span>
            <input
              type="time"
              value={draft.endTime}
              onChange={(e) => patchDraft({ endTime: e.target.value })}
              className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm"
              data-testid="slot-editor-end-time"
            />
            {allErrors['endTime'] && <span className="text-[var(--danger)] text-xs">{allErrors['endTime']}</span>}
          </label>
        </div>
        {isCrossMidnight && !allErrors['cross_midnight'] && (
          <div
            className="text-[var(--text-secondary)] text-xs bg-[var(--bg-raised)] border border-[var(--border)] rounded-xl px-3 py-2"
            data-testid="slot-editor-cross-midnight"
          >
            This slot crosses midnight. We’ll save it as two halves on {draft.dayOfWeek} and {nextDay(draft.dayOfWeek)}{' '}
            so it shows as a single span on your week view.
          </div>
        )}
        {allErrors['cross_midnight'] && (
          <div className="text-[var(--danger)] text-xs" role="alert">
            {allErrors['cross_midnight']}
          </div>
        )}

        {/* Mode toggle */}
        <div className="flex flex-col gap-1">
          <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Mode</span>
          <div
            className="inline-flex rounded-xl border border-[var(--border)] overflow-hidden self-start"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              aria-selected={draft.mode === 'blanket'}
              onClick={() => handleModeChange('blanket')}
              className={`px-4 py-2 text-sm ${
                draft.mode === 'blanket'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-raised)] text-[var(--text-secondary)]'
              }`}
              data-testid="slot-editor-mode-blanket"
            >
              Blanket
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={draft.mode === 'lineup'}
              onClick={() => handleModeChange('lineup')}
              className={`px-4 py-2 text-sm ${
                draft.mode === 'lineup'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--bg-raised)] text-[var(--text-secondary)]'
              }`}
              data-testid="slot-editor-mode-lineup"
            >
              Lineup
            </button>
          </div>
        </div>

        {/* Mode-specific body */}
        {draft.mode === 'blanket' ? (
          <div className="flex flex-col gap-2">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Genres (1-5)</span>
            <div className="flex flex-row flex-wrap gap-2" data-testid="slot-editor-genres">
              {MUSIC_GENRES.map((g) => {
                const selected = draft.genres.includes(g)
                const disabled = !selected && draft.genres.length >= 5
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGenre(g)}
                    disabled={disabled}
                    aria-pressed={selected}
                    className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      selected
                        ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                        : 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border-[var(--border)]'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                    data-testid={`slot-editor-genre-${g}`}
                  >
                    {GENRE_LABELS[g]}
                  </button>
                )
              })}
            </div>
            {allErrors['genres'] && <span className="text-[var(--danger)] text-xs">{allErrors['genres']}</span>}
          </div>
        ) : (
          <div className="flex flex-col gap-3" data-testid="slot-editor-lineup">
            <span className="text-[var(--text-secondary)] text-xs uppercase tracking-wider">Lineup (1-20 entries)</span>
            {allErrors['lineup'] && <span className="text-[var(--danger)] text-xs">{allErrors['lineup']}</span>}
            <div className="flex flex-col gap-3">
              {draft.lineup.map((entry, idx) => (
                <LineupEntryRow
                  key={idx}
                  index={idx}
                  entry={entry}
                  errors={allErrors}
                  onPatch={(patch) => patchLineupEntry(idx, patch)}
                  onToggleGenre={(g) => toggleLineupGenre(idx, g)}
                  onRemove={() => removeLineupEntry(idx)}
                  canRemove={draft.lineup.length > 1}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addLineupEntry}
              disabled={draft.lineup.length >= 20}
              className="self-start text-[var(--accent)] text-sm disabled:opacity-40"
              data-testid="slot-editor-add-lineup-entry"
            >
              + Add lineup entry
            </button>
          </div>
        )}

        {/* Overlap conflict */}
        {allErrors['overlap'] && (
          <div
            className="text-[var(--danger)] text-xs bg-[var(--danger)]/10 border border-[var(--danger)]/40 rounded-xl px-3 py-2"
            role="alert"
            data-testid="slot-editor-overlap"
          >
            {allErrors['overlap']}
          </div>
        )}

        {/* Action row */}
        <div className="flex flex-row items-center justify-between gap-2 pt-2">
          {isEditing ? (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-[var(--danger)] text-sm"
              data-testid="slot-editor-delete"
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-row gap-2">
            <button
              type="button"
              onClick={onClose}
              className="border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-4 py-2 text-sm"
              data-testid="slot-editor-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={hasErrors || saving}
              className="bg-[var(--accent)] text-white rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              data-testid="slot-editor-save"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* Delete confirmation (R4.6) */}
      {confirmDelete && (
        <div
          className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[60] p-5"
          data-testid="slot-editor-delete-confirm"
        >
          <div className="bg-[var(--bg-modal)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full flex flex-col gap-3 shadow-2xl">
            <h4 className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">Delete this slot?</h4>
            <p className="text-[var(--text-secondary)] text-sm">
              This removes the slot from your weekly schedule. You can add it back later.
            </p>
            {deleteError && (
              <div className="text-[var(--danger)] text-xs" role="alert">
                {deleteError}
              </div>
            )}
            <div className="flex flex-row gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmDelete(false)
                  setDeleteError(null)
                }}
                disabled={deleting}
                className="flex-1 border border-[var(--border)] text-[var(--text-primary)] rounded-xl py-2.5 text-sm disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                className="flex-1 bg-[var(--danger)] text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-40"
                data-testid="slot-editor-delete-confirm-button"
              >
                {deleting ? 'Deleting…' : deleteError ? 'Retry delete' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

interface LineupEntryRowProps {
  index: number
  entry: LineupDraft
  errors: InlineErrors
  onPatch: (patch: Partial<LineupDraft>) => void
  onToggleGenre: (g: MusicGenre) => void
  onRemove: () => void
  canRemove: boolean
}

function LineupEntryRow({ index, entry, errors, onPatch, onToggleGenre, onRemove, canRemove }: LineupEntryRowProps) {
  const startKey = `lineup[${index}].startTime`
  const djKey = `lineup[${index}].djName`
  const genresKey = `lineup[${index}].genres`
  return (
    <div
      className="border border-[var(--border)] rounded-xl p-3 flex flex-col gap-2"
      data-testid={`slot-editor-lineup-entry-${index}`}
    >
      <div className="flex flex-row items-center gap-2">
        <span className="text-[var(--text-muted)] text-xs">#{index + 1}</span>
        <input
          type="time"
          value={entry.startTime}
          onChange={(e) => onPatch({ startTime: e.target.value })}
          className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-sm w-[100px]"
          data-testid={`slot-editor-lineup-${index}-start-time`}
        />
        <input
          type="text"
          placeholder="DJ name (optional)"
          value={entry.djName}
          onChange={(e) => onPatch({ djName: e.target.value })}
          className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-2 py-1 text-sm flex-1"
          data-testid={`slot-editor-lineup-${index}-dj-name`}
          maxLength={60}
        />
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[var(--danger)] text-xs"
            data-testid={`slot-editor-lineup-${index}-remove`}
            aria-label={`Remove lineup entry ${index + 1}`}
          >
            Remove
          </button>
        )}
      </div>
      {errors[startKey] && <span className="text-[var(--danger)] text-xs">{errors[startKey]}</span>}
      {errors[djKey] && <span className="text-[var(--danger)] text-xs">{errors[djKey]}</span>}
      <div className="flex flex-row flex-wrap gap-1">
        {MUSIC_GENRES.map((g) => {
          const selected = entry.genres.includes(g)
          const disabled = !selected && entry.genres.length >= 5
          return (
            <button
              key={g}
              type="button"
              onClick={() => onToggleGenre(g)}
              disabled={disabled}
              aria-pressed={selected}
              className={`px-2 py-1 rounded-full text-[11px] border ${
                selected
                  ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                  : 'bg-[var(--bg-raised)] text-[var(--text-secondary)] border-[var(--border)]'
              } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              data-testid={`slot-editor-lineup-${index}-genre-${g}`}
            >
              {GENRE_LABELS[g]}
            </button>
          )
        })}
      </div>
      {errors[genresKey] && <span className="text-[var(--danger)] text-xs">{errors[genresKey]}</span>}
    </div>
  )
}
