/**
 * "Your rank" widget for the staff home screen.
 *
 * Reuses the shared business leaderboard endpoint - staff are members of
 * the business pool via their staff record, so the same endpoint resolves
 * their businessId server-side.
 *
 * The intent is social proof: a staff member who sees their own number
 * vs the top performer at start of shift will pitch the app harder. We
 * deliberately show top 3 + "you" rather than the full list so it feels
 * like a leaderboard, not a performance review.
 */

import { api } from '@area-code/shared/lib/api'
import { useEffect, useState } from 'react'

import { useStaffAuthStore } from '../stores/staffAuthStore'

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
  period: 'week' | 'month' | 'all'
  entries: LeaderboardEntry[]
  generatedAt: string
}

export function MyRank() {
  const staffId = useStaffAuthStore((s) => s.staffId)
  const [data, setData] = useState<LeaderboardPayload | null>(null)
  const [errored, setErrored] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api
      .get<LeaderboardPayload>('/v1/business/staff/leaderboard?period=week')
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setErrored(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (errored || !data || data.entries.length === 0) return null

  const top3 = data.entries.slice(0, 3)
  const myIndex = data.entries.findIndex((e) => e.staffId === staffId)
  const me = myIndex >= 0 ? data.entries[myIndex]! : null
  const myRank = myIndex + 1

  return (
    <section className="px-5 pt-4 pb-2">
      <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-row items-center justify-between">
          <span className="text-[var(--text-primary)] font-semibold text-sm">This week</span>
          <span className="text-[var(--text-muted)] text-xs">Top performers</span>
        </div>
        <ul className="flex flex-col gap-1.5">
          {top3.map((e, idx) => (
            <li
              key={e.staffId}
              className={`flex flex-row items-center justify-between text-xs ${
                e.staffId === staffId ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-secondary)]'
              }`}
            >
              <span className="truncate">
                #{idx + 1} {idx === 0 ? '🥇 ' : idx === 1 ? '🥈 ' : '🥉 '}
                {e.staffId === staffId ? 'You' : e.staffName}
              </span>
              <span>{e.redemptions} redemptions</span>
            </li>
          ))}
        </ul>
        {me && myIndex > 2 && (
          <>
            <div className="border-t border-[var(--border)] my-1" />
            <div className="flex flex-row items-center justify-between text-xs text-[var(--accent)] font-semibold">
              <span>#{myRank} You</span>
              <span>{me.redemptions} redemptions</span>
            </div>
          </>
        )}
        {me && me.redemptions === 0 && (
          <p className="text-[var(--text-muted)] text-xs italic">
            Pitch the app at the till today and you'll be on the board by tomorrow.
          </p>
        )}
      </div>
    </section>
  )
}
