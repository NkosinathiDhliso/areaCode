import { api } from '@area-code/shared/lib/api'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Period = 'week' | 'month' | 'all'

interface LeaderboardEntry {
  staffId: string
  staffName: string
  redemptions: number
  prevRedemptions: number
  delta: number
  attributedReturnVisits: number
  uniqueConsumersServed: number
}

interface LeaderboardPayload {
  period: Period
  entries: LeaderboardEntry[]
  generatedAt: string
}

const PERIOD_LABELS: Record<Period, string> = {
  week: 'Last 7 days',
  month: 'Last 30 days',
  all: 'All time',
}

function rankIcon(rank: number): string {
  if (rank === 0) return '🥇'
  if (rank === 1) return '🥈'
  if (rank === 2) return '🥉'
  return ''
}

export function StaffLeaderboardPanel() {
  const { t } = useTranslation()
  const [period, setPeriod] = useState<Period>('week')
  const [data, setData] = useState<LeaderboardPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function fetchLeaderboard(p: Period) {
    setLoading(true)
    setLoadError(false)
    try {
      const res = await api.get<LeaderboardPayload>(`/v1/business/staff/leaderboard?period=${p}`)
      setData(res)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void fetchLeaderboard(period)
  }, [period])

  const totalRedemptions = data?.entries.reduce((s, e) => s + e.redemptions, 0) ?? 0
  const totalReturns = data?.entries.reduce((s, e) => s + e.attributedReturnVisits, 0) ?? 0

  return (
    <div className="p-5 flex flex-col gap-4">
      <div>
        <h2 className="text-[var(--text-primary)] font-bold text-xl font-[Syne]">
          {t('biz.staffLeaderboard.title', 'Staff leaderboard')}
        </h2>
        <p className="text-[var(--text-muted)] text-xs mt-1">
          {t('biz.staffLeaderboard.subtitle', 'Who is bringing customers back. Share the screen at shift start.')}
        </p>
      </div>

      {/* Period switcher */}
      <div className="flex flex-row gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-xl text-xs transition-all duration-150 ${
              p === period
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]'
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {loading && !data && (
        <div className="text-[var(--text-muted)] text-sm text-center py-8">Loading leaderboard…</div>
      )}

      {loadError && !data && (
        <div className="flex flex-col items-center gap-3 py-8">
          <p className="text-[var(--text-muted)] text-sm">Failed to load leaderboard</p>
          <button onClick={() => void fetchLeaderboard(period)} className="text-[var(--accent)] text-sm">
            Retry
          </button>
        </div>
      )}

      {data && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 gap-3">
            <SummaryTile label="Redemptions" value={totalRedemptions.toString()} />
            <SummaryTile
              label="Brought back within 30d"
              value={totalReturns.toString()}
              hint={
                totalRedemptions > 0 ? `${Math.round((totalReturns / totalRedemptions) * 100)}% return rate` : undefined
              }
            />
          </div>

          {data.entries.length === 0 && (
            <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-6 text-center text-[var(--text-muted)] text-sm">
              No redemptions in this period yet. Encourage your staff to ask:
              <span className="block mt-2 text-[var(--text-primary)] font-medium">
                "Are you on Area Code? Show me your code for your get."
              </span>
            </div>
          )}

          {data.entries.length > 0 && (
            <ul className="flex flex-col gap-2">
              {data.entries.map((e, idx) => (
                <li
                  key={e.staffId}
                  className={`bg-[var(--bg-surface)] border rounded-2xl p-4 flex flex-row items-center gap-3 ${
                    idx === 0 ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]' : 'border-[var(--border)]'
                  }`}
                >
                  <div className="w-9 text-center">
                    <span className="text-xl">{rankIcon(idx) || `#${idx + 1}`}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-row items-center gap-2 flex-wrap">
                      <span className="text-[var(--text-primary)] font-medium text-sm truncate">{e.staffName}</span>
                      {idx === 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] font-medium uppercase tracking-wide">
                          Top
                        </span>
                      )}
                    </div>
                    <div className="text-[var(--text-muted)] text-xs mt-0.5">
                      {e.uniqueConsumersServed} unique customers · {e.attributedReturnVisits} came back
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[var(--text-primary)] font-bold text-lg font-[Syne]">{e.redemptions}</div>
                    <DeltaBadge delta={e.delta} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[var(--text-muted)] text-xs text-center">
            Updated {new Date(data.generatedAt).toLocaleTimeString()} · Refreshes every 5 min
          </p>
        </>
      )}
    </div>
  )
}

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-1">
      <span className="text-[var(--text-muted)] text-xs">{label}</span>
      <span className="text-2xl font-bold font-[Syne] text-[var(--text-primary)]">{value}</span>
      {hint && <span className="text-[var(--text-muted)] text-[10px]">{hint}</span>}
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta === 0) {
    return <span className="text-[var(--text-muted)] text-xs">—</span>
  }
  const positive = delta > 0
  return (
    <span className={`text-xs font-medium ${positive ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
      {positive ? '↑' : '↓'} {Math.abs(delta)}
    </span>
  )
}
