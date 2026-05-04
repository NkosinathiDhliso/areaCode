import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '@area-code/shared/lib/api'
import { getSocket } from '@area-code/shared/lib/socket'
import { useSocketRoom } from '@area-code/shared/hooks/useSocketRoom'
import { useBusinessAuthStore } from '@area-code/shared/stores/businessAuthStore'

interface CheckInEntry {
  displayName: string
  tier: string
  visitCount: number
  timestamp: string
}

function getVisitLabel(visitCount: number): string {
  if (visitCount <= 1) return 'First-time'
  if (visitCount <= 4) return 'Returning'
  return 'Regular'
}

function getVisitColor(visitCount: number): string {
  if (visitCount <= 1) return 'var(--accent)'
  if (visitCount <= 4) return 'var(--warning)'
  return 'var(--success)'
}

export function CheckInDetailPanel() {
  const { t } = useTranslation()
  const { accessToken, businessId } = useBusinessAuthStore()
  const [entries, setEntries] = useState<CheckInEntry[]>([])
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [loading, setLoading] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)

  async function fetchCheckIns(selectedDate: string, cursor?: string) {
    setLoading(true)
    setLoadError(false)
    try {
      const params = new URLSearchParams({ date: selectedDate })
      if (cursor) params.set('cursor', cursor)
      const res = await api.get<{ items: CheckInEntry[]; nextCursor: string | null }>(
        `/v1/business/check-ins?${params.toString()}`,
      )
      if (cursor) {
        setEntries((prev) => [...prev, ...res.items])
      } else {
        setEntries(res.items)
      }
      setNextCursor(res.nextCursor)
    } catch {
      setLoadError(true)
      if (!cursor) setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCheckIns(date)
  }, [date])

  // Join business room for real-time updates
  const room = businessId ? `business:${businessId}` : null
  useSocketRoom(room, accessToken ?? undefined)

  // Listen for real-time check-in detail events
  useEffect(() => {
    if (!businessId || !accessToken) return
    const socket = getSocket(accessToken)
    const handler = (payload: CheckInEntry) => {
      // Only append if viewing today's date
      const today = new Date().toISOString().slice(0, 10)
      if (date === today) {
        setEntries((prev) => [payload, ...prev])
      }
    }
    // business:checkin_detail is a dynamic event not in the static type map
    ;(socket as any).on('business:checkin_detail', handler)
    return () => {
      ;(socket as any).off('business:checkin_detail', handler)
    }
  }, [businessId, accessToken, date])

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('biz.panel.checkIns', 'Check-Ins')}
        </h2>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-[var(--bg-raised)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:border-[var(--accent)] focus:outline-none appearance-none [color-scheme:dark]"
        />
      </div>

      {loading && entries.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">Loading...</div>
      )}

      {!loading && loadError && (
        <div className="text-[var(--danger)] text-sm text-center py-8">
          Failed to load check-ins. Try another date or refresh.
        </div>
      )}

      {!loading && !loadError && entries.length === 0 && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">
          No check-ins for this date
        </div>
      )}

      <div className="flex flex-col gap-2">
        {entries.map((entry, idx) => (
          <div
            key={`${entry.timestamp}-${idx}`}
            className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-row items-center justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="text-[var(--text-primary)] font-medium text-sm">
                {entry.displayName}
              </span>
              <div className="flex flex-row items-center gap-2">
                <span className="text-[var(--text-muted)] text-xs capitalize">{entry.tier}</span>
                <span
                  className="text-xs font-medium px-2 py-0.5 rounded-full"
                  style={{
                    color: getVisitColor(entry.visitCount),
                    backgroundColor: `color-mix(in srgb, ${getVisitColor(entry.visitCount)} 15%, transparent)`,
                  }}
                >
                  {getVisitLabel(entry.visitCount)}
                </span>
              </div>
            </div>
            <span className="text-[var(--text-muted)] text-xs">
              {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}
      </div>

      {nextCursor && (
        <button
          onClick={() => fetchCheckIns(date, nextCursor)}
          disabled={loading}
          className="text-[var(--accent)] text-sm font-medium py-2"
        >
          {loading ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  )
}
