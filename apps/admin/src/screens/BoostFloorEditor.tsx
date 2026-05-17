import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import type { ApiError } from '@area-code/shared/lib/api'

// ─── Types (mirrored from backend response contract) ───────────────────────
//
// We deliberately do NOT import the backend Zod schemas here — the admin
// frontend has no `backend/` dependency. The shapes below mirror
// `BoostFloorView` and `FloorChangeAuditView` from
// `backend/src/features/business/types.ts`.

type BoostDuration = '2hr' | '6hr' | '24hr'

interface BoostFloorView {
  duration: BoostDuration
  floorCents: number
  currency: 'ZAR'
  updatedAt: string | null
  updatedBy: string | null
  /** True when no `BoostFloor_Row` has been written for this duration yet (R4.8). */
  isDefault: boolean
}

interface FloorChangeAuditView {
  duration: BoostDuration
  previousFloorCents: number | null
  newFloorCents: number
  currency: 'ZAR'
  changedBy: string
  changedByEmail: string
  changedAt: string
  changeReason: string | null
}

interface FloorAuditResponse {
  items: FloorChangeAuditView[]
  nextCursor: string | null
}

interface BoostFloorsResponse {
  items: BoostFloorView[]
}

const DURATIONS: BoostDuration[] = ['2hr', '6hr', '24hr']

const DURATION_LABELS: Record<BoostDuration, string> = {
  '2hr': '2 hours',
  '6hr': '6 hours',
  '24hr': '24 hours',
}

const FLOOR_MIN_CENTS = 1
const FLOOR_MAX_CENTS = 1_000_000
const CHANGE_REASON_MAX_LENGTH = 280
const AUDIT_PAGE_LIMIT = 25

// Format `cents` as `R<X>.<YY>` (R4.2 — same convention used elsewhere in the
// portals, e.g. operator BoostPurchasesPanel). Deliberately not using the
// shared `formatZAR` helper because it strips decimals; admins need cent-level
// precision visible.
function formatAmountCents(cents: number): string {
  const whole = Math.floor(cents / 100)
  const fraction = (cents % 100).toString().padStart(2, '0')
  return `R${whole}.${fraction}`
}

// Format an ISO 8601 timestamp as `YYYY-MM-DD HH:mm` in `Africa/Johannesburg`
// (matches the operator BoostPurchasesPanel format so admins see times in the
// SA timezone consistently across the platform).
function formatTimestamp(iso: string): string {
  const fmt = new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(iso))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

// Cognito sub UUIDs are long; show only the first 8 chars in the UI so the
// row stays readable. Hover/title shows the full id.
function truncateSub(sub: string | null): string {
  if (!sub) return '—'
  return sub.length > 8 ? `${sub.slice(0, 8)}…` : sub
}

function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'message' in e &&
    'statusCode' in e &&
    typeof (e as { statusCode: unknown }).statusCode === 'number'
  )
}

export function BoostFloorEditor() {
  const { t } = useTranslation()
  const [floors, setFloors] = useState<BoostFloorView[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function fetchFloors() {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await api.get<BoostFloorsResponse>('/v1/admin/boost-floors')
      setFloors(res.items)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchFloors()
  }, [])

  return (
    <div className="p-5 flex flex-col gap-5">
      <div>
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('admin.boostFloors.title', 'Booster Price Floors')}
        </h2>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          {t(
            'admin.boostFloors.subtitle',
            'Per-duration minimum price for booster checkouts. Changes take effect immediately and are recorded in the audit log.',
          )}
        </p>
      </div>

      {loading && floors.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-12">Loading floors…</div>
      )}

      {loadError && floors.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-[var(--text-muted)] text-sm">Failed to load boost floors</p>
          <button onClick={() => void fetchFloors()} className="text-[var(--accent)] text-sm">
            Retry
          </button>
        </div>
      )}

      {floors.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {DURATIONS.map((duration) => {
            const floor = floors.find((f) => f.duration === duration)
            if (!floor) return null
            return (
              <FloorCard
                key={duration}
                floor={floor}
                onUpdated={(updated) => {
                  setFloors((prev) => prev.map((f) => (f.duration === updated.duration ? updated : f)))
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Per-duration floor card ───────────────────────────────────────────────

interface FloorCardProps {
  floor: BoostFloorView
  onUpdated: (updated: BoostFloorView) => void
}

function FloorCard({ floor, onUpdated }: FloorCardProps) {
  // The edit form mirrors the server contract: integer cents in
  // `[1, 1_000_000]`, optional `changeReason` ≤ 280 chars (R4.3).
  const [floorCentsInput, setFloorCentsInput] = useState<string>(String(floor.floorCents))
  const [changeReason, setChangeReason] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Re-sync the input when the parent updates the floor (e.g. on initial load
  // or when a sibling card refreshes the list). Without this, a successful
  // save would leave the input showing the same string the admin typed.
  useEffect(() => {
    setFloorCentsInput(String(floor.floorCents))
  }, [floor.floorCents, floor.updatedAt])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    const parsed = Number(floorCentsInput)
    if (!Number.isInteger(parsed) || parsed < FLOOR_MIN_CENTS || parsed > FLOOR_MAX_CENTS) {
      setSaveError(`floorCents must be an integer between ${FLOOR_MIN_CENTS} and ${FLOOR_MAX_CENTS}`)
      return
    }
    if (changeReason.length > CHANGE_REASON_MAX_LENGTH) {
      setSaveError(`changeReason must be ≤ ${CHANGE_REASON_MAX_LENGTH} characters`)
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const body: { floorCents: number; changeReason?: string } = { floorCents: parsed }
      if (changeReason.trim().length > 0) {
        body.changeReason = changeReason.trim()
      }
      const updated = await api.put<BoostFloorView>(`/v1/admin/boost-floors/${floor.duration}`, body)
      onUpdated(updated)
      setChangeReason('')
    } catch (err) {
      // Surface inline 400 errors from the server. 5xx is already toasted by
      // the shared API client.
      if (isApiError(err)) {
        setSaveError(err.message || 'Failed to update floor')
      } else {
        setSaveError('Failed to update floor')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
      <div className="flex flex-row items-baseline justify-between">
        <h3 className="text-[var(--text-primary)] font-bold text-base font-[Syne]">
          {DURATION_LABELS[floor.duration]}
        </h3>
        <span className="text-[var(--text-muted)] text-xs font-mono">{floor.duration}</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-2xl font-bold font-[Syne] text-[var(--accent)]">
          {formatAmountCents(floor.floorCents)}
        </span>
        <span className="text-[var(--text-muted)] text-xs">{floor.floorCents} cents</span>
      </div>

      {floor.isDefault ? (
        <div className="text-[var(--text-muted)] text-xs italic">default — never edited</div>
      ) : (
        <div className="flex flex-col gap-0.5 text-[var(--text-muted)] text-xs">
          <div>Updated {floor.updatedAt ? formatTimestamp(floor.updatedAt) : '—'}</div>
          <div title={floor.updatedBy ?? undefined}>by {truncateSub(floor.updatedBy)}</div>
        </div>
      )}

      <form onSubmit={(e) => void handleSave(e)} className="flex flex-col gap-2 mt-1">
        <label className="flex flex-col gap-1">
          <span className="text-[var(--text-secondary)] text-xs">New floor (cents)</span>
          <input
            type="number"
            min={FLOOR_MIN_CENTS}
            max={FLOOR_MAX_CENTS}
            step={1}
            value={floorCentsInput}
            onChange={(e) => setFloorCentsInput(e.target.value)}
            disabled={saving}
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[var(--text-secondary)] text-xs">
            Change reason (optional, max {CHANGE_REASON_MAX_LENGTH})
          </span>
          <textarea
            value={changeReason}
            onChange={(e) => setChangeReason(e.target.value)}
            disabled={saving}
            maxLength={CHANGE_REASON_MAX_LENGTH}
            rows={2}
            placeholder="Why is this changing?"
            className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] resize-none"
          />
          <span className="text-[var(--text-muted)] text-[10px] self-end">
            {changeReason.length}/{CHANGE_REASON_MAX_LENGTH}
          </span>
        </label>

        <button
          type="submit"
          disabled={saving}
          className="bg-[var(--accent)] text-white rounded-xl py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>

        {saveError && <p className="text-[var(--danger)] text-xs">{saveError}</p>}
      </form>

      <FloorAuditList duration={floor.duration} key={`${floor.duration}#${floor.updatedAt ?? 'default'}`} />
    </div>
  )
}

// ─── Per-duration audit history list ──────────────────────────────────────

interface FloorAuditListProps {
  duration: BoostDuration
}

function FloorAuditList({ duration }: FloorAuditListProps) {
  const [items, setItems] = useState<FloorChangeAuditView[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchPage(cursor?: string) {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (cursor) params.set('cursor', cursor)
      params.set('limit', String(AUDIT_PAGE_LIMIT))
      const path = `/v1/admin/boost-floors/${duration}/audit?${params.toString()}`
      const res = await api.get<FloorAuditResponse>(path)
      if (cursor) {
        setItems((prev) => [...prev, ...res.items])
      } else {
        setItems(res.items)
      }
      setNextCursor(res.nextCursor)
    } catch {
      setError('Failed to load audit history')
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }

  useEffect(() => {
    void fetchPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration])

  return (
    <div className="border-t border-[var(--border)] pt-3 mt-1 flex flex-col gap-2">
      <h4 className="text-[var(--text-secondary)] font-semibold text-xs">Recent changes</h4>

      {!loaded && loading && <div className="text-[var(--text-muted)] text-xs">Loading history…</div>}

      {loaded && !error && items.length === 0 && (
        <div className="text-[var(--text-muted)] text-xs italic">No changes recorded.</div>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((row, idx) => (
            <li
              key={`${row.changedAt}#${row.changedBy}#${idx}`}
              className="bg-[var(--bg-raised)] border border-[var(--border)] rounded-lg p-2 flex flex-col gap-1"
            >
              <div className="flex flex-row items-baseline justify-between text-xs">
                <span className="text-[var(--text-primary)] font-medium">
                  {row.previousFloorCents !== null ? formatAmountCents(row.previousFloorCents) : '—'}
                  {' → '}
                  {formatAmountCents(row.newFloorCents)}
                </span>
                <span className="text-[var(--text-muted)] text-[10px]">{formatTimestamp(row.changedAt)}</span>
              </div>
              <div className="text-[var(--text-muted)] text-[10px] truncate" title={row.changedByEmail}>
                {row.changedByEmail}
              </div>
              {row.changeReason && (
                <div className="text-[var(--text-secondary)] text-xs italic">{row.changeReason}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={() => void fetchPage(nextCursor)}
          disabled={loading}
          className="text-[var(--accent)] text-xs font-medium py-1 self-start"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}

      {error && <p className="text-[var(--danger)] text-xs">{error}</p>}
    </div>
  )
}
